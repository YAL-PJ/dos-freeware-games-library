/* ── A:\GAMES — Library app.js ──────────────────────────────────── */

// ── Configuration ────────────────────────────────────────────────
// The library can load data from multiple sources:
// 1. Standalone: loads ../library.json (served from this repo)
// 2. From CPlay: pass ?library=URL to override the data source
// 3. Embedded: parent can postMessage({ type: "loadLibrary", url })

const params = new URLSearchParams(window.location.search);
const LIBRARY_URL = params.get("library") || "../library.json";
const CPLAY_URL = params.get("cplay") || null;

const PAGE_SIZE = 50;

// ── DOM References ───────────────────────────────────────────────
const dom = {
  gameGrid: document.getElementById("gameGrid"),
  gameSearch: document.getElementById("gameSearch"),
  genreFilters: document.getElementById("genreFilters"),
  decadeFilters: document.getElementById("decadeFilters"),
  licenseFilters: document.getElementById("licenseFilters"),
  statusFilters: document.getElementById("statusFilters"),
  gameSort: document.getElementById("gameSort"),
  randomPlayBtn: document.getElementById("randomPlayBtn"),
  resultsInfo: document.getElementById("resultsInfo"),
  clearFilters: document.getElementById("clearFilters"),
  emptyState: document.getElementById("emptyState"),
  gameStats: document.getElementById("gameStats"),
  openPlayerBtn: document.getElementById("openPlayerBtn"),
};

// ── State ────────────────────────────────────────────────────────
const state = {
  games: [],
  filters: { genre: "all", decade: "all", license: "all", status: "all" },
  sortBy: "name",
  searchQuery: "",
  page: 0,
};

const FALLBACK_ICON = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">' +
  '<rect width="120" height="80" fill="#0d1117"/>' +
  '<rect x="10" y="8" width="100" height="64" fill="#1a1f2e" rx="2"/>' +
  '<text y="48" x="60" text-anchor="middle" font-family="monospace" font-size="14" fill="#333">DOS</text>' +
  '</svg>'
);

// ── Data loading ─────────────────────────────────────────────────

function normalizeEntry(entry) {
  const title = String(entry.title || entry.name || "").trim();
  if (!title) return null;

  const downloadUrl = String(entry.downloadUrl || "").trim();
  const sourceUrl = String(entry.sourceUrl || "").trim();
  const hasBundle = Boolean(downloadUrl);

  return {
    id: entry.id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    source: String(entry.source || "unknown"),
    genre: String(entry.genre || "Other"),
    category: String(entry.category || entry.genre || "other").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    year: Number(entry.year) || 0,
    license: String(entry.license || "Unknown"),
    screenshot: String(entry.screenshot || ""),
    sourceUrl,
    downloadUrl,
    hasBundle,
    metadataOnly: Boolean(entry.metadataOnly),
    status: entry.status || (hasBundle ? "bundled" : "metadata-only"),
    tags: entry.tags || []
  };
}

async function loadLibrary(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("library.json is not an array");
    return data.map(normalizeEntry).filter(Boolean);
  } catch (err) {
    console.error("[AGAMES] Failed to load library:", err);
    return [];
  }
}

// ── Filtering & sorting ──────────────────────────────────────────

function getDecade(year) {
  if (!year || year < 1980) return "Other";
  return `${Math.floor(year / 10) * 10}s`;
}

function buildFilterOptions() {
  const genres = new Set();
  const decades = new Set();
  const licenses = new Set();

  state.games.forEach(g => {
    if (g.genre) genres.add(g.genre);
    if (g.year) decades.add(getDecade(g.year));
    if (g.license) licenses.add(g.license);
  });

  renderFilterChips(dom.genreFilters, "genre", [...genres].sort());
  renderFilterChips(dom.decadeFilters, "decade", [...decades].sort());
  renderFilterChips(dom.licenseFilters, "license", [...licenses].sort());
  renderFilterChips(dom.statusFilters, "status", ["Playable", "Info Only"]);
}

function renderFilterChips(container, filterKey, options) {
  if (!container) return;
  container.innerHTML = "";

  const allBtn = createChip("All", filterKey, "all");
  container.appendChild(allBtn);

  options.forEach(opt => {
    container.appendChild(createChip(opt, filterKey, opt));
  });
}

