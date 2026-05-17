import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { detectLauncher, isPlayableLauncher } from "./utils.mjs";

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

// PK\x05\x06 = End of Central Directory record. Its presence near the end of an
// MZ executable indicates a self-extracting ZIP archive (WinZip SE, PKSFX, etc).
// DOSBox can't run these — it would either execute the Windows stub or crash —
// so the bundle has to ship the *contents* of the SFX, not the SFX itself.
function looksLikeSfxZip(buf) {
  if (buf.length < 64) return false;
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) return false; // MZ
  // Scan the last 64KB (max ZIP comment length + EOCD record size).
  const scanFrom = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return true;
    }
  }
  return false;
}

// Read entries from an SFX EXE buffer. Returns null if AdmZip can't parse it.
function readSfxEntries(buf) {
  try {
    const inner = new AdmZip(buf);
    const entries = inner.getEntries();
    if (!entries.length) return null;
    return entries;
  } catch {
    return null;
  }
}

// Predict whether unpacking an SFX would yield a playable bundle. Without this
// check we'd happily unpack installers like Blood's SFX-wrapped INSTALL.EXE,
// trading one broken state for another. The launcher detector is run against
// the post-unpack file list and must come back with a real game launcher.
function wouldYieldPlayableLauncher(zip, sfxEntry, innerEntries) {
  const baseDir = sfxEntry.entryName.slice(0, sfxEntry.entryName.lastIndexOf("/") + 1);
  const gamePaths = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (entry.entryName === sfxEntry.entryName) continue; // sfx is being removed
    if (!entry.entryName.startsWith("GAME/")) continue;
    gamePaths.push(entry.entryName.slice("GAME/".length));
  }
  for (const inner of innerEntries) {
    if (inner.isDirectory) continue;
    const safeName = inner.entryName.replace(/^\/+/, "").replace(/\\/g, "/");
    if (!safeName) continue;
    const fullPath = baseDir + safeName;
    if (!fullPath.startsWith("GAME/")) continue;
    gamePaths.push(fullPath.slice("GAME/".length));
  }
  return isPlayableLauncher(detectLauncher(gamePaths));
}

// Unpack every self-extracting ZIP EXE found under GAME/. Inner files are placed
// alongside the SFX (same directory), the SFX itself is removed. Returns true
// when at least one SFX was unpacked. SFX archives whose contents only contain
// installers/utilities are left alone — unpacking them wouldn't make the bundle
// any more playable.
function unpackSfxArchives(zip) {
  const candidates = zip.getEntries().filter(e =>
    !e.isDirectory &&
    e.entryName.startsWith("GAME/") &&
    e.entryName.toLowerCase().endsWith(".exe")
  );

  let unpacked = false;

  for (const entry of candidates) {
    const data = entry.getData();
    if (!looksLikeSfxZip(data)) continue;

    const inner = readSfxEntries(data);
    if (!inner) continue;

    if (!wouldYieldPlayableLauncher(zip, entry, inner)) continue;

    const baseDir = entry.entryName.slice(0, entry.entryName.lastIndexOf("/") + 1);
    const existing = new Set(zip.getEntries().map(e => e.entryName.toLowerCase()));

    for (const innerEntry of inner) {
      const safeName = innerEntry.entryName.replace(/^\/+/, "").replace(/\\/g, "/");
      if (!safeName) continue;
      const targetPath = baseDir + safeName;
      if (innerEntry.isDirectory) {
        if (!existing.has(targetPath.toLowerCase())) {
          zip.addFile(targetPath, Buffer.alloc(0));
        }
        continue;
      }
      if (existing.has(targetPath.toLowerCase())) continue; // don't overwrite existing files
      zip.addFile(targetPath, innerEntry.getData());
      existing.add(targetPath.toLowerCase());
    }

    zip.deleteFile(entry.entryName);
    unpacked = true;
  }

  return unpacked;
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

      // 0. Unpack any self-extracting ZIP installers shipped as the launcher.
      // These show up as "MZ...PK\x05\x06" — DOSBox can't run them, so we have
      // to place the inner game files into the bundle ourselves.
      if (unpackSfxArchives(zip)) {
        changed = true;
      }

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
