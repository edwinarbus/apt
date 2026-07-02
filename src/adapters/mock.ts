import type { NormalizedListing } from "@/core/types";
import {
  computeEffectiveMonthly,
  normalizeLaundry,
  normalizeParking,
} from "@/core/normalize";
import type { AdapterContext, AdapterRunResult, SourceAdapter } from "./types";
import { emptyRunResult } from "./types";

/**
 * Mock adapter with realistic SF data for local development and UI work.
 * It runs through the exact same ingestion pipeline as real sources.
 *
 * Two phases (env APT_MOCK_PHASE, default "1") let `npm run seed:mock`
 * exercise the full lifecycle with real machinery instead of faked rows:
 *   phase 2 drops two listings (missing chain), changes three prices
 *   (price-drop/-increase events) and introduces two new listings.
 */

interface MockSpec {
  id: string;
  title: string;
  hood: string | null;
  hoodRaw?: string;
  price: number;
  beds: number | null;
  baths: number | null;
  sqft?: number | null;
  address?: string | null;
  unit?: string | null;
  lat?: number | null;
  lng?: number | null;
  precision?: NormalizedListing["geocodePrecision"];
  photos?: number | string[];
  cats?: boolean | null;
  dogs?: boolean | null;
  dogNote?: string;
  laundry?: string | null;
  parking?: string | null;
  concessions?: string | null;
  deposit?: number | null;
  availIn?: number | null; // days from now
  propertyName?: string | null;
  description?: string;
  amenities?: string[];
  utilities?: string[];
  contact?: { name?: string; phone?: string; email?: string; url?: string };
  applicationUrl?: string;
  virtualTourUrl?: string;
  floorPlans?: string[];
  posted?: number; // days ago
}

const pic = (id: string, n: number) =>
  `https://picsum.photos/seed/apt-${id}-${n}/800/600`;

const DESC: Record<string, string> = {
  standard:
    "Bright, freshly painted unit with hardwood floors, bay windows, and great light. Close to transit, cafes, and parks. Water and garbage included. Sorry, no smoking.",
  charming:
    "Charming top-floor unit in a classic Edwardian building. Period details, updated kitchen with dishwasher, and a shared roof deck with city views. Easy street parking nearby and quick access to the N-Judah.",
  modern:
    "Modern open-plan layout with stainless appliances, quartz counters, in-unit washer/dryer, and floor-to-ceiling windows. Building offers a gym, bike storage, and package lockers.",
  scam: "Beautiful luxury apartment, all utilities included!!! I am currently out of the country doing missionary work so my agent cannot show the unit, but I can mail you the keys. Please send first month and deposit via wire transfer or Zelle to hold the unit before viewing. Act fast, first come first served!!!",
  urgency:
    "Great deal, won't last! Act now. Serious inquiries only. Available immediately, month to month ok.",
};

