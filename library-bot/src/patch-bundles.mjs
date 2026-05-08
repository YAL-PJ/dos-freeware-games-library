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
 * When a *WEB.BAT uses the old-style bare 'scaler X' command (not
 * 'config -set render scaler=X'), the bare command may cause js-dos to
 * behave incorrectly (e.g. blank screen, uncapped auto-cycles hang).
 *
 * In that case, parse the SH.BAT the WEB.BAT chains to and inline its
 * commands directly, translating bare DOSBox commands to their proper
 * 'config -set' equivalents. This matches how newer bundles (Warcraft II)
 * already work.
 */
function resolveWebBat(zip, rawLines) {
  if (rawLines.length !== 1) return rawLines;
  const line = rawLines[0];
  if (!/^call .+web\.bat$/i.test(line)) return rawLines;

  const webBatFile = line.slice(5); // strip "call "
  const webBatEntry = findEntry(zip, `GAME/${webBatFile}`);
  if (!webBatEntry) return rawLines;

  const webContent = webBatEntry.getData().toString("utf8");

  // Only intervene for old-style WEB.BATs that use the bare 'scaler' command
  if (!/^\s*scaler\s+\S/mi.test(webContent)) return rawLines;

  // Find the SH/standard BAT the WEB.BAT chains to
  const callMatch = webContent.match(/^\s*call\s+(\S+\.bat)/mi);
  if (!callMatch) return rawLines;

  const shBatFile = callMatch[1].toUpperCase();
  const shBatEntry = findEntry(zip, `GAME/${shBatFile}`);
  if (!shBatEntry) {
    // Can't parse further — fall back to just fixing the scaler
    return ["config -set render scaler=normal2x", `call ${shBatFile}`];
  }

  const shContent = shBatEntry.getData().toString("utf8");
  const result = ["config -set render scaler=normal2x"];

  for (const rawLine of shContent.split(/\r?\n/)) {
    const t = rawLine.trim();
    const lc = t.toLowerCase();

    // Skip comments, echo control, cls, pause, echo messages, cd..
    if (
      !t ||
      lc.startsWith("rem") ||
      lc.startsWith("@") ||
      lc === "cls" ||
      lc === "pause" ||
      lc.startsWith("echo") ||
      lc === "cd.." ||
      lc === "cd .." ||
      lc.startsWith("@echo")
    ) continue;

    // Translate bare 'aspect X' → config -set render aspect=X
    const aspectMatch = t.match(/^aspect\s+(true|false)$/i);
    if (aspectMatch) {
      result.push(`config -set render aspect=${aspectMatch[1].toLowerCase()}`);
      continue;
    }

    // Translate bare 'cycles ...' → config -set cpu "cycles=..."
    // Also unescape %% → % (batch file escaping)
    if (/^cycles\s+/i.test(t)) {
      const rest = t.replace(/^cycles\s+/i, "").replace(/%%/g, "%");
      result.push(`config -set cpu "cycles=${rest}"`);
      continue;
    }

    // Keep: cd, .exe/.com, loadfix
    if (
      /^cd\s+\S/i.test(t) ||
      /\.(exe|com)(\s|$)/i.test(t) ||
      /^loadfix\s/i.test(t)
    ) {
      result.push(t.toUpperCase());
    }
  }

  return result;
}

/**
 * Patches every existing .jsdos bundle in-place:
 *  1. Detects the game launcher from GAME/ file listing.
 *  2. Writes a new dosbox.conf with the exact launcher command (no FOR loops).
 *  3. Adds any missing directory entries so js-dos WASM extractor works.
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

      // 1. Detect launcher from GAME/ files in this bundle
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

      // 3. Add any missing directory entries under GAME/
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
