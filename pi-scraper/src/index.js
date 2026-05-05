// Orchestrator. Per run:
//   1. Fetch enabled filters from casahunt.filters.
//   2. For each filter:
//      a. Build Idealista search URLs (one per neighborhood, or one for city).
//      b. Fetch + parse listings.

// Hard timeout: kill the process after 5 minutes no matter what.
// Prevents zombie processes from piling up when Chromium hangs.
setTimeout(() => {
  console.error(new Date().toISOString(), "HARD TIMEOUT (5 min) — forcing exit");
  process.exit(1);
}, 5 * 60 * 1000).unref();
//      c. Stamp canonical_key.
//      d. Upsert into casahunt.listings_seen (discovers new (source, external_id)).
//      e. For each NEW listing, insert a row in casahunt.notifications
//         keyed by (filter_id, canonical_key). If the insert succeeds we send
//         a Telegram alert; if it's a dup, we skip (cross-source collapse).
//   3. Exit. Cron schedules the next run.

import { config } from "./config.js";
import { db } from "./supabase.js";
import { NEIGHBORHOODS_BCN } from "./neighborhoods.js";
import { buildSearchUrls } from "./idealista/urlBuilder.js";
import { fetchIdealistaHtml } from "./idealista/fetcher.js";
import { parseSearchResults } from "./idealista/parser.js";
import { buildFotocasaUrls } from "./fotocasa/urlBuilder.js";
import { fetchFotocasaHtml } from "./fotocasa/fetcher.js";
import { parseFotocasaResults } from "./fotocasa/parser.js";
import { canonicalKey } from "./dedupe.js";
import { sendPhoto, sendMessage } from "./telegram.js";

function fmtErr(e) {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === "object") {
    try { return JSON.stringify(e); } catch {}
  }
  return String(e);
}

async function main() {
  // Random startup jitter (0–90s) so we don't always hit at exact :00/:15/:30/:45.
  const jitter = Math.floor(Math.random() * 90000);
  log("startup jitter", { ms: jitter });
  await sleep(jitter);

  const startedAt = Date.now();
  log("run start", { dryRun: config.dryRun, useHeadless: config.useHeadless });

  const { data: filters, error } = await db
    .from("filters")
    .select("*")
    .eq("enabled", true);
  if (error) throw error;
  if (!filters?.length) { log("no enabled filters"); return; }

  for (const filter of filters) {
    try {
      await runFilter(filter);
    } catch (e) {
      log("filter failed", { id: filter.id, name: filter.name, err: fmtErr(e) });
    }
    // Delay between filters to avoid triggering anti-bot on rapid sequential requests.
    await sleep(5000 + Math.random() * 5000);
  }

  log("run done", { ms: Date.now() - startedAt });
}

async function runFilter(filter) {
  const srcs = filter.sources || ["idealista"];
  const scraped = [];

  // ── Idealista ──
  // Skip ~2 out of 3 runs to reduce frequency and avoid anti-bot blocks.
  // Effective interval: ~30–45 min instead of 15.
  const skipIdealista = !srcs.includes("idealista") || Math.random() > 0.4;
  if (srcs.includes("idealista") && skipIdealista) {
    log("idealista: skipping this run (rate limiting)");
  }
  if (srcs.includes("idealista") && !skipIdealista) {
    const urls = buildSearchUrls(filter, NEIGHBORHOODS_BCN);
    log("idealista urls", { id: filter.id, name: filter.name, n: urls.length });
    for (const url of urls) {
      try {
        const html = await fetchIdealistaHtml(url);
        const { items, diagnostics } = parseSearchResults(html, url);
        if (!items.length) log("idealista: parse returned 0 items", { url, diagnostics });
        else log("idealista: parsed", { url, n: items.length });
        scraped.push(...items);
      } catch (e) {
        log("idealista: fetch/parse failed", { url, err: fmtErr(e) });
      }
      await sleep(2000 + Math.random() * 2000);
    }
  }

  // ── Fotocasa ──
  if (srcs.includes("fotocasa")) {
    const urls = buildFotocasaUrls(filter, NEIGHBORHOODS_BCN);
    log("fotocasa urls", { id: filter.id, name: filter.name, n: urls.length });
    for (const url of urls) {
      try {
        const html = await fetchFotocasaHtml(url);
        const { items, diagnostics } = parseFotocasaResults(html, url);
        if (!items.length) log("fotocasa: parse returned 0 items", { url, diagnostics });
        else log("fotocasa: parsed", { url, n: items.length });
        scraped.push(...items);
      } catch (e) {
        log("fotocasa: fetch/parse failed", { url, err: fmtErr(e) });
      }
      await sleep(2000 + Math.random() * 2000);
    }
  }

  // Dedupe by (source, external_id) inside this filter's scrape (a listing can
  // appear in multiple neighborhood URLs if it's on a border).
  const byKey = new Map();
  for (const l of scraped) byKey.set(`${l.source}|${l.external_id}`, l);
  const unique = [...byKey.values()].map((l) => ({ ...l, canonical_key: canonicalKey(l) }));

  if (!unique.length) return;

  const newOnes = await upsertAndFindNew(unique, config.dryRun);
  log("new listings", { id: filter.id, n: newOnes.length });

  if (config.dryRun) {
    for (const l of newOnes) log("would notify", { id: l.external_id, url: l.url });
    return;
  }

  for (const l of newOnes) {
    try {
      await notifyIfUnseen(filter, l);
    } catch (e) {
      log("notify failed", { id: l.external_id, err: fmtErr(e) });
    }
  }
}

