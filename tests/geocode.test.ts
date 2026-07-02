import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { listings } from "@/db/schema";
import { runSource } from "@/ingest/runner";
import type { Db } from "@/db/client";
import {
  geocodeAddress,
  neighborhoodFallback,
  type GeocodeProvider,
} from "@/core/geocode";
import { makeListing, seedStubSource, stubSuccess, testDb } from "./helpers";

describe("geocodeAddress caching", () => {
  let db: Db;
  beforeEach(() => {
    db = testDb();
  });

  it("never calls the provider twice for the same address", async () => {
    let calls = 0;
    const provider: GeocodeProvider = async () => {
      calls++;
      return {
        latitude: 37.77,
        longitude: -122.43,
        precision: "exact_address",
        formattedAddress: "438 Fillmore St, San Francisco",
      };
    };
    const first = await geocodeAddress(db, "438 Fillmore St", provider);
    expect(first?.fromCache).toBe(false);
    const second = await geocodeAddress(db, "438 Fillmore St", provider);
    expect(second?.fromCache).toBe(true);
    // Same address, different punctuation/casing -> same cache key.
    const third = await geocodeAddress(db, "438 FILLMORE ST.", provider);
    expect(third?.fromCache).toBe(true);
    expect(calls).toBe(1);
  });

  it("caches negative results so bad addresses are not retried", async () => {
    let calls = 0;
    const provider: GeocodeProvider = async () => {
      calls++;
      return null;
    };
    expect(await geocodeAddress(db, "nowhere at all", provider)).toBeNull();
    expect(await geocodeAddress(db, "nowhere at all", provider)).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("neighborhoodFallback", () => {
  it("returns centroid with neighborhood precision", () => {
    const hit = neighborhoodFallback("Lower Haight");
    expect(hit?.precision).toBe("neighborhood");
    expect(hit?.latitude).toBeCloseTo(37.772, 2);
    expect(neighborhoodFallback("Narnia")).toBeNull();
    expect(neighborhoodFallback(null)).toBeNull();
  });
});

describe("runner geocoding behavior", () => {
  it("falls back to neighborhood centroids and records precision", async () => {
    const db = testDb();
    seedStubSource(db);
    stubSuccess([
      makeListing({
        sourceListingId: "no-coords",
        neighborhood: "Mission",
        latitude: null,
        longitude: null,
      }),
      makeListing({
        sourceListingId: "has-coords",
        latitude: 37.8,
        longitude: -122.41,
        geocodePrecision: "exact_address",
      }),
    ]);
    const summary = await runSource(db, "stub_src", {
      skipRobotsCheck: true,
      geocode: false, // network geocoding off; fallback still applies
    });
    expect(summary.geocoded.fallback).toBe(1);

    const noCoords = db
      .select()
      .from(listings)
      .where(eq(listings.sourceListingId, "no-coords"))
      .get();
    expect(noCoords?.latitude).toBeCloseTo(37.7599, 2);
    expect(noCoords?.geocodePrecision).toBe("neighborhood");

    const hasCoords = db
      .select()
      .from(listings)
      .where(eq(listings.sourceListingId, "has-coords"))
      .get();
    expect(hasCoords?.latitude).toBe(37.8);
    expect(hasCoords?.geocodePrecision).toBe("exact_address");
  });
});
