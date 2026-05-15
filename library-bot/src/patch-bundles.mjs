import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { detectLauncher } from "./utils.mjs";

function buildConf(templateBase, launcherLines) {
  const autoexec = ["@echo off", "mount c .", "c:", "cd GAME", ...launcherLines, "exit"].join("\n");
  return `${templateBase}\n[autoexec]\n${autoexec}\n`;
}

function findEntry(zip, entryName) {
  return (
    zip.getEntry(entryName) ||
    zip.getEntries().find(e => e.entryName.toLowerCase() === entryName.toLowerCase())
  );
}

/**
 * Translate bare DOSBox runtime commands inside a .bat file to their
 * 'config -set' equivalents. In js-dos's WASM build, bare 'cycles auto'
 * / 'aspect' / 'scaler' commands may behave incorrectly (e.g. uncapped
 * auto-cycles stalls emulation). The config -set form is safe.
 *
 * Also fixes path issues that arise because all game files live under
 * GAME/ in the bundle (mounted as C:\GAME\) but many DOS Games Archive
 * launcher scripts were written expecting the game root to be C:\.
 *
 * Returns the patched content, or the original string if nothing changed.
 */
function patchBatContent(content) {
  return content
    // bare 'scaler X'  →  'config -set render scaler=X'
    .replace(
      /^(\s*)scaler\s+(\S[^\r\n]*)$/mig,
      (_, pre, val) => `${pre}config -set render scaler=${val.trim()}`
    )
    // bare 'aspect true|false'  →  'config -set render aspect=true|false'
    .replace(
      /^(\s*)aspect\s+(true|false)\s*$/mig,
      (_, pre, val) => `${pre}config -set render aspect=${val.toLowerCase()}`
    )
    // bare 'cycles ...'  →  'config -set cpu "cycles=..."'
    // Also unescape %% → % (batch-file escaping)
    .replace(
      /^(\s*)cycles\s+([^\r\n]+)$/mig,
      (_, pre, rest) =>
        `${pre}config -set cpu "cycles=${rest.replace(/%%/g, "%").trim()}"`
    )
    // Wrong quoting: 'config -set "cpu cycles=..."' → 'config -set cpu "cycles=..."'
    // The section name must be a separate token; quoting it together with the
    // key-value swallows the section name and the command silently does nothing.
    .replace(
      /^(\s*)config\s+-set\s+"cpu\s+cycles=([^"]*)"([^\r\n]*)$/mig,
      (_, pre, val, rest) => `${pre}config -set cpu "cycles=${val}"${rest}`
    )
    // Absolute C:\SBPRO\ paths → C:\GAME\SBPRO\ (FM sound driver bundled under GAME/)
    .replace(/C:\\SBPRO\\/gi, "C:\\GAME\\SBPRO\\")
    // Absolute C:\S3VBE20\ / C:\S3SPDUP\ paths → C:\GAME\... (VESA drivers under GAME/)
    .replace(/C:\\S3VBE20\\/gi, "C:\\GAME\\S3VBE20\\")
    .replace(/C:\\S3SPDUP\\/gi, "C:\\GAME\\S3SPDUP\\");
}

/**
 * For old-style WEB.BATs that use the bare 'scaler X' command, inline the
 * commands from the SH.BAT they chain to (translating bare DOSBox commands
 * to config -set form, dropping cls/pause).
 *
 * WEB.BATs that already use 'config -set render scaler=...' are left alone.
 */
