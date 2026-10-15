import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { downloadBuffer, ensureDir, writeJson, detectLauncher, isPlayableLauncher } from "./utils.mjs";
import { inspectBundle } from "./inspect-bundle.mjs";

// Manifest record for an entry whose bundle file exists. Bundles that cannot
// start a DOS game (no launcher, missing file, Windows program) stay in the
// repo but are listed as info-only, so players never get a dead launch.
export function bundledEntry(entry, bundleName, bundlePath) {
  const { playable, reason } = inspectBundle(bundlePath);
  if (!playable) {
    return { ...entry, bundleName, bundlePath, metadataOnly: true, status: "unplayable", failureReason: reason };
  }
  const { failureReason, ...rest } = entry;
  return { ...rest, bundleName, bundlePath, metadataOnly: false, status: "bundled" };
}

function buildConf(templateBase, launcherLines) {
  const autoexec = ["@echo off", "mount c .", "c:", "cd GAME", ...launcherLines, "exit"].join("\n");
  return `${templateBase}\n[autoexec]\n${autoexec}\n`;
}

export async function buildBundles({ catalog, distDir, workDir, dosboxTemplatePath, bundlesDir, existingEntries = [] }) {
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
    const repoBundlePath = bundlesDir ? path.join(bundlesDir, bundleName) : null;

    if (existingByUrl.has(entry.sourceUrl)) {
      // Check distDir first (local dev cache), then the committed bundles/ dir (CI).
      // On a fresh CI runner distDir is always empty, so this fallback is critical.
      let found = false;
      for (const checkPath of [bundlePath, repoBundlePath].filter(Boolean)) {
        try {
          await fs.access(checkPath);
          manifest.push(bundledEntry(entry, bundleName, checkPath));
          skipped++;
          found = true;
          break;
        } catch { /* try next */ }
      }
      if (found) continue;
    }

    try {
      const archiveBytes = await downloadBuffer(entry.sourceDownloadUrl);
      const sourceZip = new AdmZip(archiveBytes);

      // Collect file paths relative to GAME/ for launcher detection
      const gamePaths = [];
      sourceZip.getEntries().forEach(e => {
        if (!e.isDirectory) gamePaths.push(e.entryName.replace(/^\/+/, ""));
      });
      const readGameFile = rel => {
        const found = sourceZip.getEntries().find(e => e.entryName.replace(/^\/+/, "").toLowerCase() === rel.toLowerCase());
        return found ? found.getData().toString("latin1") : null;
      };
      const launcherLines = detectLauncher(gamePaths, entry.id, readGameFile);

      // Skip games that only have an installer or no detectable launcher —
      // they would crash on launch rather than running the game.
      if (!isPlayableLauncher(launcherLines)) {
        manifest.push({
          ...entry,
          metadataOnly: true,
          status: "installer-only",
          failureReason: "No playable launcher detected (installer-only or unrecognised archive)"
        });
        continue;
      }

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

      manifest.push(bundledEntry(entry, bundleName, bundlePath));
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

  // Preserve previously-bundled games not in this catalog run but whose .jsdos
  // file still exists in the repo. Prevents games from disappearing from the
  // library just because the scraper missed them on a given day.
  if (bundlesDir) {
    const catalogUrls = new Set(catalog.map(e => e.sourceUrl));
    let preserved = 0;
    for (const existing of existingEntries) {
      if (catalogUrls.has(existing.sourceUrl)) continue;
      if (existing.status !== "bundled" && existing.status !== "unplayable") continue;
      const bundleName = `${existing.id}.jsdos`;
      const repoBundlePath = path.join(bundlesDir, bundleName);
      try {
        await fs.access(repoBundlePath);
        manifest.push(bundledEntry(existing, bundleName, repoBundlePath));
        preserved++;
      } catch { /* bundle file gone, let it drop */ }
    }
    if (preserved > 0) console.log(`[builder] preserved ${preserved} existing bundled games not in this catalog`);
  }

  await writeJson(path.join(workDir, "bundle-manifest.json"), manifest);
  return manifest;
}
