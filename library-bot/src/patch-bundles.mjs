import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

/**
 * Patches every existing .jsdos bundle in-place:
 *  1. Replaces .jsdos/dosbox.conf with the current template.
 *  2. Adds any missing directory entries under GAME/ so the js-dos
 *     WASM extractor can create subdirectories before writing files.
 */
export async function patchBundles({ bundlesDir, dosboxTemplatePath }) {
  const template = await fs.readFile(dosboxTemplatePath, "utf8");

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

      // 1. Fix dosbox.conf
      const confEntry = zip.getEntry(".jsdos/dosbox.conf");
      if (confEntry) {
        const current = confEntry.getData().toString("utf8");
        if (current !== template) {
          zip.updateFile(".jsdos/dosbox.conf", Buffer.from(template, "utf8"));
          changed = true;
        }
      }

      // 2. Ensure directory entries exist for every path under GAME/
      const entries = zip.getEntries();
      const existingPaths = new Set(entries.map(e => e.entryName));

      const neededDirs = new Set(["GAME/"]);
      entries.forEach(entry => {
        if (!entry.entryName.startsWith("GAME/")) return;
        const parts = entry.entryName.split("/");
        // e.g. GAME/SUB/FILE.EXE -> need GAME/ and GAME/SUB/
        for (let i = 1; i < parts.length; i++) {
          const dir = parts.slice(0, i).join("/") + "/";
          neededDirs.add(dir);
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
