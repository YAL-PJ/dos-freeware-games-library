import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

function detectLauncher(filePaths) {
  const lc = s => s.toLowerCase();
  const rootFiles = filePaths.filter(f => !f.includes("/"));

  if (rootFiles.some(f => lc(f) === "start.bat")) return ["call START.BAT"];
  const rootExe = rootFiles.find(f => lc(f).endsWith(".exe"));
  if (rootExe) return [rootExe.toUpperCase()];
  const rootCom = rootFiles.find(f => lc(f).endsWith(".com"));
  if (rootCom) return [rootCom.toUpperCase()];

  const subdirs = [...new Set(
    filePaths.filter(f => f.includes("/")).map(f => f.split("/")[0])
  )];

  for (const sub of subdirs) {
    const subFiles = filePaths
      .filter(f => f.startsWith(sub + "/"))
      .map(f => f.slice(sub.length + 1))
      .filter(f => !f.includes("/"));

    if (subFiles.some(f => lc(f) === "start.bat"))
      return [`cd ${sub.toUpperCase()}`, "call START.BAT"];
    const subExe = subFiles.find(f => lc(f).endsWith(".exe"));
    if (subExe) return [`cd ${sub.toUpperCase()}`, subExe.toUpperCase()];
    const subCom = subFiles.find(f => lc(f).endsWith(".com"));
    if (subCom) return [`cd ${sub.toUpperCase()}`, subCom.toUpperCase()];
  }

  return ["echo Could not auto-detect launcher. Type DIR to see files."];
}

function buildConf(templateBase, launcherLines) {
  const autoexec = ["@echo off", "mount c .", "c:", "cd GAME", ...launcherLines, "exit"].join("\n");
  return `${templateBase}\n[autoexec]\n${autoexec}\n`;
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

      const launcherLines = detectLauncher(gamePaths);
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
