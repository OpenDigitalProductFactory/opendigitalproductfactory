// lib/mileage/classification.ts — auto-classification of captured drives (BI-6D98AD8A).
//
// The three MileIQ-Pro behaviours worth absorbing differ only in their predicate,
// so they share one evaluator:
//
//   commute_exclusion — the first drive of the day out of the driver's home area
//                       (and the last one back) is commuting, not business.
//   work_hours        — a drive inside the driver's declared working window is
//                       business unless something more specific says otherwise.
//   repeated_route    — a route the driver has already classified the same way
//                       N times classifies itself from then on.
//
// Pure and DB-free. Rules arrive already scoped and ordered by the caller; this
// module only decides. A rule NEVER overrides a human: a trip a driver or admin
// has already classified is returned untouched, because the whole value of the
// feature collapses the first time automation silently overwrites a person.

export type TripClassification = "unclassified" | "business" | "personal" | "commute";

export type GeoPoint = { latitude: number; longitude: number };

export type ClassifiableTrip = {
  startedAt: Date;
  endedAt: Date;
  start: GeoPoint;
  end: GeoPoint;
  classification: TripClassification;
  /** Set when a human already decided; rules must not overwrite it. */
  classifiedByKind: "driver" | "rule" | "admin" | null;
};

export type CommuteExclusionPredicate = {
  kind: "commute_exclusion";
  home: GeoPoint;
  /** How close to home counts as "at home". */
  homeRadiusMetres: number;
};

export type WorkHoursPredicate = {
  kind: "work_hours";
  /** 0=Sunday … 6=Saturday, in the driver's own timezone offset. */
  daysOfWeek: readonly number[];
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  /** Minutes to add to UTC to reach the driver's local time. */
  utcOffsetMinutes: number;
};

export type RepeatedRoutePredicate = {
  kind: "repeated_route";
  start: GeoPoint;
  end: GeoPoint;
  /** How close the endpoints must be to count as the same route. */
  matchRadiusMetres: number;
};

export type MileagePredicate =
  | CommuteExclusionPredicate
  | WorkHoursPredicate
  | RepeatedRoutePredicate;

export type ClassificationRule = {
  id: string;
  /** Lower runs first. */
  priority: number;
  resultClassification: TripClassification;
  predicate: MileagePredicate;
};

export type ClassificationOutcome = {
  classification: TripClassification;
  ruleId: string | null;
};

const EARTH_RADIUS_METRES = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in metres. */
export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function withinRadius(a: GeoPoint, b: GeoPoint, radiusMetres: number): boolean {
  return haversineMetres(a, b) <= radiusMetres;
}

function localMinuteOfDay(at: Date, utcOffsetMinutes: number): number {
  const shifted = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function localDayOfWeek(at: Date, utcOffsetMinutes: number): number {
  return new Date(at.getTime() + utcOffsetMinutes * 60_000).getUTCDay();
}

function matchesCommuteExclusion(trip: ClassifiableTrip, p: CommuteExclusionPredicate): boolean {
  const startsAtHome = withinRadius(trip.start, p.home, p.homeRadiusMetres);
  const endsAtHome = withinRadius(trip.end, p.home, p.homeRadiusMetres);
  // Exactly one end at home = the commute leg. Both ends at home is an errand
  // loop, not a commute; neither end at home is a working drive.
  return startsAtHome !== endsAtHome;
}

function matchesWorkHours(trip: ClassifiableTrip, p: WorkHoursPredicate): boolean {
  const day = localDayOfWeek(trip.startedAt, p.utcOffsetMinutes);
  if (!p.daysOfWeek.includes(day)) return false;
  const minute = localMinuteOfDay(trip.startedAt, p.utcOffsetMinutes);
  return minute >= p.startMinuteOfDay && minute <= p.endMinuteOfDay;
}

function matchesRepeatedRoute(trip: ClassifiableTrip, p: RepeatedRoutePredicate): boolean {
  return (
    withinRadius(trip.start, p.start, p.matchRadiusMetres) &&
    withinRadius(trip.end, p.end, p.matchRadiusMetres)
  );
}

function matches(trip: ClassifiableTrip, rule: ClassificationRule): boolean {
  switch (rule.predicate.kind) {
    case "commute_exclusion":
      return matchesCommuteExclusion(trip, rule.predicate);
    case "work_hours":
      return matchesWorkHours(trip, rule.predicate);
    case "repeated_route":
      return matchesRepeatedRoute(trip, rule.predicate);
  }
}

/**
 * Decide a trip's classification.
 *
 * A trip a human already classified is returned unchanged — automation assists,
 * it does not overrule. Otherwise the lowest-priority-number matching rule wins,
 * which is what lets commute exclusion (specific) beat work hours (broad).
 */
export function classifyTrip(
  trip: ClassifiableTrip,
  rules: readonly ClassificationRule[],
): ClassificationOutcome {
  if (trip.classifiedByKind === "driver" || trip.classifiedByKind === "admin") {
    return { classification: trip.classification, ruleId: null };
  }

  const winner = [...rules]
    .sort((a, b) => a.priority - b.priority)
    .find((rule) => matches(trip, rule));

  if (!winner) return { classification: "unclassified", ruleId: null };
  return { classification: winner.resultClassification, ruleId: winner.id };
}

/**
 * How many identical classifications of the same route it takes before offering
 * to auto-classify it. MileIQ asks on the third; matching that is deliberate —
 * two could be coincidence, and asking too early trains people to dismiss.
 */
export const REPEATED_ROUTE_THRESHOLD = 3;

/**
 * Whether a route now qualifies for a repeated-route rule: at least the
 * threshold of PRIOR trips over the same endpoints, all classified the same way
 * by a human. Mixed history never qualifies — an ambiguous route is exactly the
 * one a person should keep deciding.
 */
export function qualifiesForRepeatedRoute(
  priorTrips: readonly ClassifiableTrip[],
  candidate: RepeatedRoutePredicate,
): TripClassification | null {
  const onRoute = priorTrips.filter(
    (t) =>
      t.classifiedByKind === "driver" &&
      matchesRepeatedRoute(t, candidate) &&
      t.classification !== "unclassified",
  );
  if (onRoute.length < REPEATED_ROUTE_THRESHOLD) return null;

  const [first, ...rest] = onRoute;
  if (!first) return null;
  return rest.every((t) => t.classification === first.classification)
    ? first.classification
    : null;
}
