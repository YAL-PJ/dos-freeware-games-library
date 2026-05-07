import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { downloadBuffer, ensureDir, writeJson } from "./utils.mjs";

/**
 * Given file paths relative to the GAME/ directory, finds the best launcher.
 * Returns an array of dosbox autoexec lines (e.g. ["cd SUB", "GAME.EXE"]).
 */
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

      // Derive all directory entries needed, including ancestors of deeply-nested files.
      // The js-dos WASM extractor requires explicit directory entries before writing files.
      const neededDirs = new Set(["GAME/"]);
      sourceZip.getEntries().forEach(sourceEntry => {
        const safeName = sourceEntry.entryName.replace(/^\/+/, "");
        if (!safeName || sourceEntry.isDirectory) return;
        const parts = safeName.split("/");
        for (let depth = 1; depth < parts.length; depth++) {
          neededDirs.add("GAME/" + parts.slice(0, depth).join("/") + "/");
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
