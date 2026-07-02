/**
 * Canonical SF neighborhoods with approximate centroids, used for
 * neighborhood-level geocode fallback (precision: "neighborhood") and for
 * normalizing the many spellings sources use (especially Craigslist's
 * combined hood names like "SOMA / south beach").
 */

export interface Neighborhood {
  name: string;
  lat: number;
  lng: number;
  aliases: string[];
}

export const SF_NEIGHBORHOODS: Neighborhood[] = [
  { name: "Alamo Square", lat: 37.7764, lng: -122.4346, aliases: [] },
  { name: "Bayview", lat: 37.7299, lng: -122.3865, aliases: ["bayview hunters point", "hunters point"] },
  { name: "Bernal Heights", lat: 37.7399, lng: -122.4166, aliases: ["bernal"] },
  { name: "Castro", lat: 37.7609, lng: -122.435, aliases: ["castro / upper market", "upper market", "the castro", "eureka valley"] },
  { name: "Chinatown", lat: 37.7941, lng: -122.4078, aliases: [] },
  { name: "Civic Center", lat: 37.7793, lng: -122.4193, aliases: ["van ness / civic center", "civic / van ness", "van ness"] },
  { name: "Cole Valley", lat: 37.7657, lng: -122.4498, aliases: ["cole valley / ashbury hts", "ashbury heights", "ashbury hts"] },
  { name: "Cow Hollow", lat: 37.7986, lng: -122.4373, aliases: [] },
  { name: "Diamond Heights", lat: 37.7419, lng: -122.4438, aliases: ["diamond hts"] },
  { name: "Dogpatch", lat: 37.7586, lng: -122.3893, aliases: [] },
  { name: "Downtown", lat: 37.7877, lng: -122.4076, aliases: ["downtown / civic / van ness", "union square"] },
  { name: "Duboce Triangle", lat: 37.7674, lng: -122.4331, aliases: ["duboce"] },
  { name: "Excelsior", lat: 37.7244, lng: -122.4262, aliases: ["excelsior / outer mission"] },
  { name: "Financial District", lat: 37.7946, lng: -122.3999, aliases: ["fidi", "financial district / barbary coast", "barbary coast", "embarcadero"] },
  { name: "Glen Park", lat: 37.7331, lng: -122.4337, aliases: [] },
  { name: "Haight-Ashbury", lat: 37.7692, lng: -122.4463, aliases: ["haight ashbury", "upper haight", "the haight", "haight"] },
  { name: "Hayes Valley", lat: 37.7759, lng: -122.4245, aliases: ["hayes"] },
  { name: "Ingleside", lat: 37.7239, lng: -122.4544, aliases: ["ingleside / sfsu / ccsf", "sfsu", "oceanview", "ocean view"] },
  { name: "Inner Richmond", lat: 37.7803, lng: -122.4646, aliases: ["richmond / seacliff", "richmond district", "seacliff", "sea cliff", "richmond"] },
  { name: "Inner Sunset", lat: 37.7601, lng: -122.4691, aliases: ["inner sunset / ucsf", "ucsf"] },
  { name: "Japantown", lat: 37.7853, lng: -122.4297, aliases: ["japan town"] },
  { name: "Laurel Heights", lat: 37.7856, lng: -122.4483, aliases: ["laurel hts / presidio", "laurel hts", "presidio heights", "jordan park"] },
  { name: "Lower Haight", lat: 37.772, lng: -122.4306, aliases: ["lower haight / fillmore"] },
  { name: "Lower Nob Hill", lat: 37.7885, lng: -122.4143, aliases: [] },
  { name: "Lower Pacific Heights", lat: 37.7867, lng: -122.4362, aliases: ["lower pac hts", "lower pacific hts"] },
  { name: "Marina", lat: 37.8021, lng: -122.4369, aliases: ["marina / cow hollow", "marina district"] },
  { name: "Mission", lat: 37.7599, lng: -122.4148, aliases: ["mission district", "the mission", "inner mission", "mission dolores", "dolores heights"] },
  { name: "Mission Bay", lat: 37.7706, lng: -122.3922, aliases: [] },
  { name: "Nob Hill", lat: 37.793, lng: -122.4161, aliases: [] },
  { name: "Noe Valley", lat: 37.7502, lng: -122.4337, aliases: ["noe"] },
  { name: "NoPa", lat: 37.7749, lng: -122.4383, aliases: ["alamo square / nopa", "usf / panhandle", "north panhandle", "panhandle", "usf", "nopa / alamo square"] },
  { name: "North Beach", lat: 37.806, lng: -122.4103, aliases: ["north beach / telegraph hill"] },
  { name: "Outer Mission", lat: 37.718, lng: -122.4453, aliases: ["crocker amazon", "mission terrace"] },
  { name: "Outer Richmond", lat: 37.7776, lng: -122.4939, aliases: [] },
  { name: "Outer Sunset", lat: 37.753, lng: -122.4949, aliases: ["sunset / parkside", "sunset district", "sunset"] },
  { name: "Pacific Heights", lat: 37.7925, lng: -122.4382, aliases: ["pac heights", "pac hts", "pacific hts"] },
  { name: "Parkside", lat: 37.7441, lng: -122.4863, aliases: [] },
  { name: "Portola", lat: 37.7266, lng: -122.4049, aliases: ["portola district"] },
  { name: "Potrero Hill", lat: 37.7605, lng: -122.4005, aliases: ["potrero"] },
  { name: "Russian Hill", lat: 37.8014, lng: -122.4182, aliases: [] },
  { name: "SoMa", lat: 37.7785, lng: -122.4056, aliases: ["soma / south beach", "south of market", "yerba buena"] },
  { name: "South Beach", lat: 37.783, lng: -122.3893, aliases: ["rincon hill"] },
  { name: "Sunnyside", lat: 37.7311, lng: -122.4432, aliases: [] },
  { name: "Telegraph Hill", lat: 37.8025, lng: -122.4058, aliases: [] },
  { name: "Tenderloin", lat: 37.7847, lng: -122.4145, aliases: ["the tenderloin", "tendernob"] },
  { name: "Treasure Island", lat: 37.8235, lng: -122.3708, aliases: [] },
  { name: "Twin Peaks", lat: 37.7544, lng: -122.4477, aliases: ["twin peaks / diamond hts", "midtown terrace", "forest knolls", "clarendon heights"] },
  { name: "Visitacion Valley", lat: 37.7132, lng: -122.4046, aliases: ["vis valley", "visitation valley"] },
  { name: "West Portal", lat: 37.7407, lng: -122.4665, aliases: ["west portal / forest hill", "forest hill", "st francis wood"] },
  { name: "Western Addition", lat: 37.7799, lng: -122.4312, aliases: ["western addition / fillmore", "fillmore", "the fillmore", "cathedral hill"] },
];

