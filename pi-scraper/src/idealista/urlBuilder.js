// Build Idealista search URLs from a casahunt filter.
//
// Strategy:
//   - One URL per selected neighborhood. If a district is fully selected, we
//     still iterate per neighborhood (simpler than branching; the cost is ~6
//     requests instead of 1, which is fine at 15-min cadence).
//   - If no neighborhoods selected, one URL for the whole city.
//   - Price/rooms/size encoded via Idealista's con-* path suffixes.
//
// Examples:
//   /alquiler-viviendas/barcelona/sant-marti/el-poblenou/con-precio-hasta_1500,de-dos-habitaciones/
//   /alquiler-viviendas/barcelona-barcelona/con-precio-hasta_1500/
//
// We stick to the Spanish URL form (`alquiler-viviendas`). Catalan works too
// but adds an axis we don't need.

import { IDEALISTA_BASE, paths } from "./locations.js";

const ROOM_SEGMENT = {
  0: "de-un-dormitorio",   // "studio" maps to 0; Idealista treats 0 specially
  1: "de-un-dormitorio",
  2: "de-dos-dormitorios",
  3: "de-tres-dormitorios",
  4: "de-cuatro-dormitorios",
  5: "de-cinco-o-mas-dormitorios",
};

function buildConSegment(filter) {
  const parts = [];
  if (filter.price_max)   parts.push(`precio-hasta_${filter.price_max}`);
  if (filter.price_min)   parts.push(`precio-desde_${filter.price_min}`);
  if (filter.size_min_m2) parts.push(`metros-cuadrados-mas-de_${filter.size_min_m2}`);
  if (filter.size_max_m2) parts.push(`metros-cuadrados-menos-de_${filter.size_max_m2}`);
  // rooms: use min only; Idealista's "X+ rooms" is expressed by picking a single bucket
  if (filter.rooms_min != null) {
    const seg = ROOM_SEGMENT[Math.min(5, Math.max(0, filter.rooms_min))];
    if (seg) parts.push(seg);
  }
  return parts.length ? `con-${parts.join(",")}` : "";
}

function cityPath(filter) {
  // Try to derive from locations
  const locations = filter.locations || [];
  if (locations.length) {
    const dn = (locations[0].display_name || "").toLowerCase();
    if (dn.includes("madrid")) return "madrid-madrid";
    if (dn.includes("valencia")) return "valencia-valencia";
    if (dn.includes("sevilla")) return "sevilla-sevilla";
    if (dn.includes("málaga") || dn.includes("malaga")) return "malaga-malaga";
    if (dn.includes("bilbao")) return "bilbao";
    if (dn.includes("barcelona")) return "barcelona-barcelona";
  }
  return "barcelona-barcelona";
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Given a filter row + the list of neighborhood records from neighborhoods.js
 * (for district lookup), return an array of absolute Idealista search URLs.
 */
export function buildSearchUrls(filter, nbRecords) {
  const con = buildConSegment(filter);
  const tail = con ? `/${con}/` : "/";
  const locations = filter.locations || [];

  // New path: use locations field
  if (locations.length) {
    const urls = [];
    for (const loc of locations) {
      const isCity = (loc.type === "city" || loc.type === "municipality" || loc.type === "town");
      if (isCity) {
        // City-level: use the city path
        urls.push(`${IDEALISTA_BASE}/alquiler-viviendas/${cityPath(filter)}${tail}`);
      } else {
        // District/neighborhood: try to build a specific path
        const name = (loc.name || "").split(",")[0].trim();
        const slug = slugify(name);
        
        // Check if we have a known mapping (try both the slug and common variants)
        const byCasahuntSlug = new Map(nbRecords.map((n) => [n.slug, n]));
        const n = byCasahuntSlug.get(slug);
        if (n) {
          const p = paths(slug, n.district);
          if (p) {
            urls.push(`${IDEALISTA_BASE}/alquiler-viviendas/barcelona/${p.district}/${p.neighborhood}${tail}`);
            continue;
          }
        }
        
        // Try without "el-", "la-", "les-", "l-" prefix (common in Catalan names)
        const stripped = slug.replace(/^(el-|la-|les-|l-|els-)/, "");
        const n2 = byCasahuntSlug.get(stripped);
        if (n2) {
          const p = paths(stripped, n2.district);
          if (p) {
            urls.push(`${IDEALISTA_BASE}/alquiler-viviendas/barcelona/${p.district}/${p.neighborhood}${tail}`);
            continue;
          }
        }

        // Check display_name for district info
        const dn = (loc.display_name || "").toLowerCase();
        let district = null;
        for (const nb of nbRecords) {
          const dSlug = slugify(nb.district);
          if (dn.includes(nb.district.toLowerCase()) || dn.includes(dSlug)) {
            district = dSlug;
            break;
          }
        }
        
        if (district) {
          urls.push(`${IDEALISTA_BASE}/alquiler-viviendas/barcelona/${district}/${slug}${tail}`);
        } else {
          urls.push(`${IDEALISTA_BASE}/alquiler-viviendas/barcelona/${slug}${tail}`);
        }
      }
    }
    return urls.length ? urls : [`${IDEALISTA_BASE}/alquiler-viviendas/${cityPath(filter)}${tail}`];
  }

  // Legacy: fall back to old neighborhoods field
  const slugs = filter.neighborhoods || [];
  if (!slugs.length) {
    return [`${IDEALISTA_BASE}/alquiler-viviendas/${cityPath(filter)}${tail}`];
  }

  const byCasahuntSlug = new Map(nbRecords.map((n) => [n.slug, n]));
  const urls = [];
  for (const slug of slugs) {
    const n = byCasahuntSlug.get(slug);
    if (!n) continue;
    const p = paths(slug, n.district);
    if (!p) continue;
    urls.push(`${IDEALISTA_BASE}/alquiler-viviendas/barcelona/${p.district}/${p.neighborhood}${tail}`);
  }
  return urls.length ? urls : [`${IDEALISTA_BASE}/alquiler-viviendas/${cityPath(filter)}${tail}`];
}