function createChip(label, filterKey, value) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `chip ${state.filters[filterKey] === value ? "active" : ""}`;
  btn.textContent = label;
  btn.addEventListener("click", () => {
    state.filters[filterKey] = value;
    state.page = 0;
    renderGrid();
    updateFilterChipStates();
  });
  return btn;
}

function updateFilterChipStates() {
  document.querySelectorAll(".chip").forEach(btn => {
    const filterKey = btn.closest("[id$='Filters']")?.id.replace("Filters", "").replace(/([A-Z])/g, m => m.toLowerCase());
    if (!filterKey || !(filterKey in state.filters)) return;
    const value = btn.textContent === "All" ? "all" : btn.textContent;
    btn.classList.toggle("active", state.filters[filterKey] === value);
  });
}

function getFilteredGames() {
  const { genre, decade, license, status } = state.filters;
  const query = state.searchQuery.toLowerCase();

  let games = state.games;

  if (genre !== "all") {
    games = games.filter(g => g.genre === genre);
  }
  if (decade !== "all") {
    games = games.filter(g => getDecade(g.year) === decade);
  }
  if (license !== "all") {
    games = games.filter(g => g.license === license);
  }
  if (status !== "all") {
    if (status === "Playable") {
      games = games.filter(g => g.hasBundle);
    } else {
      games = games.filter(g => !g.hasBundle);
    }
  }
  if (query) {
    games = games.filter(g =>
      g.title.toLowerCase().includes(query) ||
      g.genre.toLowerCase().includes(query) ||
      g.source.toLowerCase().includes(query) ||
      String(g.year).includes(query)
    );
  }

  games.sort((a, b) => {
    switch (state.sortBy) {
      case "year-desc": return (b.year || 0) - (a.year || 0);
      case "year-asc": return (a.year || 0) - (b.year || 0);
      case "genre": return a.genre.localeCompare(b.genre) || a.title.localeCompare(b.title);
      default: return a.title.localeCompare(b.title);
    }
  });

  return games;
}

// ── Game cards ────────────────────────────────────────────────────

function createGameCard(game) {
  const card = document.createElement("article");
  card.className = "game-card";

  // thumbnail
  const thumbWrap = document.createElement("div");
  thumbWrap.className = "card-thumb";
  const img = document.createElement("img");
  img.src = game.screenshot || FALLBACK_ICON;
  img.alt = game.title;
  img.loading = "lazy";
  img.addEventListener("error", () => { img.src = FALLBACK_ICON; }, { once: true });
  thumbWrap.appendChild(img);

  // badge overlay
  if (game.hasBundle) {
    const badge = document.createElement("span");
    badge.className = "card-badge badge-ready";
    badge.textContent = "PLAY";
    thumbWrap.appendChild(badge);
  }

  card.appendChild(thumbWrap);

  // info
  const info = document.createElement("div");
  info.className = "card-info";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = game.title;
  info.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = [game.genre, game.year || "", game.license].filter(Boolean).join(" · ");
  info.appendChild(meta);

  card.appendChild(info);

  // actions
  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (game.hasBundle) {
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "btn-play";
    playBtn.textContent = "Play";
    playBtn.addEventListener("click", e => { e.stopPropagation(); launchGame(game); });
    actions.appendChild(playBtn);
  }

  if (game.sourceUrl) {
    const infoBtn = document.createElement("a");
    infoBtn.href = game.sourceUrl;
    infoBtn.className = "btn-info";
    infoBtn.textContent = "Info";
    infoBtn.target = "_blank";
    infoBtn.rel = "noopener noreferrer";
    infoBtn.addEventListener("click", e => e.stopPropagation());
    actions.appendChild(infoBtn);
  }

  card.appendChild(actions);

  card.addEventListener("click", () => {
    if (game.hasBundle) launchGame(game);
    else if (game.sourceUrl) window.open(game.sourceUrl, "_blank", "noopener,noreferrer");
  });

  return card;
}

// ── Pagination ───────────────────────────────────────────────────

function renderPagination(totalPages) {
  let pager = document.getElementById("pagination");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "pagination";
    pager.className = "pagination";
    dom.gameGrid.insertAdjacentElement("afterend", pager);
  }
  pager.innerHTML = "";

  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "ghost-btn";
  prevBtn.textContent = "← Prev";
  prevBtn.disabled = state.page === 0;
  prevBtn.addEventListener("click", () => { state.page--; renderGrid(); window.scrollTo(0, 0); });
  pager.appendChild(prevBtn);

  const pageInfo = document.createElement("span");
  pageInfo.className = "page-info";
  pageInfo.textContent = `Page ${state.page + 1} of ${totalPages}`;
  pager.appendChild(pageInfo);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "ghost-btn";
  nextBtn.textContent = "Next →";
  nextBtn.disabled = state.page >= totalPages - 1;
  nextBtn.addEventListener("click", () => { state.page++; renderGrid(); window.scrollTo(0, 0); });
  pager.appendChild(nextBtn);
}