async function upsertAndFindNew(listings, dryRun = false) {
  // Fetch what we already know.
  const { data: existing, error: exErr } = await db
    .from("listings_seen")
    .select("source, external_id")
    .in("external_id", listings.map((l) => l.external_id));
  if (exErr) throw exErr;
  const known = new Set((existing || []).map((r) => `${r.source}|${r.external_id}`));
  const newOnes = listings.filter((l) => !known.has(`${l.source}|${l.external_id}`));

  if (dryRun) return newOnes;

  // Project to the columns listings_seen actually has; stash the rest in `raw`.
  const now = new Date().toISOString();
  const rows = listings.map((l) => ({
    source:        l.source,
    external_id:   l.external_id,
    url:           l.url,
    title:         l.title,
    price_eur:     l.price_eur,
    size_m2:       l.size_m2,
    rooms:         l.rooms,
    neighborhood:  l.neighborhood,
    city:          l.city,
    photo_url:     l.photo_url,
    lat:           l.lat ?? null,
    lng:           l.lng ?? null,
    address:       l.address ?? null,
    canonical_key: l.canonical_key,
    last_seen_at:  now,
    raw:           l,
  }));
  const { error: upErr } = await db
    .from("listings_seen")
    .upsert(rows, { onConflict: "source,external_id" });
  if (upErr) throw upErr;

  return newOnes;
}

async function notifyIfUnseen(filter, l) {
  // Try to claim this (filter_id, canonical_key) — unique index prevents dup.
  const { error } = await db
    .from("notifications")
    .insert({
      filter_id: filter.id,
      chat_id: filter.chat_id,
      canonical_key: l.canonical_key,
      source: l.source,
      external_id: l.external_id,
    });
  if (error) {
    if (String(error.code) === "23505") {
      log("cross-source dedupe hit", { filter: filter.id, key: l.canonical_key, url: l.url });
      return;
    }
    throw error;
  }

  const price = l.price_eur ? `€${l.price_eur.toLocaleString("es-ES")}` : "—";
  const size  = l.size_m2   ? `${l.size_m2} m²` : "—";
  const rooms = l.rooms     ? `${l.rooms} hab`  : "—";
  const loc   = l.neighborhood || filter.city || "barcelona";
  const sourceName = l.source === "fotocasa" ? "Fotocasa" : "Idealista";
  const caption =
    `<b>${escapeHtml(l.title || "New listing")}</b>\n` +
    `${price} · ${size} · ${rooms}\n` +
    `${escapeHtml(loc)}\n` +
    `<a href="${l.url}">View on ${sourceName}</a>`;

  if (l.photo_url) await sendPhoto(filter.chat_id, l.photo_url, caption);
  else             await sendMessage(filter.chat_id, caption);
  log("notified", { source: l.source, id: l.external_id, chatId: filter.chat_id });
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(...args) {
  const formatted = args.map((a) =>
    typeof a === "object" && a !== null ? JSON.stringify(a) : a
  );
  console.log(new Date().toISOString(), ...formatted);
}

main().catch((e) => { console.error("run failed:", e); process.exit(1); });
