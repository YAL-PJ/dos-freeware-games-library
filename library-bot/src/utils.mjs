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

// Executables that are utilities, not the game itself.
const NON_GAME_EXES = new Set([
  "setup.exe", "install.exe", "installer.exe",
  "config.exe", "conf.exe", "configure.exe",
  "uninstall.exe", "uninst.exe",
  "patch.exe", "update.exe",
]);

function pickExe(files) {
  const lc = s => s.toLowerCase();
  // Prefer a game exe over known utility executables
  return files.find(f => lc(f).endsWith(".exe") && !NON_GAME_EXES.has(lc(f)))
    || files.find(f => lc(f).endsWith(".exe"));
}

function pickCom(files) {
  const lc = s => s.toLowerCase();
  return files.find(f => lc(f).endsWith(".com"));
}

/**
 * Given file paths relative to the GAME/ directory, finds the best launcher.
 * Returns an array of dosbox autoexec lines (e.g. ["cd SUB", "GAME.EXE"]).
 */
export function detectLauncher(filePaths) {
  const lc = s => s.toLowerCase();
  const rootFiles = filePaths.filter(f => !f.includes("/"));

  if (rootFiles.some(f => lc(f) === "start.bat")) return ["call START.BAT"];
  const rootExe = pickExe(rootFiles);
  if (rootExe) return [rootExe.toUpperCase()];
  const rootCom = pickCom(rootFiles);
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
    const subExe = pickExe(subFiles);
    if (subExe) return [`cd ${sub.toUpperCase()}`, subExe.toUpperCase()];
    const subCom = pickCom(subFiles);
    if (subCom) return [`cd ${sub.toUpperCase()}`, subCom.toUpperCase()];
  }

  return ["echo Could not auto-detect launcher. Type DIR to see files."];
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
