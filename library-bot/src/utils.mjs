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

// Program names (without extension) that are utilities, documentation
// viewers, installers or runtimes rather than the game itself. Matched
// against both executables and batch files.
const NON_GAME_STEM = new RegExp("^(" + [
  // installers / setup / sound configuration
  "install", "installer", "0install", "dinstall", "minst", "setup", "setmain",
  "config", "conf", "configure", "uvconfig", "sbconfig", "setsound", "sound",
  "sndtest", "uninstall", "uninst", "patch", "update", "bootdisk", "vdetect",
  "loadpats", "_isdel", "commit", "makeeval",
  // documentation, catalogs, order forms
  "read\\w*", "help\\w*", "manual", "doc",
  "docs", "casdoc", "info", "demoinfo", "vinfo", "vendor", "catalog",
  "lomaxcat", "order", "register", "regist", "dealers", "list", "view",
  "t17view",
  // archivers and runtimes that need a program argument
  "unzip", "pkunzip", "lha", "deice", "unpack", "brun\\d*", "dos4gw", "dos4gx",
  "dos32a", "cwsdpmi", "ultramid", "delscore",
  // modem/network/multiplayer helpers and batch utilities
  "comio", "modem", "netb\\w*", "ipx", "ipxodi", "ipxsetup", "serial", "choice",
  // level/graphics editors and build scripts
  "\\w*edit", "\\w*editor", "make\\w*",
].join("|") + ")$", "i");

// Program and batch names commonly used as the game's own launcher.
const PREFERRED_STEMS = ["start", "play", "go", "run", "game"];

const stemOf = name => name.replace(/\.[^.]*$/, "").toLowerCase();
const extOf = name => (name.match(/\.([^.]*)$/)?.[1] || "").toLowerCase();
// Windows 95 builds (MDKDEM95.EXE, HOSP95.EXE) do not run under DOS; batch
// files named like SOCCER95.BAT are ordinary DOS launchers.
const isNonGame = name => NON_GAME_STEM.test(stemOf(name)) ||
  (extOf(name) === "exe" && /95$/.test(stemOf(name)));

