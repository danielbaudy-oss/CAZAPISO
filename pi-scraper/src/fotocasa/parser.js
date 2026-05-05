// Parse Fotocasa search-results HTML (rendered by headless Chromium).
//
// Fotocasa's React-rendered DOM uses <article> cards. After hydration:
//   <article class="@container w-full">
//     <a href="/es/alquiler/vivienda/.../12345678">
//     price in a display-3 text element
//     h3 with the title
//     <ul> with details (rooms, m², floor, etc.)
//     <img> for the photo
//
// The exact class names are Tailwind utility classes and may shift, so we
// rely on structural patterns (article > a[href], h3, ul > li) rather than
// specific class names.

import * as cheerio from "cheerio";

export function parseFotocasaResults(html, baseUrl) {
  const $ = cheerio.load(html);
  const cards = $("article");
  if (cards.length === 0) {
    return { items: [], diagnostics: diagnose($) };
  }

  const out = [];
  cards.each((_, el) => {
    const $el = $(el);
    const item = parseCard($, $el, baseUrl);
    if (item) out.push(item);
  });

  return { items: out, diagnostics: out.length === 0 ? diagnose($) : null };
}

function parseCard($, $el, baseUrl) {
  // Find the main listing link — href contains /es/alquiler/vivienda/ and a numeric ID.
  const link = $el.find("a[href*='/es/alquiler/vivienda/']").first();
  const href = link.attr("href") || "";
  if (!href) return null;

  // ID is the numeric segment before /d at the end: .../181429297/d
  const idMatch = href.match(/\/(\d{5,})\/d/);
  const external_id = idMatch ? idMatch[1] : null;
  if (!external_id) return null;

  // Build clean URL (strip query params like from=list&multimedia=...)
  const cleanHref = href.split("?")[0];
  const url = cleanHref.startsWith("http")
    ? cleanHref
    : `https://www.fotocasa.es${cleanHref}`;

  // Title — usually in an h3.
  const title = ($el.find("h3").first().text() || "").trim() || null;

  // Price — Fotocasa renders price like "1.955 €/mes" or "1.200 €/mes".
  // Try class-based selector first, then fall back to regex on card text.
  let priceText = $el.find("[class*='display']").first().text() ||
                  $el.find("[class*='price']").first().text() || "";
  let price_eur = toInt(priceText);
  if (!price_eur || price_eur > 50000) {
    // Fallback: find "N.NNN €/mes" or "N.NNN €" pattern in the card text.
    // Only match reasonable rental prices (100–15,000 €).
    const cardText = $el.text();
    const priceMatches = [...cardText.matchAll(/([\d.]+)\s*€/g)];
    for (const m of priceMatches) {
      const v = toInt(m[1]);
      if (v && v >= 100 && v <= 15000) { price_eur = v; break; }
    }
  }
  // Final sanity check
  if (price_eur && price_eur > 15000) price_eur = null;

  // Details — rooms, m², floor in <ul><li> items.
  let rooms = null, size_m2 = null;
  $el.find("ul li").each((_, li) => {
    const t = $(li).text().trim().toLowerCase();
    if (!t) return;
    if (rooms == null && /\bhab/.test(t)) rooms = toInt(t);
    else if (size_m2 == null && /m²|m2/.test(t)) size_m2 = toInt(t);
  });

  // Photo.
  const photo_url =
    $el.find("img[src*='fotocasa']").first().attr("src") ||
    $el.find("img[data-src]").first().attr("data-src") ||
    $el.find("img").first().attr("src") ||
    null;

  // Neighborhood from breadcrumb or title — best-effort.
  const neighborhood = null; // Will be inferred from the search URL.

  return {
    source: "fotocasa",
    external_id: String(external_id),
    url,
    title,
    price_eur,
    size_m2,
    rooms,
    neighborhood,
    city: "barcelona",
    photo_url: photo_url && !photo_url.includes("skeleton") ? photo_url : null,
  };
}

function toInt(s) {
  if (!s) return null;
  const m = String(s).replace(/\./g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function diagnose($) {
  const title = $("title").text().trim();
  const isBlocked = /captcha|access denied|blocked|cloudflare/i.test(title) ||
    /captcha|access denied/i.test($("body").text().slice(0, 500));
  const articleCount = $("article").length;
  const sampleArticles = $("article").slice(0, 2).map((_, el) => {
    const $el = $(el);
    return {
      classes: ($el.attr("class") || "").slice(0, 100),
      hasLink: !!$el.find("a[href*='/es/alquiler/']").length,
      hasSkeleton: !!$el.find("[data-panot-component='skeleton']").length,
      textSnippet: $el.text().replace(/\s+/g, " ").trim().slice(0, 200),
    };
  }).get();

  return { pageTitle: title, suspectedBlock: isBlocked, articleCount, sampleArticles };
}
