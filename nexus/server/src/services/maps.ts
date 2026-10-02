// Free geocoding via OpenStreetMap Nominatim — no API key required

export interface GeoResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  importance: number;
  address: Record<string, string>;
  boundingbox: string[];
}

export interface GeoResponse {
  found: boolean;
  query: string;
  result: GeoResult | null;
  mapUrl: string;
  embedUrl: string;
  directionsUrl: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const HEADERS   = { 'User-Agent': 'NEXUS-AI/1.0 (local multi-agent system)' };

export async function geocode(query: string): Promise<GeoResponse> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1&accept-language=nl`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);

  const data: GeoResult[] = await res.json();

  if (!data.length) {
    return { found: false, query, result: null, mapUrl: '', embedUrl: '', directionsUrl: '' };
  }

  const r = data[0];
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  const zoom = 14;

  return {
    found: true,
    query,
    result: r,
    mapUrl:        `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`,
    embedUrl:      `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.02},${lat - 0.015},${lon + 0.02},${lat + 0.015}&layer=mapnik&marker=${lat},${lon}`,
    directionsUrl: `https://www.openstreetmap.org/directions?to=${lat},${lon}`,
  };
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeoResult | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=nl`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  return res.json();
}