const SPECS_PHASE_1: MockSpec[] = [
  {
    id: "mock-001", title: "Sunny 1BR flat in the heart of Lower Haight w/ in-unit W/D",
    hood: "Lower Haight", price: 3150, beds: 1, baths: 1, sqft: 720,
    address: "438 Fillmore St", lat: 37.7722, lng: -122.4312, precision: "exact_address",
    photos: 4, cats: true, dogs: true, laundry: "w/d in unit", parking: "street parking",
    deposit: 3150, availIn: 14, description: DESC.standard, posted: 2,
    amenities: ["hardwood floors", "bay windows", "dishwasher", "shared backyard"],
  },
  {
    id: "mock-002", title: "Large sunny studio steps from Duboce Park",
    hood: "Duboce Triangle", price: 2850, beds: 0, baths: 1, sqft: 560,
    address: "150 Duboce Ave", lat: 37.769, lng: -122.4315, precision: "building",
    photos: 3, cats: true, dogs: false, laundry: "laundry in bldg", parking: null,
    availIn: 30, description: DESC.charming, posted: 5,
    amenities: ["walk-in closet", "gas stove", "roof deck"],
  },
  {
    id: "mock-003", title: "Remodeled 1BR near Castro with private deck",
    hood: "Castro", price: 3295, beds: 1, baths: 1, sqft: 680,
    address: "4212 18th St", lat: 37.7614, lng: -122.4344, precision: "exact_address",
    photos: 5, cats: true, dogs: true, dogNote: "small dogs under 25 lbs",
    laundry: "laundry in bldg", parking: "street parking", deposit: 3295,
    availIn: 21, description: DESC.standard, posted: 8,
  },
  {
    id: "mock-004", title: "Stunning 2BR/2BA in Hayes Valley — 6 weeks free!",
    hood: "Hayes Valley", price: 4650, beds: 2, baths: 2, sqft: 1050,
    address: "555 Fulton St", unit: "412", lat: 37.7768, lng: -122.4241, precision: "exact_address",
    photos: 6, cats: false, dogs: false, laundry: "w/d in unit", parking: "garage parking",
    concessions: "6 weeks free on a 12-month lease", deposit: 1000, availIn: 10,
    propertyName: "The Fulton", description: DESC.modern, posted: 1,
    amenities: ["gym", "roof deck", "bike storage", "package lockers", "elevator"],
    applicationUrl: "https://example.com/apply/the-fulton-412",
  },
  {
    id: "mock-005", title: "Classic Mission 1BR, tons of character",
    hood: "Mission", price: 2995, beds: 1, baths: 1, sqft: null,
    address: "3345 23rd St", lat: 37.7583, lng: -122.4211, precision: "building",
    photos: ["broken:1", "ok:2"], cats: null, dogs: null, laundry: "w/d hookups",
    parking: null, availIn: 7, description: DESC.standard, posted: 12,
  },
  {
    id: "mock-006", title: "Cozy NoPa studio, quiet block",
    hood: "NoPa", price: 2395, beds: 0, baths: 1, sqft: 420,
    address: null, lat: null, lng: null, precision: null,
    photos: 0, cats: true, dogs: false, laundry: "laundry in bldg", parking: null,
    availIn: 5, description: DESC.charming, posted: 3,
  },
  {
    id: "mock-007", title: "Nob Hill 1BR with city views",
    hood: "Nob Hill", price: 3050, beds: 1, baths: 1, sqft: 640,
    address: "1155 Pine St", lat: 37.7907, lng: -122.4137, precision: "building",
    photos: 3, cats: true, dogs: false, laundry: "laundry in bldg", parking: null,
    availIn: 0, description: DESC.standard, posted: 20,
  },
  {
    id: "mock-008", title: "Elegant 2BR at The Crest — doorman building",
    hood: "Russian Hill", price: 5200, beds: 2, baths: 2, sqft: 1180,
    address: "1000 Green St", unit: "8C", lat: 37.8005, lng: -122.4176, precision: "exact_address",
    photos: 6, cats: true, dogs: true, laundry: "w/d in unit", parking: "garage parking",
    deposit: 5200, availIn: 28, propertyName: "The Crest", description: DESC.modern, posted: 6,
    amenities: ["doorman", "elevator", "gym", "storage"],
    virtualTourUrl: "https://example.com/tour/the-crest-8c",
  },
  {
    id: "mock-009", title: "Inner Richmond 1BR near Golden Gate Park",
    hood: "Inner Richmond", price: 2750, beds: 1, baths: 1, sqft: 610,
    address: "620 8th Ave", lat: 37.7796, lng: -122.4668, precision: "building",
    photos: 3, cats: true, dogs: true, laundry: "laundry in bldg", parking: "street parking",
    availIn: 18, description: DESC.standard, posted: 9,
  },
  {
    id: "mock-010", title: "SoMa loft-style 1BR, 900 sqft",
    hood: "SoMa", price: 3400, beds: 1, baths: 1, sqft: 900,
    address: "1170 Howard St", lat: 37.777, lng: -122.4051, precision: "building",
    photos: 4, cats: null, dogs: null, laundry: "w/d in unit", parking: "off-street parking",
    availIn: 12, description: DESC.modern, posted: 4,
  },
  {
    id: "mock-011", title: "LUXURY Pacific Heights 2BR $$$ unbelievable deal!!!",
    hood: "Pacific Heights", hoodRaw: "pac heights", price: 1450, beds: 2, baths: 2, sqft: 1400,
    address: null, lat: null, lng: null, precision: null,
    photos: 1, cats: true, dogs: true, laundry: "w/d in unit", parking: "garage parking",
    availIn: 0, description: DESC.scam, posted: 0,
  },
  {
    id: "mock-012", title: "Bernal Heights 1BR with garden access",
    hood: "Bernal Heights", price: 2895, beds: 1, baths: 1, sqft: 650,
    address: "424 Cortland Ave", lat: 37.7407, lng: -122.4155, precision: "building",
    photos: 3, cats: true, dogs: true, laundry: "w/d hookups", parking: null,
    availIn: 25, description: DESC.standard, posted: 15,
  },
  {
    id: "mock-013", title: "Noe Valley 2BR flat, sunny southern exposure",
    hood: "Noe Valley", price: 4200, beds: 2, baths: 1, sqft: 980,
    address: "1288 Church St", lat: 37.7509, lng: -122.4326, precision: "exact_address",
    photos: 5, cats: true, dogs: true, laundry: "w/d in unit", parking: "garage parking",
    deposit: 4200, availIn: 35, description: DESC.charming, posted: 7,
  },
  {
    id: "mock-014", title: "Marina 1BR two blocks from Chestnut St",
    hood: "Marina", price: 3600, beds: 1, baths: 1, sqft: 700,
    address: "3252 Scott St", lat: 37.8005, lng: -122.4357, precision: "building",
    photos: 4, cats: true, dogs: false, laundry: "laundry in bldg", parking: "street parking",
    availIn: 9, description: DESC.standard, posted: 11,
  },
  {
    id: "mock-015", title: "Downtown studio, utilities included",
    hood: "Tenderloin", price: 1795, beds: 0, baths: 1, sqft: 380,
    address: "540 Leavenworth St", lat: 37.7843, lng: -122.4139, precision: "building",
    photos: 2, cats: false, dogs: false, laundry: "laundry in bldg", parking: null,
    availIn: 0, utilities: ["water", "garbage", "electricity"],
    description: DESC.standard, posted: 14,
  },
  {
    id: "mock-016", title: "Potrero Hill 1BR with bay views",
    hood: "Potrero Hill", price: 3100, beds: 1, baths: 1, sqft: 690,
    address: "1301 18th St", unit: "2", lat: 37.7599, lng: -122.3998, precision: "exact_address",
    photos: ["dupe:1", "dupe:2", "dupe:3"], cats: true, dogs: false,
    laundry: "laundry in bldg", parking: "off-street parking",
    availIn: 16, description: DESC.charming, posted: 10,
  },
  {
    id: "mock-017", title: "Bay-view one bedroom on Potrero's north slope",
    hood: "Potrero Hill", price: 3150, beds: 1, baths: 1, sqft: 690,
    address: "1301 18th St", unit: "2", lat: 37.7599, lng: -122.3998, precision: "exact_address",
    photos: ["dupe:1", "dupe:2"], cats: true, dogs: false,
    laundry: "laundry in bldg", parking: "off-street parking",
    availIn: 16, description: DESC.charming, posted: 3,
  },
  {
    id: "mock-018", title: "Dogpatch 2BR in converted warehouse",
    hood: "Dogpatch", price: 4100, beds: 2, baths: 2, sqft: 1100,
    address: "800 Indiana St", unit: "214", lat: 37.758, lng: -122.3888, precision: "exact_address",
    photos: 5, cats: true, dogs: true, laundry: "w/d in unit", parking: "garage parking",
    availIn: 20, propertyName: "Indiana Lofts", description: DESC.modern, posted: 2,
    floorPlans: ["https://picsum.photos/seed/apt-mock-018-fp/1000/700"],
  },
  {
    id: "mock-019", title: "Cole Valley 1BR near UCSF and the N",
    hood: "Cole Valley", price: 3250, beds: 1, baths: 1, sqft: 660,
    address: "Parnassus Ave & Stanyan St", lat: 37.7654, lng: -122.4503, precision: "block",
    photos: 3, cats: true, dogs: null, laundry: "laundry in bldg", parking: "street parking",
    availIn: 40, description: DESC.charming, posted: 18,
  },
  {
    id: "mock-020", title: "Affordable Haight studio",
    hood: "Haight-Ashbury", price: 2250, beds: 0, baths: 1, sqft: 400,
    address: "1450 Haight St", lat: 37.7699, lng: -122.4469, precision: "building",
    photos: ["broken:1"], cats: false, dogs: false, laundry: "no laundry",
    parking: "street parking", availIn: 3, description: DESC.standard, posted: 22,
  },
  {
    id: "mock-021", title: "Outer Sunset 2BR with yard, dogs welcome",
    hood: "Outer Sunset", price: 3300, beds: 2, baths: 1, sqft: 950,
    address: "2214 46th Ave", lat: 37.7541, lng: -122.4951, precision: "exact_address",
    photos: 4, cats: true, dogs: true, laundry: "w/d hookups", parking: "garage parking",
    availIn: 15, description: DESC.standard, posted: 6,
  },
  {
    id: "mock-022", title: "Glen Park 1BR near BART and Canyon Market",
    hood: "Glen Park", price: 2850, beds: 1, baths: 1, sqft: 620,
    address: "2830 Diamond St", lat: 37.7338, lng: -122.433, precision: "building",
    photos: 3, cats: true, dogs: false, laundry: "laundry in bldg", parking: null,
    availIn: 44, description: DESC.standard, posted: 13,
  },
  {
    id: "mock-023", title: "Fillmore Commons 1BR — professionally managed",
    hood: "Western Addition", price: 2950, beds: 1, baths: 1, sqft: 640,
    address: "1450 Fillmore St", unit: "306", lat: 37.7811, lng: -122.4319, precision: "exact_address",
    photos: 4, cats: true, dogs: true, laundry: "laundry in bldg", parking: "garage parking",
    availIn: 8, propertyName: "Fillmore Commons", description: DESC.modern, posted: 4,
    contact: {
      name: "Fillmore Commons Leasing",
      phone: "(415) 555-0142",
      email: "leasing@fillmorecommons.example.com",
      url: "https://example.com/fillmore-commons",
    },
    applicationUrl: "https://example.com/apply/fillmore-306",
  },
  {
    id: "mock-024", title: "North Beach 1BR, Columbus Ave area",
    hood: "North Beach", price: 3350, beds: 1, baths: 1, sqft: null,
    address: null, lat: null, lng: null, precision: null,
    photos: 2, cats: null, dogs: null, laundry: null, parking: null,
    availIn: 11, description: DESC.standard, posted: 16,
  },
  {
    id: "mock-025", title: "Excelsior 2BR upper unit, easy freeway access",
    hood: "Excelsior", price: 3050, beds: 2, baths: 1, sqft: 880,
    address: "45 Persia Ave", lat: 37.7249, lng: -122.4297, precision: "building",
    photos: 3, cats: true, dogs: null, laundry: "w/d hookups", parking: "off-street parking",
    availIn: 30, description: DESC.standard, posted: 19,
  },
  {
    id: "mock-026", title: "Lower Haight studio, available now — cat friendly",
    hood: "Lower Haight", price: 2450, beds: 0, baths: 1, sqft: 450,
    address: "710 Steiner St", lat: 37.7715, lng: -122.4289, precision: "building",
    photos: 3, cats: true, dogs: false, laundry: "laundry in bldg", parking: "street parking",
    availIn: 0, description: DESC.charming, posted: 1,
  },
  {
    id: "mock-027", title: "Twin Peaks 1BR — act fast, won't last!",
    hood: "Twin Peaks", price: 2999, beds: 1, baths: 1, sqft: 630,
    address: "98 Crestline Dr", lat: 37.7513, lng: -122.447, precision: "building",
    photos: 0, cats: null, dogs: null, laundry: null, parking: "garage parking",
    availIn: 2, description: DESC.urgency, posted: 0,
  },
  {
    id: "mock-028", title: "Mission Bay 2BR in newer elevator building",
    hood: "Mission Bay", price: 4850, beds: 2, baths: 2, sqft: 1120,
    address: "420 Berry St", unit: "1108", lat: 37.7701, lng: -122.3912, precision: "exact_address",
    photos: 6, cats: true, dogs: true, laundry: "w/d in unit", parking: "garage parking",
    availIn: 6, propertyName: "Berry Street Residences", description: DESC.modern, posted: 5,
    amenities: ["gym", "courtyard", "pet spa", "concierge", "EV charging"],
  },
];