function resolveWebBat(zip, rawLines) {
  if (rawLines.length !== 1) return rawLines;
  const line = rawLines[0];
  if (!/^call .+web\.bat$/i.test(line)) return rawLines;

  const webBatFile = line.slice(5);
  const webBatEntry = findEntry(zip, `GAME/${webBatFile}`);
  if (!webBatEntry) return rawLines;

  const webContent = webBatEntry.getData().toString("utf8");
  if (!/^\s*scaler\s+\S/mi.test(webContent)) return rawLines; // already correct

  const callMatch = webContent.match(/^\s*call\s+(\S+\.bat)/mi);
  if (!callMatch) return rawLines;

  const shBatFile = callMatch[1].toUpperCase();
  const shBatEntry = findEntry(zip, `GAME/${shBatFile}`);
  if (!shBatEntry) {
    return ["config -set render scaler=normal2x", `call ${shBatFile}`];
  }

  const shContent = shBatEntry.getData().toString("utf8");
  const result = ["config -set render scaler=normal2x"];

  for (const rawLine of shContent.split(/\r?\n/)) {
    const t = rawLine.trim();
    const lc = t.toLowerCase();
    if (
      !t || lc.startsWith("rem") || lc.startsWith("@") ||
      lc === "cls" || lc === "pause" ||
      lc.startsWith("echo") || lc === "cd.." || lc === "cd .."
    ) continue;

    const aspectMatch = t.match(/^aspect\s+(true|false)$/i);
    if (aspectMatch) {
      result.push(`config -set render aspect=${aspectMatch[1].toLowerCase()}`);
      continue;
    }
    if (/^cycles\s+/i.test(t)) {
      const rest = t.replace(/^cycles\s+/i, "").replace(/%%/g, "%");
      result.push(`config -set cpu "cycles=${rest}"`);
      continue;
    }
    if (/^cd\s+\S/i.test(t) || /\.(exe|com)(\s|$)/i.test(t) || /^loadfix\s/i.test(t)) {
      result.push(t.toUpperCase());
    }
  }

  return result;
}

/**
 * Patches every existing .jsdos bundle in-place:
 *  1. Detects the game launcher from GAME/ file listing.
 *  2. Writes a new dosbox.conf with the exact launcher command.
 *  3. Patches all .bat files in GAME/ to translate bare DOSBox commands
 *     (cycles, aspect, scaler) to their 'config -set' equivalents — this
 *     prevents js-dos from stalling in uncapped auto-cycles mode.
 *  4. Adds any missing directory entries so js-dos WASM extractor works.
 */
export async function patchBundles({ bundlesDir, dosboxTemplatePath }) {
  const templateBase = await fs.readFile(dosboxTemplatePath, "utf8");

  let files;
  try {
    files = await fs.readdir(bundlesDir);
  } catch {
    console.warn(`[patcher] bundles dir not found: ${bundlesDir}`);
    return 0;
  }

  const jsdosFiles = files.filter(f => f.endsWith(".jsdos"));
  console.log(`[patcher] found ${jsdosFiles.length} bundles to patch`);

  let patched = 0;
  let skipped = 0;

  for (const file of jsdosFiles) {
    const filePath = path.join(bundlesDir, file);
    let changed = false;
    try {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const existingPaths = new Set(entries.map(e => e.entryName));

      // 1. Detect launcher
      const gamePaths = entries
        .filter(e => !e.isDirectory && e.entryName.startsWith("GAME/"))
        .map(e => e.entryName.slice("GAME/".length))
        .filter(Boolean);

      const rawLines = detectLauncher(gamePaths);
      const launcherLines = resolveWebBat(zip, rawLines);
      const newConf = buildConf(templateBase, launcherLines);

      // 2. Update dosbox.conf
      const confEntry = zip.getEntry(".jsdos/dosbox.conf");
      if (confEntry) {
        const current = confEntry.getData().toString("utf8");
        if (current !== newConf) {
          zip.updateFile(".jsdos/dosbox.conf", Buffer.from(newConf, "utf8"));
          changed = true;
        }
      }

      // 3. Patch .bat files — translate bare 'cycles'/'aspect'/'scaler' to config-set
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        if (!entry.entryName.startsWith("GAME/")) continue;
        if (!entry.entryName.toLowerCase().endsWith(".bat")) continue;
        const original = entry.getData().toString("utf8");
        const patched = patchBatContent(original);
        if (patched !== original) {
          zip.updateFile(entry.entryName, Buffer.from(patched, "utf8"));
          changed = true;
        }
      }

      // 4. Add any missing directory entries under GAME/
      const neededDirs = new Set(["GAME/"]);
      entries.forEach(e => {
        if (!e.entryName.startsWith("GAME/")) return;
        const parts = e.entryName.split("/");
        for (let i = 1; i < parts.length; i++) {
          neededDirs.add(parts.slice(0, i).join("/") + "/");
        }
      });
      neededDirs.forEach(dir => {
        if (!existingPaths.has(dir)) {
          zip.addFile(dir, Buffer.alloc(0));
          changed = true;
        }
      });

      if (changed) {
        zip.writeZip(filePath);
        patched++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[patcher] failed to patch ${file}: ${err.message}`);
    }
  }

  console.log(`[patcher] patched ${patched}, skipped ${skipped} (already up-to-date)`);
  return patched;
}
