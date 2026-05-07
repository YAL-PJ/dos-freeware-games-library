import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { downloadBuffer, ensureDir, writeJson, detectLauncher } from "./utils.mjs";

function buildConf(templateBase, launcherLines) {
  const autoexec = ["@echo off", "mount c .", "c:", "cd GAME", ...launcherLines, "exit"].join("\n");
  return `${templateBase}\n[autoexec]\n${autoexec}\n`;
}

export async function buildBundles({ catalog, distDir, workDir, dosboxTemplatePath, existingEntries = [] }) {
  await ensureDir(distDir);
  await ensureDir(workDir);
  const dosboxTemplateBase = await fs.readFile(dosboxTemplatePath, "utf8");
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

      // Collect file paths relative to GAME/ for launcher detection
      const gamePaths = [];
      sourceZip.getEntries().forEach(e => {
        if (!e.isDirectory) gamePaths.push(e.entryName.replace(/^\/+/, ""));
      });
      const launcherLines = detectLauncher(gamePaths);
      const dosboxConf = buildConf(dosboxTemplateBase, launcherLines);

      const bundleZip = new AdmZip();
      bundleZip.addFile(".jsdos/dosbox.conf", Buffer.from(dosboxConf, "utf8"));

      // Collect all directory entries needed for the js-dos WASM extractor.
      // Two sources: explicit dir entries from the source zip (preserves empty dirs),
      // and all ancestor directories derived from file paths (handles zips that omit
      // directory entries, e.g. WAR2/WAR2.EXE with no WAR2/ entry).
      const neededDirs = new Set(["GAME/"]);
      sourceZip.getEntries().forEach(sourceEntry => {
        const safeName = sourceEntry.entryName.replace(/^\/+/, "");
        if (!safeName) return;
        if (sourceEntry.isDirectory) {
          neededDirs.add("GAME/" + safeName);
        } else {
          const parts = safeName.split("/");
          for (let depth = 1; depth < parts.length; depth++) {
            neededDirs.add("GAME/" + parts.slice(0, depth).join("/") + "/");
          }
        }
      });
      for (const dir of neededDirs) {
        bundleZip.addFile(dir, Buffer.alloc(0));
      }

      sourceZip.getEntries().forEach(sourceEntry => {
        const safeName = sourceEntry.entryName.replace(/^\/+/, "");
        if (!safeName || sourceEntry.isDirectory) return;
        bundleZip.addFile(`GAME/${safeName}`, sourceEntry.getData());
      });

      bundleZip.writeZip(bundlePath);

      manifest.push({ ...entry, bundleName, bundlePath, metadataOnly: false, status: "bundled" });
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
