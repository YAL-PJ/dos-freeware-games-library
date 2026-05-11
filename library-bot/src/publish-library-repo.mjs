import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./utils.mjs";

export async function publishBundlesToRepo({ manifest, libraryRepoPath }) {
  if (!libraryRepoPath) return;
  const bundleDir = path.join(libraryRepoPath, "bundles");
  await ensureDir(bundleDir);

  for (const entry of manifest) {
    if (!entry.bundlePath || entry.metadataOnly) continue;
    const targetPath = path.join(bundleDir, entry.bundleName);
    // Skip if the bundle is already in place (preserved from a previous run)
    if (path.resolve(entry.bundlePath) === path.resolve(targetPath)) continue;
    await fs.copyFile(entry.bundlePath, targetPath);
  }
}
