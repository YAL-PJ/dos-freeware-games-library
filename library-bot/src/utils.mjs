import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  // try native fetch first, fall back to curl if it fails
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "cplay-library-bot/1.0 (+https://github.com/YAL-PJ/CPlay)",
        accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch {
    // fallback to curl
    const { stdout } = await execFileAsync("curl", [
      "-sL", "--max-time", "30",
      "-H", "User-Agent: cplay-library-bot/1.0 (+https://github.com/YAL-PJ/CPlay)",
      "-H", "Accept: text/html,application/xhtml+xml",
      url
    ], { maxBuffer: 10 * 1024 * 1024 });
    if (!stdout) throw new Error(`Failed to fetch ${url}: empty response`);
    return stdout;
  }
}

export async function downloadBuffer(url) {
  // try native fetch first, fall back to curl
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "cplay-library-bot/1.0 (+https://github.com/YAL-PJ/CPlay)" },
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    const { stdout } = await execFileAsync("curl", [
      "-sL", "--max-time", "60",
      "-H", "User-Agent: cplay-library-bot/1.0 (+https://github.com/YAL-PJ/CPlay)",
      url
    ], { maxBuffer: 50 * 1024 * 1024, encoding: "buffer" });
    if (!stdout || !stdout.length) throw new Error(`Download failed: ${url}`);
    return stdout;
  }
}

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
