/* ── A:\GAMES — Library app.js ──────────────────────────────────── */

// ── DOM References ────────────────────────────────────────────────
const dom = {
  gameGrid: document.getElementById("gameGrid"),
  gameSearchInput: document.getElementById("gameSearch"),
  gameQuickFilters: document.getElementById("gameQuickFilters"),
  gameSort: document.getElementById("gameSort"),
  randomPlayBtn: document.getElementById("randomPlayBtn"),
  visibleGamesCount: document.getElementById("visibleGamesCount"),
  instantGamesCount: document.getElementById("instantGamesCount"),
  openPlayerBtn: document.getElementById("openPlayerBtn"),
};

const BASE_GAMES = [
  { id: "doom-shareware", name: "DOOM (Shareware)", source: "js-dos", category: "fps", year: 1993, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://v8.js-dos.com/bundles/doom.jsdos" }] },
  { id: "doom2", name: "DOOM II", source: "dos-zone", category: "fps", year: 1994, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/custom/dos/doom2.jsdos" }] },
  { id: "wolf3d", name: "Wolfenstein 3D", source: "dos-zone", category: "fps", year: 1992, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/original/2X/a/ac888d1660aa253f0ed53bd6c962c894125aaa19.jsdos" }] },
  { id: "heretic", name: "Heretic", source: "dos-zone", category: "fps", year: 1994, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/custom/dos/heretic.jsdos" }] },
  { id: "prince-of-persia", name: "Prince of Persia", source: "dos-zone", category: "platformer", year: 1989, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/original/2X/1/1179a7c9e05b1679333ed6db08e7884f6e86c155.jsdos" }] },
  { id: "digger", name: "Digger", source: "js-dos", category: "arcade", year: 1983, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://v8.js-dos.com/bundles/digger.jsdos" }] },
  { id: "mortal-kombat", name: "Mortal Kombat", source: "dos-zone", category: "fighting", year: 1993, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/original/2X/8/872f3668c36085d0b1ace46872145285364ee628.jsdos" }] },
  { id: "tyrian-2000", name: "Tyrian 2000", source: "dos-zone", category: "shooter", year: 1999, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/custom/dos/tyrian-2000.jsdos" }] },
  { id: "sim-city", name: "SimCity", source: "dos-zone", category: "strategy", year: 1989, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/original/2X/7/744842062905f72648a4d492ccc2526d039b3702.jsdos" }] },
  { id: "nfs-se", name: "Need for Speed: SE", source: "dos-zone", category: "racing", year: 1996, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/custom/dos/nfs.jsdos" }] },
  { id: "lost-vikings", name: "The Lost Vikings", source: "dos-zone", category: "puzzle", year: 1992, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/original/2X/1/1b063b2520052ebb504184667ac95e72423331de.jsdos" }] },
  { id: "out-of-this-world", name: "Out of This World", source: "dos-zone", category: "cinematic", year: 1991, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/original/2X/1/1031eb810e8b648fc5f777b3bd9cbc0187927fd4.jsdos" }] },
  { id: "gta", name: "Grand Theft Auto", source: "dos-zone", category: "action", year: 1997, instantPlay: true, icon: "", links: [{ type: "jsdos", label: "Play", url: "https://cdn.dos.zone/custom/dos/gta-mobile.jsdos" }] },
];

const QUICK_FILTERS = [
  { id: "all", label: "All", predicate: () => true },
  { id: "instant", label: "1-Click", predicate: g => g.instantPlay },
  { id: "fps", label: "FPS", predicate: g => g.category === "fps" },
  { id: "racing", label: "Racing", predicate: g => g.category === "racing" },
  { id: "retro", label: "80s/90s", predicate: g => g.year <= 1995 },
];

const FALLBACK_ICON = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#111"/><text y="50%" x="50%" dominant-baseline="middle" text-anchor="middle" font-size="50" fill="#333">?</text></svg>');

const state = { activeFilter: "all", sortBy: "name" };
let allGames = [...BASE_GAMES];

const getPlayableLink = game => game.links.find(link => link.type === "jsdos" || link.type === "zip") || game.links[0];
const log = (...a) => console.log("[AGAMES]", ...a);
const logError = (...a) => console.error("[AGAMES ERROR]", ...a);

// ── Library data ──────────────────────────────────────────────────

function normalizeLibraryEntry(entry) {
  const name = String(entry.title || entry.name || "").trim();
  if (!name) return null;
  const downloadUrl = String(entry.downloadUrl || "").trim();
  const sourceUrl = String(entry.sourceUrl || "").trim();
  const links = [];
  if (downloadUrl) links.push({ type: "jsdos", label: "Play", url: downloadUrl });
  else if (sourceUrl) links.push({ type: "external", label: "Info", url: sourceUrl });
  const id = String(entry.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  return {
    id: id || `game-${Math.random().toString(16).slice(2)}`,
    name,
    source: String(entry.source || "community-library"),
    category: String(entry.category || entry.genre || "other").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "other",
    year: Number(entry.year) || 0,
    instantPlay: Boolean(downloadUrl),
    icon: String(entry.icon || ""),
    links,
    license: entry.license || ""
  };
}

async function loadExternalLibrary() {
  try {
    const response = await fetch("../library.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("library.json is not an array");
    const imported = data.map(normalizeLibraryEntry).filter(Boolean);
    const merged = [...BASE_GAMES];
    const seen = new Set(merged.map(g => g.id));
    imported.forEach(game => { if (!seen.has(game.id)) { seen.add(game.id); merged.push(game); } });
    allGames = merged;
  } catch (error) {
    logError("Failed to load library.json", error);
    allGames = [...BASE_GAMES];
  }
}

// ── Filtering & sorting ──────────────────────────────────────────

function setupFilterUI() {
  if (!dom.gameQuickFilters) return;
  dom.gameQuickFilters.innerHTML = "";
  QUICK_FILTERS.forEach(filter => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `quick-filter ${filter.id === state.activeFilter ? "active" : ""}`;
    btn.textContent = filter.label;
    btn.addEventListener("click", () => { state.activeFilter = filter.id; renderGameGrid(dom.gameSearchInput?.value || ""); });
    dom.gameQuickFilters.appendChild(btn);
  });
}

function getFilteredGames(filterText = "") {
  const query = filterText.toLowerCase().trim();
  const quickFilter = QUICK_FILTERS.find(f => f.id === state.activeFilter) || QUICK_FILTERS[0];
  let games = allGames.filter(g => quickFilter.predicate(g));
  if (query) {
    games = games.filter(g => [g.name, g.source, g.category, String(g.year), ...g.links.map(l => `${l.label} ${l.type}`)].join(" ").toLowerCase().includes(query));
  }
  games.sort((a, b) => {
    if (state.sortBy === "year") return b.year - a.year;
    if (state.sortBy === "source") return a.source.localeCompare(b.source);
    return a.name.localeCompare(b.name);
  });
  return games;
}

// ── Game launch ──────────────────────────────────────────────────

function launchGame(game) {
  const playableLink = getPlayableLink(game);
  if (!playableLink) return;

  if (playableLink.type === "external") {
    window.open(playableLink.url, "_blank", "noopener,noreferrer");
    return;
  }

  // TODO: integrate with C:\PLAY player or embed js-dos here
  // For now, open the bundle URL directly
  window.open(playableLink.url, "_blank", "noopener,noreferrer");
}

// ── Game cards & grid ────────────────────────────────────────────

function createGameCard(game) {
  const card = document.createElement("article"); card.className = "game-card";

  const iconWrap = document.createElement("div"); iconWrap.className = "game-icon-container";
  const img = document.createElement("img"); img.src = game.icon || FALLBACK_ICON; img.className = "game-thumb"; img.alt = game.name + " cover";
  img.addEventListener("error", () => { img.src = FALLBACK_ICON; }, { once: true });
  iconWrap.appendChild(img); card.appendChild(iconWrap);

  const label = document.createElement("span"); label.className = "game-label"; label.textContent = game.name; card.appendChild(label);
  const source = document.createElement("span"); source.className = "game-source"; source.textContent = `${game.source} • ${game.year}`; card.appendChild(source);
  const badge = document.createElement("span"); badge.className = "game-badge " + (game.instantPlay ? "badge-instant" : "badge-manual"); badge.textContent = game.instantPlay ? "Ready" : "Manual"; card.appendChild(badge);

  const playableLink = getPlayableLink(game);
  if (playableLink?.type === "jsdos" || playableLink?.type === "zip") {
    const btnRow = document.createElement("div"); btnRow.className = "game-btn-row";
    const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "play-btn"; playBtn.textContent = "Play";
    playBtn.addEventListener("click", e => { e.stopPropagation(); launchGame(game); });
    btnRow.appendChild(playBtn);
    card.appendChild(btnRow);
  } else if (playableLink?.type === "external") {
    const btnRow = document.createElement("div"); btnRow.className = "game-btn-row";
    const infoBtn = document.createElement("a"); infoBtn.href = playableLink.url; infoBtn.className = "play-btn"; infoBtn.textContent = "Info";
    infoBtn.target = "_blank"; infoBtn.rel = "noopener noreferrer"; infoBtn.addEventListener("click", e => e.stopPropagation());
    btnRow.appendChild(infoBtn);
    card.appendChild(btnRow);
  }

  card.addEventListener("click", () => { launchGame(game); });
  return card;
}

function renderGameGrid(filter = "") {
  if (!dom.gameGrid) return;
  const filtered = getFilteredGames(filter);
  dom.gameGrid.innerHTML = "";
  filtered.forEach(game => dom.gameGrid.appendChild(createGameCard(game)));

  if (dom.visibleGamesCount) dom.visibleGamesCount.textContent = String(filtered.length);
  if (dom.instantGamesCount) dom.instantGamesCount.textContent = String(filtered.filter(g => g.instantPlay).length);
  setupFilterUI();
}

// ── Random play ──────────────────────────────────────────────────

function playRandomGame() {
  const candidates = getFilteredGames(dom.gameSearchInput?.value || "").filter(g => g.instantPlay);
  if (!candidates.length) return;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  launchGame(picked);
}

// ── Event listeners ──────────────────────────────────────────────

function setupEventListeners() {
  dom.gameSearchInput?.addEventListener("input", e => renderGameGrid(e.target.value));
  dom.gameSort?.addEventListener("change", e => { state.sortBy = e.target.value; renderGameGrid(dom.gameSearchInput?.value || ""); });
  dom.randomPlayBtn?.addEventListener("click", playRandomGame);
  dom.openPlayerBtn?.addEventListener("click", () => {
    // TODO: link to actual C:\PLAY URL
    alert("C:\\PLAY player — coming soon as a separate app.");
  });
}

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await loadExternalLibrary();
  renderGameGrid();
  const loadedCount = Math.max(0, allGames.length - BASE_GAMES.length);
  log(`Ready — ${allGames.length} games (${loadedCount} from library.json)`);
});
