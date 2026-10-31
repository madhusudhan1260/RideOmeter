/**
 * Place search via OpenStreetMap Nominatim (free). Usage policy: max 1 request/second,
 * identify the app, no bulk use. For production, self-host Nominatim or Photon.
 */
export type PlaceHit = { name: string; detail: string; lat: number; lng: number };

let last = 0;

export async function searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<PlaceHit[]> {
  if (q.trim().length < 3) return [];
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait) await new Promise<void>(r => setTimeout(() => r(), wait));
  last = Date.now();
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '0' });
  if (near) params.set('viewbox', `${near.lng - 1},${near.lat + 1},${near.lng + 1},${near.lat - 1}`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'RideWave/0.1 (motorcycle group ride app)', 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error('Place search unavailable');
  const rows: any[] = await res.json();
  return rows.map(r => {
    const parts = String(r.display_name).split(',');
    return { name: parts[0].trim(), detail: parts.slice(1, 4).join(',').trim(), lat: Number(r.lat), lng: Number(r.lon) };
  });
}

/** Driving route from the public OSRM demo server (free, fair-use). Returns an encoded polyline. */
export async function routePolyline(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<{ polyline: string; distanceM: number; durationS: number } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=polyline`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const r = j?.routes?.[0];
  return r ? { polyline: r.geometry, distanceM: r.distance, durationS: r.duration } : null;
}
