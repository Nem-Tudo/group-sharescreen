"use client";

// Place search for the world maps (see components/WorldMap) — "belo
// horizonte", "tokyo", "rua tal, 123".
//
// Photon rather than Nominatim, even though both are free and keyless and
// both search the same OpenStreetMap data: Nominatim's usage policy
// explicitly asks people not to point autocomplete at it, which is exactly
// what a search box that answers as you type is. Photon exists for that case.
// It also returns country/state names already localized and a bounding box
// per result, which is what lets picking a city frame the whole city instead
// of dropping the viewer on its centroid at whatever zoom they happened to be.
const PHOTON_URL = "https://photon.komoot.io/api/";

// Photon only speaks default/de/en/fr — there is no `lang=pt`, and asking for
// one is a 400, not a silent fallback. "default" returns each place's own
// local name, which for a Portuguese-speaking audience looking up Brazilian
// cities is the right answer anyway.
const RESULT_LIMIT = 6;

export type PlaceResult = {
  // Stable enough to key a list on within one response.
  id: string;
  // "Belo Horizonte"
  name: string;
  // "Minas Gerais, Brasil" — everything after the name, already localized.
  context: string;
  lat: number;
  lng: number;
  // The place's own bounds, when it has any (a city does, a house number
  // doesn't) — [south, west, north, east], ready for Leaflet's fitBounds.
  bounds?: [number, number, number, number];
};

type PhotonFeature = {
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    // [minLon, maxLat, maxLon, minLat] — Photon's own order, which is not
    // anyone else's; see the conversion below.
    extent?: number[];
  };
  geometry?: { coordinates?: number[] };
};

// Everything under the name, in the order someone would say it out loud, with
// the empties dropped and no duplicates (Photon repeats the name in `city`
// for a city result).
function buildContext(props: NonNullable<PhotonFeature["properties"]>): string {
  const parts = [props.city, props.county, props.state, props.country];
  const seen = new Set([props.name?.toLowerCase()]);
  const kept: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(part);
  }
  return kept.join(", ");
}

/**
 * Searches for a place by name. Returns [] for a query too short to be worth
 * asking about, and throws only on a genuine network/HTTP failure — callers
 * show that as "search is unavailable", not "nothing found".
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = `${PHOTON_URL}?q=${encodeURIComponent(trimmed)}&limit=${RESULT_LIMIT}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Falha na busca (status ${res.status})`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  const features = Array.isArray(data.features) ? data.features : [];
  const results: PlaceResult[] = [];
  for (const [index, feature] of features.entries()) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;
    // GeoJSON is [lon, lat] — the opposite of how every other part of this
    // codebase (and Leaflet) orders a coordinate pair.
    if (!props?.name || !Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const extent = props.extent;
    results.push({
      id: `${props.osm_type ?? "?"}${props.osm_id ?? index}-${index}`,
      name: props.name,
      context: buildContext(props),
      lat,
      lng,
      // Photon's extent is [minLon, maxLat, maxLon, minLat]; Leaflet wants
      // south/west/north/east. Getting this wrong produces an inverted box
      // that fitBounds happily accepts and then frames the wrong hemisphere.
      bounds:
        Array.isArray(extent) && extent.length === 4
          ? [extent[3], extent[0], extent[1], extent[2]]
          : undefined,
    });
  }
  return results;
}