// DOSBox only exposes 8.3 names to DOS programs. Long names are shown as
// their first six characters plus "~1"; this mirrors that for the first
// (usually only) entry with a given prefix, which is enough for `cd` and
// launching programs from the generated autoexec.
export function toDosName(name) {
  const clean = s => s.toUpperCase().replace(/[^A-Z0-9_\-!#$%&'(){}@^`~]/g, "");
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const fits = stem.length <= 8 && ext.length <= 3 && clean(stem) === stem.toUpperCase() && clean(ext) === ext.toUpperCase();
  if (fits) return name.toUpperCase();
  const shortExt = clean(ext).slice(0, 3);
  return clean(stem).slice(0, 6) + "~1" + (shortExt ? "." + shortExt : "");
}

// True when a program name looks like it belongs to this game, e.g. SEEK.EXE
// for "seek-and-destroy" or SRACER.EXE for "street-racer".
function matchesGameId(name, gameId) {
  if (!gameId) return false;
  const stem = stemOf(name).replace(/[^a-z0-9]/g, "");
  const words = gameId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const compact = words.join("");
  const initials = words.map(w => w[0]).join("");
  if ((initials.length >= 2 && stem === initials) || words.includes(stem)) return true;
  // Short stems (PRE.COM, SF.EXE) match too many ids by prefix alone.
  if (stem.length < 4) return false;
  return compact.startsWith(stem) || stem.startsWith(compact) ||
    words.some(w => w.length >= 4 && stem.startsWith(w));
}

// A batch file is not a usable launcher when it only prints text (e.g.
// "Please type: demo") or bails out to a usage message without arguments
// (e.g. LEMMINGS.BAT expecting "vga"/"ega").
function isUnusableBat(content) {
  if (/^\s*if\s+(not\s+)?"?%1[^=\s]*"?\s*==\s*"?[^"\s%]*"?\s+goto\s+:?(usage|help|syntax|error|err|noparm\w*|instr\w*)\b/im.test(content)) return true;
  return !content.split(/\r?\n/).some(line => {
    const t = line.trim().replace(/^@/, "").toLowerCase();
    return t && !/^(echo\b|echo\.|rem\b|::|cls\b|pause\b|ctty\b)/.test(t);
  });
}

// Picks the best launcher among the files of one directory, or null.
// readFile(relativePath) optionally returns a batch file's text.
function pickLauncher(dir, files, gameId, readFile) {
  const usableBat = f => {
    if (extOf(f) !== "bat" || !readFile) return true;
    const content = readFile(dir ? `${dir}/${f}` : f);
    return content == null || !isUnusableBat(content);
  };
  const runnable = files.filter(f => ["bat", "exe", "com"].includes(extOf(f)) && !isNonGame(f) && usableBat(f));
  const bats = runnable.filter(f => extOf(f) === "bat");
  const programs = runnable.filter(f => extOf(f) !== "bat");

  // DOS Games Archive browser-specific launcher (e.g. WC1WEB.BAT, 0G-BRW.BAT)
  const webBat = bats.find(f => /(web|-brw)$/.test(stemOf(f)));
  if (webBat) return { file: webBat, bat: true };
  for (const name of PREFERRED_STEMS) {
    const bat = bats.find(f => stemOf(f) === name);
    if (bat) return { file: bat, bat: true };
  }
  const namedBat = bats.find(f => matchesGameId(f, gameId));
  if (namedBat) return { file: namedBat, bat: true };
  if (bats.length) return { file: bats[0], bat: true };

  // .exe before .com: small .com files are often loaders or helpers.
  const ordered = [...programs.filter(f => extOf(f) === "exe"), ...programs.filter(f => extOf(f) === "com")];
  const exes = ordered.filter(f => extOf(f) === "exe");
  const named = (exes.length ? exes : ordered).find(f => matchesGameId(f, gameId));
  if (named) return { file: named, bat: false };
  const preferred = PREFERRED_STEMS.map(n => ordered.find(f => stemOf(f) === n)).find(Boolean);
  if (preferred) return { file: preferred, bat: false };
  if (ordered.length) return { file: ordered[0], bat: false };
  return null;
}

function launcherLines(dir, pick) {
  const lines = [];
  if (dir) lines.push(`cd ${dir.split("/").map(toDosName).join("\\")}`);
  const prog = toDosName(pick.file);
  lines.push(pick.bat ? `call ${prog}` : prog);
  return lines;
}

/**
 * Given file paths relative to the GAME/ directory, finds the best launcher.
 * Returns an array of dosbox autoexec lines (e.g. ["cd SUB", "GAME.EXE"]).
 *
 * Directories are searched shallowest first. Within a directory:
 *  1. *web.bat — DOS Games Archive browser-specific launcher
 *  2. start/play/go/run/game.bat
 *  3. a .bat named after the game, then any other game .bat
 *  4. an .exe (then .com) named after the game, then start/play/go/run/game,
 *     then any other game .exe/.com
 * Readme viewers, catalogs, installers, setup and runtime programs are
 * skipped, as are batch files that readFile shows to be unusable. When nothing else exists, the first such program is returned so
 * isPlayableLauncher() can reject it.
 */
export function detectLauncher(filePaths, gameId = "", readFile = null) {
  const byDir = new Map();
  for (const f of filePaths) {
    const i = f.lastIndexOf("/");
    const dir = i < 0 ? "" : f.slice(0, i);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f.slice(i + 1));
  }
  const dirs = [...byDir.keys()].sort((a, b) =>
    (a ? a.split("/").length : 0) - (b ? b.split("/").length : 0));

  for (const dir of dirs) {
    const pick = pickLauncher(dir, byDir.get(dir), gameId, readFile);
    if (pick) return launcherLines(dir, pick);
  }

  for (const dir of dirs) {
    const fallback = byDir.get(dir).find(f => ["bat", "exe", "com"].includes(extOf(f)));
    if (fallback) return launcherLines(dir, { file: fallback, bat: extOf(fallback) === "bat" });
  }

  return ["echo Could not auto-detect launcher. Type DIR to see files."];
}

/**
 * Returns true only when detectLauncher() found a genuine game executable
 * (not an installer, config utility, or undetected fallback).
 *
 * Use this in build-bundles.mjs to avoid shipping bundles that would
 * just launch an installer or print an error message.
 */
export function isPlayableLauncher(launcherLines) {
  if (!launcherLines || !launcherLines.length) return false;
  const lastLine = launcherLines[launcherLines.length - 1].trim();

  // detectLauncher() fell through with no match at all
  if (/^echo\s/i.test(lastLine)) return false;

  // Fallback picked an installer/utility program
  const program = lastLine.replace(/^call\s+/i, "").split(/\s+/)[0];
  return !isNonGame(program);
}

export async function fetchHtml(url) {
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
