import * as cheerio from "cheerio";
import slugify from "slugify";
import { fetchHtml, isLegalLicense, normalizeLicense, wait, writeJson } from "./utils.mjs";

const BASE_URL = "https://www.dosgamesarchive.com";

const LIST_PAGES = [
  { license: "Freeware", url: `${BASE_URL}/license/freeware` },
  { license: "Shareware", url: `${BASE_URL}/license/shareware` }
];

function parseYear(text = "") {
  const match = String(text).match(/\d{4}/);
  const year = Number(match?.[0]);
  return Number.isFinite(year) && year >= 1980 && year <= 2030 ? year : null;
}

function pickGenre(text = "") {
  return text.split(",").map(v => v.trim()).filter(Boolean)[0] || "Other";
}

function resolveUrl(href, base) {
  if (!href) return "";
  try { return new URL(href, base).toString(); } catch { return ""; }
}

async function discoverAllGameLinks(listPageUrl, license, throttleMs) {
  const gameLinks = new Map();

  // discover total pages from page 1
  console.log(`[scraper] fetching ${license} page 1`);
  const firstHtml = await fetchHtml(listPageUrl);
  const $first = cheerio.load(firstHtml);

  // extract games from page 1
  $first('a[href^="/download/"]').each((_, anchor) => {
    const href = $first(anchor).attr("href");
    const title = $first(anchor).text().trim();
    if (!href || !title || title.length < 2) return;
    const url = resolveUrl(href, BASE_URL);
    if (url && !gameLinks.has(url)) {
      gameLinks.set(url, title);
    }
  });

  // find max page number from pagination links
  let maxPage = 1;
  $first('a[href*="page="]').each((_, el) => {
    const href = $first(el).attr("href") || "";
    const pageMatch = href.match(/page=(\d+)/);
    if (pageMatch) {
      const p = Number(pageMatch[1]);
      if (p > maxPage) maxPage = p;
    }
  });

  console.log(`[scraper] ${license}: ${gameLinks.size} games on page 1, ${maxPage} pages total`);

  // fetch remaining pages
  for (let page = 2; page <= maxPage; page++) {
    await wait(throttleMs);
    const pageUrl = `${listPageUrl}?l=1&page=${page}`;
    console.log(`[scraper] fetching ${license} page ${page}/${maxPage}`);
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      $('a[href^="/download/"]').each((_, anchor) => {
        const href = $(anchor).attr("href");
        const title = $(anchor).text().trim();
        if (!href || !title || title.length < 2) return;
        const url = resolveUrl(href, BASE_URL);
        if (url && !gameLinks.has(url)) {
          gameLinks.set(url, title);
        }
      });
    } catch (err) {
      console.warn(`[scraper] failed to fetch page ${page}: ${err.message}`);
    }
  }

  return gameLinks;
}

async function resolveDownloadUrl(detailUrl, $, throttleMs) {
  // look for /file/{slug}/{filename} links on the detail page
  const fileLinks = [];
  $('a[href^="/file/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.match(/^\/file\.php/)) {
      fileLinks.push(resolveUrl(href, BASE_URL));
    }
  });

  if (!fileLinks.length) return "";

  // visit the first file page to get the file.php?id= download URL
  try {
    await wait(throttleMs);
    const fileHtml = await fetchHtml(fileLinks[0]);
    const $f = cheerio.load(fileHtml);
    const downloadLink = $f('a[href^="/file.php?id="]').first().attr("href");
    if (downloadLink) {
      return resolveUrl(downloadLink, BASE_URL);
    }
  } catch { /* fall through */ }

  return fileLinks[0];
}

function extractScreenshot($) {
  const thumb =
    $('img[src*="image.dosgamesarchive.com/screenshots/thumbnails/"]').first().attr("src") ||
    $('img[src*="image.dosgamesarchive.com/screenshots/"]').first().attr("src") ||
    "";
  return thumb;
}

export async function scrapeDosGamesArchive({ outputPath, throttleMs = 300, existingEntries = [] }) {
  const existingByUrl = new Map(existingEntries.map(e => [e.sourceUrl, e]));
  const entries = [];
  let skipped = 0;

  for (const listPage of LIST_PAGES) {
    const gameLinks = await discoverAllGameLinks(listPage.url, listPage.license, throttleMs);
    console.log(`[scraper] found ${gameLinks.size} ${listPage.license} game links total`);

    let processed = 0;
    for (const [detailUrl, titleFromList] of gameLinks.entries()) {
      processed++;
      if (processed % 50 === 0) {
        console.log(`[scraper] processing ${listPage.license} game ${processed}/${gameLinks.size}`);
      }

      if (existingByUrl.has(detailUrl)) {
        entries.push(existingByUrl.get(detailUrl));
        skipped++;
        continue;
      }

      await wait(throttleMs);
      try {
        const detailHtml = await fetchHtml(detailUrl);
        const $$ = cheerio.load(detailHtml);

        const title = $$("h1").first().text().trim() || titleFromList;
        const genre = pickGenre($$('a[href^="/category/"]').first().text().trim());
        const year = parseYear($$('a[href^="/year/"]').first().text().trim());
        const screenshot = extractScreenshot($$);
        const sourceDownloadUrl = await resolveDownloadUrl(detailUrl, $$, throttleMs);

        const slug = slugify(title, { lower: true, strict: true }) ||
          slugify(detailUrl.split("/").filter(Boolean).pop() || "game", { lower: true, strict: true });

        const entry = {
          id: slug,
          title,
          year,
          genre,
          category: genre.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "other",
          license: listPage.license,
          source: "dosgamesarchive",
          sourceUrl: detailUrl,
          sourceDownloadUrl,
          screenshot,
          tags: [normalizeLicense(listPage.license), "dos", "auto-discovered"],
          metadataOnly: !sourceDownloadUrl
        };

        if (isLegalLicense(entry.license)) {
          entries.push(entry);
        }
      } catch (err) {
        console.warn(`[scraper] failed to scrape ${detailUrl}: ${err.message}`);
      }
    }
  }

  console.log(`[scraper] skipped ${skipped} already-known entries`);

  const deduped = Object.values(Object.fromEntries(entries.map(entry => [entry.id, entry])));
  console.log(`[scraper] total unique entries: ${deduped.length}`);
  await writeJson(outputPath, deduped);
  return deduped;
}
