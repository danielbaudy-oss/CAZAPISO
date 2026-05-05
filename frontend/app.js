import { config } from "./config.js";

const SESSION_KEY = "casahunt.session";
const $ = (sel) => document.querySelector(sel);

// ── Session plumbing ────────────────────────────────────────────────────────

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}
function setSession(s) {
  if (!s) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
function show(view) {
  $("#auth").hidden = view !== "auth";
  $("#filters").hidden = view !== "filters";
  $("#settings").hidden = view !== "settings";
  $("#settings-btn").hidden = view === "auth";
}

const fnUrl   = (name) => `${config.supabaseUrl}/functions/v1/${name}`;
const restUrl = (path) => `${config.supabaseUrl}/rest/v1/${path}`;

async function callFn(name, body) {
  const res = await fetch(fnUrl(name), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${config.supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function callRest(path, { method = "GET", body, session } = {}) {
  const res = await fetch(restUrl(path), {
    method,
    headers: {
      "content-type": "application/json",
      "accept-profile": "casahunt",
      "content-profile": "casahunt",
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${config.supabaseAnonKey}`,
      "x-session-token": session?.token || "",
      prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ── Auth ────────────────────────────────────────────────────────────────────

const authMsg = $("#auth-msg");
$("#send-code").addEventListener("click", async () => {
  authMsg.className = "msg"; authMsg.textContent = "";
  try {
    const chat_id = Number($("#chat-id").value);
    if (!chat_id) throw new Error("chat id required");
    await callFn("casahunt-auth-request-code", { chat_id });
    authMsg.textContent = "Code sent to Telegram.";
  } catch (e) { authMsg.className = "msg error"; authMsg.textContent = String(e.message || e); }
});

$("#verify-code").addEventListener("click", async () => {
  authMsg.className = "msg"; authMsg.textContent = "";
  try {
    const chat_id = Number($("#chat-id").value);
    const code = $("#code").value.trim();
    const session = await callFn("casahunt-auth-verify-code", { chat_id, code });
    setSession(session);
    localStorage.setItem("casahunt.chat_id", String(chat_id));
    await renderFilters();
    show("filters");
  } catch (e) { authMsg.className = "msg error"; authMsg.textContent = String(e.message || e); }
});

// ── Settings ────────────────────────────────────────────────────────────────

$("#settings-btn").addEventListener("click", () => {
  const chatId = localStorage.getItem("casahunt.chat_id") || "—";
  const session = getSession();
  $("#settings-chat-id").textContent = chatId;
  $("#settings-connected").hidden = !session;
  $("#settings-disconnected").hidden = !!session;
  show("settings");
});

$("#settings-back").addEventListener("click", async () => {
  const session = getSession();
  if (session && new Date(session.expires_at) > new Date()) {
    await renderFilters();
    show("filters");
  } else show("auth");
});

$("#settings-disconnect").addEventListener("click", () => {
  setSession(null);
  localStorage.removeItem("casahunt.chat_id");
  show("auth");
});

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtPriceRange(f) {
  if (f.price_min && f.price_max) return `€${f.price_min}–${f.price_max}`;
  if (f.price_max) return `≤ €${f.price_max}`;
  if (f.price_min) return `≥ €${f.price_min}`;
  return null;
}
function fmtRoomsRange(f) {
  if (f.rooms_min && f.rooms_max) return `${f.rooms_min}–${f.rooms_max} hab`;
  if (f.rooms_min) return `${f.rooms_min}+ hab`;
  if (f.rooms_max) return `≤${f.rooms_max} hab`;
  return null;
}
function fmtSizeRange(f) {
  if (f.size_min_m2 && f.size_max_m2) return `${f.size_min_m2}–${f.size_max_m2} m²`;
  if (f.size_max_m2) return `≤${f.size_max_m2} m²`;
  if (f.size_min_m2) return `≥${f.size_min_m2} m²`;
  return null;
}

function fmtLocations(f) {
  const locs = f.locations || [];
  if (!locs.length) return "all locations";
  const names = locs.map((l) => l.name || l.display_name || "?");
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function pill(text, { muted = false } = {}) {
  const span = document.createElement("span");
  span.className = "pill" + (muted ? " muted" : "");
  span.textContent = text;
  return span;
}

// ── Filter list ─────────────────────────────────────────────────────────────

function renderFilterRow(f) {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.dataset.id = f.id;

  const main = document.createElement("div");
  main.className = "filter-main";

  const title = document.createElement("div");
  title.className = "filter-name";
  title.textContent = f.name || "(untitled)";
  main.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "filter-summary";

  summary.appendChild(pill((f.sources || []).join(" + "), { muted: false }));
  [fmtPriceRange(f), fmtRoomsRange(f), fmtSizeRange(f)]
    .filter(Boolean)
    .forEach((t) => summary.appendChild(pill(t, { muted: false })));
  summary.appendChild(pill(fmtLocations(f), { muted: true }));

  main.appendChild(summary);
  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "filter-row-actions";

  const edit = document.createElement("button");
  edit.textContent = "Edit";
  edit.className = "green";
  edit.addEventListener("click", () => openEditDialog(f));
  actions.appendChild(edit);

  const del = document.createElement("button");
  del.textContent = "Delete";
  del.className = "danger";
  del.addEventListener("click", () => deleteFilter(f.id));
  actions.appendChild(del);

  row.appendChild(actions);
  return row;
}

async function renderFilters() {
  const session = getSession();
  const list = $("#filters-list");
  list.textContent = "Loading…";
  try {
    const rows = await callRest("filters?select=*&order=id", { session });
    list.innerHTML = "";
    if (!rows.length) {
      const p = document.createElement("p");
      p.className = "msg";
      p.textContent = "No filters yet. Click + New filter to create one.";
      list.appendChild(p);
      return;
    }
    rows.forEach((f) => list.appendChild(renderFilterRow(f)));
  } catch (e) {
    list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "msg error"; p.textContent = e.message;
    list.appendChild(p);
  }
}

// ── Create / delete ─────────────────────────────────────────────────────────

$("#add-filter").addEventListener("click", async () => {
  const session = getSession();
  try {
    const [created] = await callRest("filters", {
      method: "POST",
      body: { name: "new filter", city: "barcelona", sources: ["idealista", "fotocasa"], locations: [] },
      session,
    });
    await renderFilters();
    if (created) openEditDialog(created);
  } catch (e) { alert(e.message); }
});

async function deleteFilter(id) {
  const session = getSession();
  try {
    await callRest(`filters?id=eq.${id}`, { method: "DELETE", session });
    await renderFilters();
  } catch (e) { alert(e.message); }
}

// ── Edit dialog ─────────────────────────────────────────────────────────────

const dlg      = $("#edit-dialog");
const dlgForm  = $("#edit-form");
const dlgTitle = $("#dlg-title");
const dlgMsg   = $("#dlg-msg");

let editingId = null;
let selectedLocations = [];  // array of { name, display_name, osm_id, osm_type, lat, lng, type, country_code }

function openEditDialog(f) {
  editingId = f.id;
  dlgTitle.textContent = `Edit · ${f.name || "filter"}`;
  dlgMsg.textContent = "";

  dlgForm.elements.name.value         = f.name || "";
  dlgForm.elements.price_min.value    = f.price_min   ?? "";
  dlgForm.elements.price_max.value    = f.price_max   ?? "";
  dlgForm.elements.rooms_min.value    = f.rooms_min   ?? "";
  dlgForm.elements.rooms_max.value    = f.rooms_max   ?? "";
  dlgForm.elements.size_min_m2.value  = f.size_min_m2 ?? "";
  dlgForm.elements.size_max_m2.value  = f.size_max_m2 ?? "";

  const srcs = new Set(f.sources || []);
  dlgForm.querySelectorAll('input[name="sources"]').forEach((cb) => { cb.checked = srcs.has(cb.value); });

  selectedLocations = Array.isArray(f.locations) ? [...f.locations] : [];
  renderLocationChips();
  locInput.value = "";
  locDropdown.hidden = true;

  dlg.showModal();
}

dlg.addEventListener("click", (e) => { if (e.target.dataset?.act === "close") dlg.close(); });

dlgForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingId) return;

  const fd = new FormData(dlgForm);
  const patch = {
    name:          (fd.get("name") || "").toString().trim() || "untitled",
    city:          selectedLocations.length ? selectedLocations[0].name : "barcelona",
    enabled:       true,
    price_min:     numOrNull(fd.get("price_min")),
    price_max:     numOrNull(fd.get("price_max")),
    rooms_min:     numOrNull(fd.get("rooms_min")),
    rooms_max:     numOrNull(fd.get("rooms_max")),
    size_min_m2:   numOrNull(fd.get("size_min_m2")),
    size_max_m2:   numOrNull(fd.get("size_max_m2")),
    sources:       fd.getAll("sources"),
    locations:     selectedLocations,
    neighborhoods: [], // deprecated, kept for backward compat
  };

  if (!patch.sources.length) {
    dlgMsg.className = "msg error"; dlgMsg.textContent = "Pick at least one source.";
    return;
  }

  dlgMsg.className = "msg"; dlgMsg.textContent = "Saving…";
  try {
    await callRest(`filters?id=eq.${editingId}`, { method: "PATCH", body: patch, session: getSession() });
    dlg.close();
    await renderFilters();
  } catch (err) { dlgMsg.className = "msg error"; dlgMsg.textContent = err.message; }
});

function numOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Location search (Nominatim-powered) ─────────────────────────────────────

const locWrap     = $("#loc-wrap");
const locInput    = $("#loc-input");
const locChips    = $("#loc-chips");
const locDropdown = $("#loc-dropdown");
let   activeIdx   = -1;
let   searchTimer = null;

function renderLocationChips() {
  locChips.innerHTML = "";
  for (const loc of selectedLocations) {
    locChips.appendChild(makeChip(loc.name, () => {
      selectedLocations = selectedLocations.filter((l) => l.osm_id !== loc.osm_id);
      renderLocationChips();
    }));
  }
}

function makeChip(label, onRemove) {
  const chip = document.createElement("span");
  chip.className = "loc-chip";
  const text = document.createElement("span");
  text.textContent = label;
  chip.appendChild(text);
  const x = document.createElement("button");
  x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Remove");
  x.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
  chip.appendChild(x);
  return chip;
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + "<mark>" + escapeHtml(text.slice(idx, idx + query.length)) + "</mark>" + escapeHtml(text.slice(idx + query.length));
}

async function searchNominatim(query) {
  const q = query.trim();
  if (q.length < 2) return [];

  // Two parallel searches: general + structured (neighbourhood/suburb)
  const generalUrl = `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=12&accept-language=es,en` +
    `&countrycodes=es,pt,it,fr,de,nl,be,at,ch,gb,ie,se,no,dk,fi,pl,cz,hr,gr,ro,hu`;

  // Structured search specifically for neighborhoods/suburbs
  const structuredUrl = `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=6&accept-language=es,en` +
    `&countrycodes=es,pt,it,fr,de,nl,be,at,ch,gb,ie,se,no,dk,fi,pl,cz,hr,gr,ro,hu` +
    `&featuretype=settlement`;

  const headers = { "User-Agent": "cazapiso/1.0 (https://github.com/danielbaudy-oss/CAZAPISO)" };

  const [generalRes, structuredRes] = await Promise.all([
    fetch(generalUrl, { headers }).then((r) => r.ok ? r.json() : []).catch(() => []),
    fetch(structuredUrl, { headers }).then((r) => r.ok ? r.json() : []).catch(() => []),
  ]);

  // Merge results, structured first (more relevant for neighborhoods)
  const all = [...structuredRes, ...generalRes];

  const seen = new Set();
  return all
    .filter((r) => {
      const key = shortName(r).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return r.class === "place" || r.class === "boundary" || r.type === "administrative" ||
        r.addresstype === "quarter" || r.addresstype === "suburb" || r.addresstype === "neighbourhood";
    })
    .slice(0, 8)
    .map((r) => ({
      name: shortName(r),
      display_name: r.display_name,
      osm_id: String(r.osm_id),
      osm_type: r.osm_type,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      type: r.addresstype || r.type || "place",
      country_code: r.address?.country_code || "",
    }));
}

function shortName(r) {
  const parts = [];
  const a = r.address || {};
  
  // For neighbourhood/quarter/suburb results, use that as primary
  const primary = a.neighbourhood || a.quarter || a.suburb || a.borough || a.district ||
                  a.city_district || a.city || a.town || a.village || a.municipality || r.name || "";
  if (primary) parts.push(primary);

  // Add parent context (city)
  const parent = a.city || a.town || a.municipality || "";
  if (parent && parent !== primary) parts.push(parent);
  else {
    const region = a.state || a.county || a.country || "";
    if (region && region !== primary) parts.push(region);
  }

  return parts.join(", ") || r.display_name?.split(",").slice(0, 2).join(",") || "Unknown";
}

function renderLocDropdown(results, query) {
  locDropdown.innerHTML = "";
  activeIdx = results.length ? 0 : -1;

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "loc-empty";
    empty.textContent = query ? "No results." : "";
    locDropdown.appendChild(empty);
    locDropdown.hidden = !query;
    return;
  }

  const alreadySelected = new Set(selectedLocations.map((l) => l.osm_id));

  results.forEach((r, i) => {
    if (alreadySelected.has(r.osm_id)) return;
    const row = document.createElement("div");
    row.className = "loc-result" + (i === activeIdx ? " active" : "");
    row.dataset.idx = i;

    const name = document.createElement("div");
    name.className = "loc-result-name";
    const typeBadge = `<span class="loc-result-type">${r.type}</span>`;
    name.innerHTML = typeBadge + highlight(r.name, query);
    row.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "loc-result-meta";
    meta.textContent = r.display_name?.split(",").slice(1, 4).join(",").trim() || "";
    row.appendChild(meta);

    row.addEventListener("mousedown", (e) => { e.preventDefault(); pickLocation(r); });
    locDropdown.appendChild(row);
  });

  locDropdown.hidden = false;
}

function pickLocation(r) {
  selectedLocations.push(r);
  locInput.value = "";
  renderLocationChips();
  locDropdown.hidden = true;
  locInput.focus();
}

locInput.addEventListener("focus", () => { locWrap.classList.add("focus"); });
locInput.addEventListener("blur", () => {
  locWrap.classList.remove("focus");
  setTimeout(() => { locDropdown.hidden = true; }, 150);
});

locInput.addEventListener("input", (e) => {
  const v = e.target.value;
  if (!v.trim() || v.trim().length < 2) { locDropdown.hidden = true; return; }
  // Debounce: wait 300ms after last keystroke
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try {
      const results = await searchNominatim(v);
      renderLocDropdown(results, v);
    } catch { locDropdown.hidden = true; }
  }, 300);
});

locInput.addEventListener("keydown", (e) => {
  const rows = locDropdown.querySelectorAll(".loc-result");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIdx = Math.min(activeIdx + 1, rows.length - 1);
    rows.forEach((r, i) => r.classList.toggle("active", i === activeIdx));
    rows[activeIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx = Math.max(activeIdx - 1, 0);
    rows.forEach((r, i) => r.classList.toggle("active", i === activeIdx));
    rows[activeIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    if (activeIdx >= 0 && rows[activeIdx]) {
      e.preventDefault();
      rows[activeIdx].dispatchEvent(new MouseEvent("mousedown"));
    }
  } else if (e.key === "Escape") {
    locDropdown.hidden = true;
  } else if (e.key === "Backspace" && !locInput.value && selectedLocations.length) {
    selectedLocations.pop();
    renderLocationChips();
  }
});

locWrap.addEventListener("click", (e) => {
  if (e.target === locWrap || e.target === locChips) locInput.focus();
});

// ── Boot ────────────────────────────────────────────────────────────────────

(async function boot() {
  const session = getSession();
  if (session && new Date(session.expires_at) > new Date()) {
    await renderFilters();
    show("filters");
  } else {
    show("auth");
  }
})();