const SPECS_PHASE_2_NEW: MockSpec[] = [
  {
    id: "mock-029", title: "Just listed: Lower Haight 1BR with in-unit laundry",
    hood: "Lower Haight", price: 3180, beds: 1, baths: 1, sqft: 700,
    address: "225 Scott St", lat: 37.7719, lng: -122.4353, precision: "exact_address",
    photos: 4, cats: true, dogs: true, laundry: "w/d in unit", parking: "street parking",
    availIn: 12, description: DESC.standard, posted: 0,
  },
  {
    id: "mock-030", title: "Duboce Triangle garden studio",
    hood: "Duboce Triangle", price: 2700, beds: 0, baths: 1, sqft: 480,
    address: "80 Carmelita St", lat: 37.7683, lng: -122.4338, precision: "building",
    photos: 3, cats: true, dogs: false, laundry: "laundry in bldg", parking: null,
    availIn: 4, description: DESC.charming, posted: 0,
  },
];

const PHASE_2_DROPPED = new Set(["mock-007", "mock-012"]);
const PHASE_2_PRICE_CHANGES: Record<string, number> = {
  "mock-003": 3095, // drop
  "mock-009": 2600, // drop
  "mock-015": 1895, // increase
};

function specPhotos(spec: MockSpec): string[] {
  if (Array.isArray(spec.photos)) {
    return spec.photos.map((p) => {
      if (p.startsWith("broken:")) {
        return `https://images.invalid.example/apt-${spec.id}-${p.slice(7)}.jpg`;
      }
      if (p.startsWith("dupe:")) {
        return `https://picsum.photos/seed/apt-dupe-potrero-${p.slice(5)}/800/600`;
      }
      return pic(spec.id, Number(p.slice(3)) || 1);
    });
  }
  const count = spec.photos ?? 0;
  return Array.from({ length: count }, (_, i) => pic(spec.id, i + 1));
}