// ── Game launch ──────────────────────────────────────────────────

function launchGame(game) {
  if (!game.downloadUrl) return;

  // if we know CPlay's URL, open the game in CPlay
  if (CPLAY_URL) {
    const url = new URL(CPLAY_URL);
    url.searchParams.set("bundle", game.downloadUrl);
    window.open(url.toString(), "_blank", "noopener");
    return;
  }

  // if we're in an iframe, send message to parent (CPlay)
  if (window.parent !== window) {
    window.parent.postMessage({
      type: "launchGame",
      bundleUrl: game.downloadUrl,
      title: game.title
    }, "*");
    return;
  }

  // standalone fallback: open the bundle URL directly
  window.open(game.downloadUrl, "_blank", "noopener,noreferrer");
}

// ── Rendering ────────────────────────────────────────────────────

function renderGrid() {
  const filtered = getFilteredGames();
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const page = Math.min(state.page, Math.max(0, totalPages - 1));
  state.page = page;

  const pageGames = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (dom.gameGrid) {
    dom.gameGrid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    pageGames.forEach(g => fragment.appendChild(createGameCard(g)));
    dom.gameGrid.appendChild(fragment);
  }

  renderPagination(totalPages);

  const playable = filtered.filter(g => g.hasBundle).length;
  if (dom.resultsInfo) {
    dom.resultsInfo.textContent = `${filtered.length} games${playable ? ` · ${playable} playable` : ""}`;
  }

  if (dom.emptyState) {
    dom.emptyState.hidden = filtered.length > 0;
  }

  const hasActiveFilters = Object.values(state.filters).some(v => v !== "all") || state.searchQuery;
  if (dom.clearFilters) {
    dom.clearFilters.hidden = !hasActiveFilters;
  }
}

// kept for external callers (postMessage loadLibrary)
function render() {
  state.page = 0;
  buildFilterOptions();
  renderGrid();
}

function updateStats() {
  if (!dom.gameStats) return;
  const total = state.games.length;
  const playable = state.games.filter(g => g.hasBundle).length;
  dom.gameStats.textContent = `${total} games · ${playable} playable`;
}

// ── Event listeners ──────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function setupEvents() {
  dom.gameSearch?.addEventListener("input", debounce(e => {
    state.searchQuery = e.target.value.trim();
    state.page = 0;
    renderGrid();
  }, 250));

  dom.gameSort?.addEventListener("change", e => {
    state.sortBy = e.target.value;
    state.page = 0;
    renderGrid();
  });

  dom.clearFilters?.addEventListener("click", () => {
    state.filters = { genre: "all", decade: "all", license: "all", status: "all" };
    state.searchQuery = "";
    state.page = 0;
    if (dom.gameSearch) dom.gameSearch.value = "";
    buildFilterOptions();
    renderGrid();
  });

  dom.randomPlayBtn?.addEventListener("click", () => {
    const playable = getFilteredGames().filter(g => g.hasBundle);
    if (!playable.length) {
      const any = getFilteredGames();
      if (any.length) {
        const picked = any[Math.floor(Math.random() * any.length)];
        if (picked.sourceUrl) window.open(picked.sourceUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    launchGame(playable[Math.floor(Math.random() * playable.length)]);
  });

  dom.openPlayerBtn?.addEventListener("click", () => {
    if (CPLAY_URL) {
      window.open(CPLAY_URL, "_blank", "noopener");
    } else {
      window.open("https://yal-pj.github.io/CPlay/", "_blank", "noopener");
    }
  });

  // listen for messages from parent (CPlay iframe integration)
  window.addEventListener("message", e => {
    if (e.data?.type === "loadLibrary" && e.data.url) {
      loadLibrary(e.data.url).then(games => {
        state.games = games;
        updateStats();
        render();
      });
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();
  state.games = await loadLibrary(LIBRARY_URL);
  updateStats();
  render();
  console.log(`[AGAMES] Ready — ${state.games.length} games loaded`);
});
