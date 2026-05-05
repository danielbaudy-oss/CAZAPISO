// Build Fotocasa search URLs from a casahunt filter.
//
// Fotocasa URL structure:
//   https://www.fotocasa.es/es/alquiler/viviendas/barcelona-capital/<neighborhood>/l
//   https://www.fotocasa.es/es/alquiler/viviendas/barcelona-capital/todas-las-zonas/l
//   https://www.fotocasa.es/es/alquiler/viviendas/madrid-capital/<neighborhood>/l
//
// Filters are query params:
//   ?maxPrice=1500&minPrice=800&minRooms=2&minSurface=60&maxSurface=120

import { FOTOCASA_NEIGHBORHOODS } from "./locations.js";

const BASE = "https://www.fotocasa.es/es/alquiler/viviendas";

// Map city names to Fotocasa city slugs.
const CITY_SLUGS = {
  "barcelona": "barcelona-capital",
  "madrid": "madrid-capital",
  "valencia": "valencia-capital",
  "sevilla": "sevilla-capital",
  "málaga": "malaga-capital",
  "malaga": "malaga-capital",
  "bilbao": "bilbao",
  "zaragoza": "zaragoza-capital",
};

function buildQueryParams(filter) {
  const params = new URLSearchParams();
  if (filter.price_min)   params.set("minPrice", filter.price_min);
  if (filter.price_max)   params.set("maxPrice", filter.price_max);
  if (filter.rooms_min)   params.set("minRooms", filter.rooms_min);
  if (filter.rooms_max)   params.set("maxRooms", filter.rooms_max);
  if (filter.size_min_m2) params.set("minSurface", filter.size_min_m2);
  if (filter.size_max_m2) params.set("maxSurface", filter.size_max_m2);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function citySlugFromLocation(loc) {
  // Try to extract city from display_name or name.
  const dn = (loc.display_name || "").toLowerCase();
  for (const [city, slug] of Object.entries(CITY_SLUGS)) {
    if (dn.includes(city)) return slug;
  }
  // Fallback: if the location itself is a city
  const name = (loc.name || "").toLowerCase();
  for (const [city, slug] of Object.entries(CITY_SLUGS)) {
    if (name.includes(city)) return slug;
  }
  return "barcelona-capital"; // default
}

function neighborhoodSlugFromLocation(loc) {
  // Extract the most specific part of the location name for the URL.
  // e.g. "Sant Martí, Barcelona" → "sant-marti"
  // e.g. "El Poblenou, Sant Martí, Barcelona" → "el-poblenou"
  const name = loc.name || "";
  const firstPart = name.split(",")[0].trim();
  
  // Check if we have a known Fotocasa mapping for this neighborhood
  const slug = slugify(firstPart);
  
  // Look up in our Barcelona mapping first
  for (const [casahuntSlug, fotocasaSlug] of Object.entries(FOTOCASA_NEIGHBORHOODS)) {
    if (casahuntSlug === slug || fotocasaSlug === slug || fotocasaSlug.includes(slug)) {
      return fotocasaSlug;
    }
  }
  
  // Fall back to slugified name
  return slug;
}

export function buildFotocasaUrls(filter, nbRecords) {
  const qs = buildQueryParams(filter);
  const locations = filter.locations || [];

  // If locations are set, use them.
  if (locations.length) {
    const urls = [];
    for (const loc of locations) {
      const citySlug = citySlugFromLocation(loc);
      const nbSlug = neighborhoodSlugFromLocation(loc);
      // If the location is a city-level item, use todas-las-zonas
      const isCity = (loc.type === "city" || loc.type === "municipality" || loc.type === "town");
      const path = isCity ? "todas-las-zonas" : nbSlug;
      urls.push(`${BASE}/${citySlug}/${path}/l${qs}`);
    }
    return urls;
  }

  // Legacy: fall back to old neighborhoods field
  const slugs = filter.neighborhoods || [];
  if (!slugs.length) {
    return [`${BASE}/barcelona-capital/todas-las-zonas/l${qs}`];
  }

  const urls = [];
  for (const slug of slugs) {
    const fc = FOTOCASA_NEIGHBORHOODS[slug];
    if (fc) urls.push(`${BASE}/barcelona-capital/${fc}/l${qs}`);
  }
  return urls.length ? urls : [`${BASE}/barcelona-capital/todas-las-zonas/l${qs}`];
}
