import fs from "node:fs/promises";
import path from "node:path";

export const LEGAL_LICENSES = new Set(["freeware", "public-domain", "public domain", "shareware", "demo"]);

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function normalizeLicense(value = "") {
  return String(value).trim().toLowerCase();
}

export function isLegalLicense(value = "") {
  return LEGAL_LICENSES.has(normalizeLicense(value));
}

export async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "cplay-library-bot/1.0 (+https://github.com/YAL-PJ/CPlay)",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
