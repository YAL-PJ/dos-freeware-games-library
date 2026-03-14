import path from "node:path";
import { writeJson } from "./utils.mjs";

export async function generateLibraryJson({ manifest, outputPath, bundleBaseUrl }) {
  const library = manifest.map(entry => {
    const metadataOnly = entry.metadataOnly || !entry.bundleName;
    const downloadUrl = metadataOnly ? "" : `${bundleBaseUrl.replace(/\/$/, "")}/${entry.bundleName}`;
    return {
      id: entry.id,
      title: entry.title,
      year: entry.year,
      genre: entry.genre,
      category: entry.category,
      license: entry.license,
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      sourceDownloadUrl: entry.sourceDownloadUrl,
      metadataOnly,
      status: entry.status,
      downloadUrl,
      tags: entry.tags || []
    };
  });

  await writeJson(outputPath, library);
  return library;
}
