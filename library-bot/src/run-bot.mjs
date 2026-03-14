import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeDosGamesArchive } from "./scrape-dosgames.mjs";
import { buildBundles } from "./build-bundles.mjs";
import { generateLibraryJson } from "./generate-library-json.mjs";
import { publishBundlesToRepo } from "./publish-library-repo.mjs";
import { readJson } from "./utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const botRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(botRoot, "..", "..");

const modeArg = process.argv.find(arg => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.split("=")[1] : "all";

const catalogPath = process.env.CPLAY_CATALOG_PATH || path.join(botRoot, "work", "catalog.json");
const workDir = process.env.CPLAY_WORK_DIR || path.join(botRoot, "work");
const distDir = process.env.CPLAY_DIST_DIR || path.join(botRoot, "dist");
const libraryOutputPath = process.env.CPLAY_LIBRARY_JSON || path.join(repoRoot, "library.json");
const libraryRepoPath = process.env.CPLAY_LIBRARY_REPO_PATH || "";
const bundleBaseUrl = process.env.CPLAY_BUNDLE_BASE_URL || "https://raw.githubusercontent.com/YAL-PJ/dos-freeware-games-library/main/bundles";
const dosboxTemplatePath = path.join(botRoot, "templates", "dosbox.conf");
const starterSeedPath = path.join(botRoot, "seeds", "starter-catalog.json");

async function run() {
  let catalog = [];
  if (mode === "all" || mode === "scrape") {
    try {
      catalog = await scrapeDosGamesArchive({ outputPath: catalogPath });
      console.log(`[bot] scraped ${catalog.length} legal entries`);
    } catch (error) {
      console.warn(`[bot] scrape failed, using starter seed: ${error.message || error}`);
      catalog = await readJson(starterSeedPath, []);
      if (!catalog.length) throw error;
    }
  } else {
    catalog = await readJson(catalogPath, []);
    if (!catalog.length) throw new Error(`Catalog file is empty: ${catalogPath}`);
  }

  let manifest = catalog;
  if (mode === "all" || mode === "build") {
    manifest = await buildBundles({ catalog, distDir, workDir, dosboxTemplatePath });
    console.log(`[bot] built ${manifest.filter(item => item.status === "bundled").length} bundles`);
    await publishBundlesToRepo({ manifest, libraryRepoPath });
  } else if (mode !== "scrape") {
    manifest = await readJson(path.join(workDir, "bundle-manifest.json"), []);
    if (!manifest.length) manifest = catalog;
  }

  if (mode === "all" || mode === "library" || mode === "build") {
    const library = await generateLibraryJson({ manifest, outputPath: libraryOutputPath, bundleBaseUrl });
    console.log(`[bot] wrote ${library.length} records to ${libraryOutputPath}`);
  }
}

run().catch(error => {
  console.error("[bot] failed", error);
  process.exitCode = 1;
});
