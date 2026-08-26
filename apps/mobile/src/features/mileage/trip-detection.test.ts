import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_DETECTION,
  detectTrips,
  haversineMetres,
  type LocationFix,
} from "./trip-detection";

const START = { latitude: 37.7749, longitude: -122.4194 };
const T0 = Date.parse("2026-08-19T16:00:00.000Z");

/** Fixes marching north, ~111m per 0.001 degree of latitude. */
function drive(fromMs: number, steps: number, stepMinutes = 1, startLat = START.latitude) {
  const fixes: LocationFix[] = [];
  for (let i = 0; i < steps; i += 1) {
    fixes.push({
      latitude: startLat + i * 0.002,
      longitude: START.longitude,
      timestamp: fromMs + i * stepMinutes * 60_000,
      accuracy: 10,
    });
  }
  return fixes;
}

/** Fixes at one spot, as a parked phone reports. */
function parked(fromMs: number, minutes: number, lat: number) {
  const fixes: LocationFix[] = [];
  for (let i = 0; i <= minutes; i += 1) {
    fixes.push({
      latitude: lat,
      longitude: START.longitude,
      timestamp: fromMs + i * 60_000,
      accuracy: 10,
    });
  }
  return fixes;
}

describe("detectTrips", () => {
  it("detects a single continuous drive", () => {
    const trips = detectTrips(drive(T0, 10));
    expect(trips).toHaveLength(1);
    expect(trips[0]!.fixCount).toBe(10);
    expect(trips[0]!.distanceMetres).toBeGreaterThan(1_500);
  });

  it("splits two drives separated by a long stop", () => {
    const first = drive(T0, 8);
    const stopLat = first[first.length - 1]!.latitude;
    const stop = parked(first[first.length - 1]!.timestamp + 60_000, 10, stopLat);
    const second = drive(stop[stop.length - 1]!.timestamp + 60_000, 8, 1, stopLat);

    const trips = detectTrips([...first, ...stop, ...second]);
    expect(trips).toHaveLength(2);
    // The visit itself is not a trip — only the drives either side of it.
    expect(trips[0]!.endedAt.getTime()).toBeLessThan(trips[1]!.startedAt.getTime());
  });

  it("does not split a drive at a traffic light", () => {
    const first = drive(T0, 6);
    const lat = first[first.length - 1]!.latitude;
    // Two minutes stationary — well under the five-minute stop gap.
    const light = parked(first[first.length - 1]!.timestamp + 30_000, 2, lat);
    const rest = drive(light[light.length - 1]!.timestamp + 30_000, 6, 1, lat);

    expect(detectTrips([...first, ...light, ...rest])).toHaveLength(1);
  });

  it("drops parking-lot jitter below the minimum trip distance", () => {
    const jitter: LocationFix[] = [
      { ...START, timestamp: T0, accuracy: 5 },
      { latitude: START.latitude + 0.0002, longitude: START.longitude, timestamp: T0 + 30_000, accuracy: 5 },
      { latitude: START.latitude + 0.0001, longitude: START.longitude, timestamp: T0 + 60_000, accuracy: 5 },
    ];
    // A driver asked to classify GPS drift stops classifying anything.
    expect(detectTrips(jitter)).toHaveLength(0);
  });

  it("discards fixes too inaccurate to trust", () => {
    const good = drive(T0, 6);
    const wild: LocationFix = {
      latitude: START.latitude + 5,
      longitude: START.longitude + 5,
      timestamp: T0 + 3 * 60_000 + 1,
      accuracy: 5_000,
    };
    const withWild = detectTrips([...good, wild]);
    const withoutWild = detectTrips(good);
    // A 5km-accuracy fix would otherwise add hundreds of phantom kilometres.
    expect(withWild[0]!.distanceMetres).toBe(withoutWild[0]!.distanceMetres);
  });

  it("orders unsorted fixes before segmenting", () => {
    const fixes = drive(T0, 8);
    const shuffled = [fixes[3]!, fixes[0]!, fixes[6]!, fixes[1]!, fixes[7]!, fixes[2]!, fixes[4]!, fixes[5]!];
    expect(detectTrips(shuffled)).toHaveLength(1);
  });

  it("returns nothing for an empty stream", () => {
    expect(detectTrips([])).toHaveLength(0);
  });

  it("keeps a trip whose fixes never stop arriving", () => {
    const trips = detectTrips(drive(T0, 30));
    expect(trips).toHaveLength(1);
    expect(trips[0]!.endedAt.getTime()).toBe(T0 + 29 * 60_000);
  });
});

describe("haversineMetres", () => {
  it("agrees with the server-side implementation on a known separation", () => {
    const oakland = { latitude: 37.8044, longitude: -122.2712 };
    const metres = haversineMetres(START, oakland);
    expect(metres).toBeGreaterThan(13_000);
    expect(metres).toBeLessThan(14_000);
  });
});

describe("DEFAULT_DETECTION", () => {
  it("uses a stop gap long enough to survive traffic", () => {
    expect(DEFAULT_DETECTION.stopGapMs).toBeGreaterThanOrEqual(3 * 60_000);
  });
});

describe("device-derived trip country (DI-5E5AFE040A1F)", () => {
  it("reports the country the device resolved, uppercased", () => {
    const fixes = drive(T0, 8).map((f) => ({ ...f, isoCountryCode: "mx" }));
    expect(detectTrips(fixes, DEFAULT_DETECTION)[0]?.countryCode).toBe("MX");
  });

  it("is null when no fix carried a country", () => {
    // No signal, permission withheld, or an older client. The server then
    // prices on the driver's country of record rather than guessing.
    expect(detectTrips(drive(T0, 8), DEFAULT_DETECTION)[0]?.countryCode).toBeNull();
  });

  it("falls forward when the device resolves a country a beat after the drive starts", () => {
    const fixes = drive(T0, 8);
    fixes[2] = { ...fixes[2]!, isoCountryCode: "US" };
    expect(detectTrips(fixes, DEFAULT_DETECTION)[0]?.countryCode).toBe("US");
  });

  it("prices a border crossing on the country the drive STARTED in", () => {
    // Documented simplification: one drive, one rate plan. Splitting needs
    // per-segment attribution the device does not produce.
    const fixes = drive(T0, 8);
    fixes[0] = { ...fixes[0]!, isoCountryCode: "US" };
    fixes[7] = { ...fixes[7]!, isoCountryCode: "MX" };
    expect(detectTrips(fixes, DEFAULT_DETECTION)[0]?.countryCode).toBe("US");
  });
});