const byName = new Map<string, Neighborhood>();
const byAlias = new Map<string, Neighborhood>();
for (const n of SF_NEIGHBORHOODS) {
  byName.set(n.name.toLowerCase(), n);
  for (const alias of n.aliases) byAlias.set(alias.toLowerCase(), n);
}

function cleanHoodText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bsan francisco\b|,?\s*\bca\b\.?/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a raw source neighborhood/location string to a canonical SF
 * neighborhood, or null when it cannot be confidently matched.
 */
export function matchNeighborhood(
  raw: string | null | undefined,
): Neighborhood | null {
  if (!raw) return null;
  const text = cleanHoodText(raw);
  if (!text) return null;
  const exact = byName.get(text) ?? byAlias.get(text);
  if (exact) return exact;
  // Substring pass: longest alias/name first so "lower nob hill" beats "nob hill".
  const candidates: Array<{ key: string; hood: Neighborhood }> = [];
  for (const [key, hood] of byAlias) candidates.push({ key, hood });
  for (const [key, hood] of byName) candidates.push({ key, hood });
  candidates.sort((a, b) => b.key.length - a.key.length);
  for (const { key, hood } of candidates) {
    if (key.length >= 4 && text.includes(key)) return hood;
  }
  return null;
}

/**
 * Is this raw location string inside San Francisco proper?
 * Guards against nearby-city results (Oakland, Daly City, and the classic
 * trap: "South San Francisco" is NOT San Francisco).
 */
export function isSfLocation(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (/south san francisco|\bssf\b/.test(text)) return false;
  if (
    /\b(oakland|berkeley|daly city|alameda|emeryville|richmond,|san mateo|pacifica|brisbane|sausalito|mill valley|san rafael|redwood city|palo alto|san jose|hayward|walnut creek|vallejo|treasure island annex)\b/.test(
      text,
    ) &&
    !matchNeighborhood(text)
  ) {
    return false;
  }
  if (/san francisco/.test(text)) return true;
  return matchNeighborhood(text) !== null;
}

export function neighborhoodCentroid(
  name: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!name) return null;
  const hood = byName.get(name.toLowerCase());
  return hood ? { lat: hood.lat, lng: hood.lng } : null;
}
