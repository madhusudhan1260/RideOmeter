/** Extract a join code from a scanned QR / pasted link / typed code. */
export function parseJoinCode(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/(?:ridewave:\/\/join\/|\/j\/)([A-Za-z0-9_-]{4,64})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{4,64}$/.test(s) ? s : null;
}

