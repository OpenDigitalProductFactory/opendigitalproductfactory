/**
 * Drive detection — turning a stream of raw location fixes into discrete trips
 * (BI-6D98AD8A).
 *
 * This is the part that makes automatic capture feel automatic: the driver
 * never starts or stops a timer, so the app has to decide, from motion alone,
 * where one drive ends and the next begins.
 *
 * Deliberately pure and free of any Expo/native import so the whole heuristic is
 * unit-testable on CI without a device. The native background-location task that
 * FEEDS this is a separate concern (it needs expo-task-manager, which must clear
 * the dependency gate first); this module is what that task will call.
 *
 * Nothing here records anything. Consent is enforced by the caller before a fix
 * is ever collected — see consent.ts.
 */

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Milliseconds since epoch. */
  timestamp: number;
  /** Metres per second, when the platform supplied it. */
  speed?: number | null;
  /** Horizontal accuracy in metres; a poor fix is treated as suspect. */
  accuracy?: number | null;
  /**
   * ISO 3166-1 alpha-2 the platform reverse-geocoded for this fix, when it
   * supplied one. The DEVICE knows what country it is in — the driver is never
   * asked. Absent on most fixes by design: reverse geocoding every fix would
   * burn battery and quota for an answer that only changes at a border.
   */
  isoCountryCode?: string | null;
}

export interface DetectedTrip {
  startedAt: Date;
  endedAt: Date;
  start: { latitude: number; longitude: number };
  end: { latitude: number; longitude: number };
  /** Summed great-circle distance along the retained fixes, in metres. */
  distanceMetres: number;
  fixCount: number;
  /**
   * Where the drive BEGAN, as ISO 3166-1 alpha-2, or null when no fix carried
   * a country.
   *
   * A drive that crosses a border prices on the country it started in. That is
   * a deliberate, documented simplification rather than an oversight: splitting
   * one drive across two rate plans needs per-segment distance attribution and
   * a reverse geocode far denser than the one or two the device actually makes.
   * Recording the start honestly beats inventing a split.
   */
  countryCode: string | null;
}

export interface DetectionOptions {
  /** A gap this long with no movement ends the trip. */
  stopGapMs: number;
  /** Movement below this between consecutive fixes counts as stationary. */
  stationaryRadiusMetres: number;
  /** Trips shorter than this are noise (car park shuffling, GPS drift). */
  minimumTripMetres: number;
  /** Fixes less accurate than this are discarded before segmentation. */
  maximumAccuracyMetres: number;
}

export const DEFAULT_DETECTION: DetectionOptions = {
  // Five minutes stationary ends a drive. Shorter and a traffic light splits a
  // commute into three trips; longer and a site visit merges into the drive.
  stopGapMs: 5 * 60_000,
  stationaryRadiusMetres: 60,
  // Under ~100m is parking-lot noise, not a business drive worth reimbursing.
  minimumTripMetres: 100,
  // A fix worse than this would corrupt the distance more than it informs it.
  maximumAccuracyMetres: 100,
};

const EARTH_RADIUS_METRES = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres. Mirrors the server-side implementation. */
export function haversineMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude));
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function usable(fix: LocationFix, options: DetectionOptions): boolean {
  if (fix.accuracy === null || fix.accuracy === undefined) return true;
  return fix.accuracy <= options.maximumAccuracyMetres;
}

/**
 * The first country any fix carries, scanning forward from the start.
 *
 * Falls forward rather than demanding the very first fix carry one, because a
 * device commonly resolves its country a beat after the drive begins.
 */
function firstCountry(fixes: readonly LocationFix[]): string | null {
  for (const fix of fixes) {
    const code = fix.isoCountryCode?.trim().toUpperCase();
    if (code) return code;
  }
  return null;
}

function buildTrip(fixes: LocationFix[], options: DetectionOptions): DetectedTrip | null {
  if (fixes.length < 2) return null;

  let distanceMetres = 0;
  for (let i = 1; i < fixes.length; i += 1) {
    distanceMetres += haversineMetres(fixes[i - 1]!, fixes[i]!);
  }
  if (distanceMetres < options.minimumTripMetres) return null;

  const first = fixes[0]!;
  const last = fixes[fixes.length - 1]!;
  return {
    startedAt: new Date(first.timestamp),
    endedAt: new Date(last.timestamp),
    start: { latitude: first.latitude, longitude: first.longitude },
    end: { latitude: last.latitude, longitude: last.longitude },
    distanceMetres: Math.round(distanceMetres),
    fixCount: fixes.length,
    countryCode: firstCountry(fixes),
  };
}

/**
 * Segment an ordered stream of fixes into trips.
 *
 * A trip ends when the device has not moved beyond `stationaryRadiusMetres` for
 * `stopGapMs` — which covers both "parked and switched off" and "the OS stopped
 * delivering fixes". Sub-minimum segments are dropped rather than surfaced,
 * because a driver asked to classify GPS jitter stops classifying anything.
 */
export function detectTrips(
  rawFixes: readonly LocationFix[],
  options: DetectionOptions = DEFAULT_DETECTION,
): DetectedTrip[] {
  const fixes = rawFixes
    .filter((f) => usable(f, options))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const trips: DetectedTrip[] = [];
  let current: LocationFix[] = [];
  // The last fix at which the device was meaningfully somewhere else.
  let lastMovedAt: number | null = null;

  for (const fix of fixes) {
    if (current.length === 0) {
      current = [fix];
      lastMovedAt = fix.timestamp;
      continue;
    }

    const previous = current[current.length - 1]!;
    const moved = haversineMetres(previous, fix);

    if (moved > options.stationaryRadiusMetres) {
      current.push(fix);
      lastMovedAt = fix.timestamp;
      continue;
    }

    // Stationary. Close the trip once we have been still long enough.
    if (lastMovedAt !== null && fix.timestamp - lastMovedAt >= options.stopGapMs) {
      const trip = buildTrip(current, options);
      if (trip) trips.push(trip);
      current = [fix];
      lastMovedAt = fix.timestamp;
    }
  }

  const trailing = buildTrip(current, options);
  if (trailing) trips.push(trailing);

  return trips;
}