function specToListing(spec: MockSpec, now: Date): NormalizedListing {
  const iso = (d: Date) => d.toISOString();
  const daysFromNow = (days: number) =>
    new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const photos = specPhotos(spec);
  const price = spec.price;
  const amenities = spec.amenities ?? [];
  // Make each description unique unless two specs intentionally share both a
  // template and an address (the duplicate-pair demo, mock-016/017) — reused
  // boilerplate would otherwise trip the duplicate-description detector on
  // every listing, which is exactly what it is supposed to catch.
  const description = spec.description
    ? `${spec.description} Located ${spec.address ? `at ${spec.address}` : `in ${spec.hood ?? "San Francisco"}`}.`
    : null;
  return {
    sourceListingId: spec.id,
    originalUrl: `https://example.com/mock-listings/${spec.id}`,
    title: spec.title,
    fetchDepth: "detail",
    description,
    rawDescription: description,
    propertyName: spec.propertyName ?? null,
    unitNumberPublic: spec.unit ?? null,
    addressRaw: spec.address ?? null,
    addressNormalized: spec.address
      ? `${spec.address}${spec.unit ? ` #${spec.unit}` : ""}, San Francisco, CA`
      : null,
    neighborhood: spec.hood,
    sourceNeighborhoodRaw: spec.hoodRaw ?? spec.hood?.toLowerCase() ?? null,
    city: "San Francisco",
    state: "CA",
    latitude: spec.lat ?? null,
    longitude: spec.lng ?? null,
    geocodePrecision: spec.precision ?? null,
    priceRaw: `$${price.toLocaleString("en-US")}`,
    priceMonthly: price,
    priceEffectiveMonthly: computeEffectiveMonthly(price, spec.concessions ?? null),
    concessionsRaw: spec.concessions ?? null,
    depositRaw: spec.deposit != null ? `$${spec.deposit.toLocaleString("en-US")}` : null,
    depositAmount: spec.deposit ?? null,
    bedroomsRaw: spec.beds === 0 ? "Studio" : spec.beds != null ? `${spec.beds} BR` : null,
    bedrooms: spec.beds,
    bathroomsRaw: spec.baths != null ? `${spec.baths} Ba` : null,
    bathrooms: spec.baths,
    squareFeetRaw: spec.sqft != null ? `${spec.sqft} sqft` : null,
    squareFeet: spec.sqft ?? null,
    propertyType: "apartment",
    listingType: "rent",
    availableDate: spec.availIn != null ? daysFromNow(spec.availIn) : null,
    moveInDate: spec.availIn != null ? daysFromNow(spec.availIn) : null,
    postedAt: spec.posted != null ? iso(new Date(now.getTime() - spec.posted * 24 * 3600 * 1000)) : null,
    postedDateRaw: spec.posted != null ? `${spec.posted} days ago` : null,
    photos,
    primaryPhotoUrl: photos[0] ?? null,
    floorPlanUrls: spec.floorPlans ?? null,
    virtualTourUrl: spec.virtualTourUrl ?? null,
    amenitiesRaw: amenities,
    amenitiesNormalized: amenities.map((a) => a.toLowerCase()),
    laundryRaw: spec.laundry ?? null,
    laundryNormalized: spec.laundry ? normalizeLaundry(spec.laundry) : null,
    parkingRaw: spec.parking ?? null,
    parkingNormalized: spec.parking ? normalizeParking(spec.parking) : null,
    petPolicyRaw:
      spec.cats == null && spec.dogs == null
        ? null
        : `cats: ${fmtPet(spec.cats)}; dogs: ${fmtPet(spec.dogs)}${spec.dogNote ? ` (${spec.dogNote})` : ""}`,
    catsAllowed: spec.cats ?? null,
    dogsAllowed: spec.dogs ?? null,
    dogRestrictionsRaw: spec.dogNote ?? null,
    utilitiesRaw: spec.utilities?.join(", ") ?? null,
    utilitiesIncluded: spec.utilities ?? null,
    contactName: spec.contact?.name ?? null,
    contactPhone: spec.contact?.phone ?? null,
    contactEmail: spec.contact?.email ?? null,
    contactUrl: spec.contact?.url ?? null,
    applicationUrl: spec.applicationUrl ?? null,
    listingStatus: "active",
    rawPayload: { mock: true, spec: spec.id },
  };
}

