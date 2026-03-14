import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { ensureDir, writeJson } from "./utils.mjs";

async function downloadFile(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function buildBundles({ catalog, distDir, workDir, dosboxTemplatePath }) {
  await ensureDir(distDir);
  await ensureDir(workDir);
  const dosboxTemplate = await fs.readFile(dosboxTemplatePath, "utf8");
  const manifest = [];

  for (const entry of catalog) {
    if (!entry.sourceDownloadUrl) {
      manifest.push({ ...entry, status: "metadata-only", metadataOnly: true });
      continue;
    }

    try {
      const archiveBytes = await downloadFile(entry.sourceDownloadUrl);
      const sourceZip = new AdmZip(archiveBytes);

      const bundleZip = new AdmZip();
      bundleZip.addFile(".jsdos/dosbox.conf", Buffer.from(dosboxTemplate, "utf8"));

      sourceZip.getEntries().forEach(sourceEntry => {
        if (sourceEntry.isDirectory) return;
        const safeName = sourceEntry.entryName.replace(/^\/+/, "");
        bundleZip.addFile(`GAME/${safeName}`, sourceEntry.getData());
      });

      const bundleName = `${entry.id}.jsdos`;
      const bundlePath = path.join(distDir, bundleName);
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

  await writeJson(path.join(workDir, "bundle-manifest.json"), manifest);
  return manifest;
}
