import AdmZip from "adm-zip";
import { isPlayableLauncher, toDosName } from "./utils.mjs";

// Autoexec lines written by buildConf() before and after the launcher.
const BOILERPLATE = new Set(["@echo off", "mount c .", "c:", "cd game", "exit"]);

// Finds a GAME/ entry from a DOS path relative to C:\GAME, accepting either
// the real name (any case) or its 8.3 alias (e.g. GT_ASS~1).
function resolveEntry(entries, dosSegments) {
  const matches = (name, want) => name.toUpperCase() === want || toDosName(name) === want;
  let prefix = "GAME/";
  for (const segment of dosSegments.slice(0, -1)) {
    const want = segment.toUpperCase();
    const dir = entries
      .map(e => e.entryName.slice(prefix.length))
      .filter((rest, i) => entries[i].entryName.startsWith(prefix) && rest.includes("/"))
      .map(rest => rest.split("/")[0])
      .find(name => matches(name, want));
    if (!dir) return null;
    prefix += dir + "/";
  }
  const want = dosSegments[dosSegments.length - 1].toUpperCase();
  return entries.find(e => !e.isDirectory && e.entryName.startsWith(prefix) &&
    !e.entryName.slice(prefix.length).includes("/") &&
    matches(e.entryName.slice(prefix.length), want)) || null;
}

// "PE\0\0" at the offset stored in the MZ header marks a Windows (Win32)
// program, which DOSBox cannot run.
function isWindowsExecutable(buf) {
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) return false;
  const peOffset = buf.readUInt32LE(0x3c);
  return peOffset + 4 <= buf.length &&
    buf[peOffset] === 0x50 && buf[peOffset + 1] === 0x45 &&
    buf[peOffset + 2] === 0 && buf[peOffset + 3] === 0;
}

/**
 * Checks whether a .jsdos bundle can start a DOS game: its autoexec must
 * name a real launcher (not an installer/utility or the "could not detect"
 * fallback), the launched file must exist, and an .exe must not be a
 * Windows program. Returns { playable, reason }.
 */
export function inspectBundle(zipOrPath) {
  const zip = typeof zipOrPath === "string" ? new AdmZip(zipOrPath) : zipOrPath;
  const confEntry = zip.getEntry(".jsdos/dosbox.conf");
  if (!confEntry) return { playable: false, reason: "Bundle has no .jsdos/dosbox.conf" };

  const autoexec = confEntry.getData().toString("latin1").split(/\[autoexec\]/i).pop();
  const lines = autoexec.split(/\r?\n/).map(l => l.trim()).filter(l => l && !BOILERPLATE.has(l.toLowerCase()));
  if (!isPlayableLauncher(lines)) {
    return { playable: false, reason: "No playable launcher detected" };
  }

  const entries = zip.getEntries();
  const cwd = [];
  let program = null;
  for (const line of lines) {
    const cd = line.match(/^cd\s+(.+)$/i);
    if (cd) { cwd.push(...cd[1].split("\\").filter(Boolean)); continue; }
    if (/^config\s/i.test(line)) continue;
    program = line.replace(/^call\s+/i, "").split(/\s+/)[0];
  }
  if (!program) return { playable: false, reason: "No launcher command in autoexec" };

  const entry = resolveEntry(entries, [...cwd, program]);
  if (!entry) return { playable: false, reason: `Launcher ${program} not found in bundle` };
  if (/\.exe$/i.test(program) && isWindowsExecutable(entry.getData())) {
    return { playable: false, reason: `${program} is a Windows program` };
  }
  return { playable: true, reason: "" };
}
