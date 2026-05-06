import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { downloadBuffer, ensureDir, writeJson } from "./utils.mjs";

export async function buildBundles({ catalog, distDir, workDir, dosboxTemplatePath, existingEntries = [] }) {
  await ensureDir(distDir);
  await ensureDir(workDir);
  const dosboxTemplate = await fs.readFile(dosboxTemplatePath, "utf8");
  const existingByUrl = new Map(existingEntries.map(e => [e.sourceUrl, e]));
  const manifest = [];
  let skipped = 0;

  for (const entry of catalog) {
    if (!entry.sourceDownloadUrl) {
      manifest.push({ ...entry, status: "metadata-only", metadataOnly: true });
      continue;
    }

    const bundleName = `${entry.id}.jsdos`;
    const bundlePath = path.join(distDir, bundleName);

    if (existingByUrl.has(entry.sourceUrl)) {
      try {
        await fs.access(bundlePath);
        manifest.push({ ...entry, bundleName, bundlePath, metadataOnly: false, status: "bundled" });
        skipped++;
        continue;
      } catch { /* bundle missing on disk, fall through to rebuild */ }
    }

    try {
      const archiveBytes = await downloadBuffer(entry.sourceDownloadUrl);
      const sourceZip = new AdmZip(archiveBytes);

      const bundleZip = new AdmZip();
      bundleZip.addFile(".jsdos/dosbox.conf", Buffer.from(dosboxTemplate, "utf8"));

      sourceZip.getEntries().forEach(sourceEntry => {
        if (sourceEntry.isDirectory) return;
        const safeName = sourceEntry.entryName.replace(/^\/+/, "");
        bundleZip.addFile(`GAME/${safeName}`, sourceEntry.getData());
      });

      bundleZip.writeZip(bundlePath);

      manifest.push({
        ...entry,
        bundleName,
        bundlePath,
        metadataOnly: false,
        status: "bundled"
      });
    } catch (error) {
      manifest.push({
        ...entry,
        metadataOnly: true,
        status: "failed",
        failureReason: String(error.message || error)
      });
    }
  }

  console.log(`[builder] skipped ${skipped} already-bundled entries`);

  await writeJson(path.join(workDir, "bundle-manifest.json"), manifest);
  return manifest;
}
