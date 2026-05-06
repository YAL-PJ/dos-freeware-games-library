import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

/**
 * Patches the embedded .jsdos/dosbox.conf inside every existing .jsdos bundle
 * without re-downloading source archives. Each .jsdos is a zip file.
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
    try {
      const zip = new AdmZip(filePath);
      const confEntry = zip.getEntry(".jsdos/dosbox.conf");
      if (!confEntry) {
        skipped++;
        continue;
      }
      const current = confEntry.getData().toString("utf8");
      if (current === template) {
        skipped++;
        continue;
      }
      zip.updateFile(".jsdos/dosbox.conf", Buffer.from(template, "utf8"));
      zip.writeZip(filePath);
      patched++;
    } catch (err) {
      console.error(`[patcher] failed to patch ${file}: ${err.message}`);
    }
  }

  console.log(`[patcher] patched ${patched}, skipped ${skipped} (already up-to-date or no conf)`);
  return patched;
}