const fmtPet = (v: boolean | null | undefined) =>
  v == null ? "unknown" : v ? "yes" : "no";

export const mockAdapter: SourceAdapter = {
  adapterType: "mock",

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const result = emptyRunResult();
    const now = new Date();
    const phase = process.env.APT_MOCK_PHASE === "2" ? 2 : 1;

    let specs: MockSpec[];
    if (phase === 1) {
      specs = SPECS_PHASE_1;
    } else {
      specs = SPECS_PHASE_1.filter((s) => !PHASE_2_DROPPED.has(s.id)).map(
        (s) =>
          PHASE_2_PRICE_CHANGES[s.id]
            ? { ...s, price: PHASE_2_PRICE_CHANGES[s.id] }
            : s,
      );
      specs = [...specs, ...SPECS_PHASE_2_NEW];
    }

    result.listings = specs.map((s) => specToListing(s, now));
    result.pagesVisited = 1;
    result.pageTrace.push({
      page: 1,
      url: `mock://phase-${phase}`,
      httpStatus: 200,
      listingsExtracted: result.listings.length,
    });
    result.totalListingsReportedBySource = result.listings.length;
    result.paginationCompleted = true;
    result.detailExtractionCompleted = true;
    ctx.log(`mock: phase ${phase}, ${result.listings.length} listings`);
    return result;
  },
};
