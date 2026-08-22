import { describe, expect, it } from "vitest";
import {
  classifyTrip,
  haversineMetres,
  qualifiesForRepeatedRoute,
  REPEATED_ROUTE_THRESHOLD,
  type ClassifiableTrip,
  type ClassificationRule,
} from "./classification";

const HOME = { latitude: 37.7749, longitude: -122.4194 };
const OFFICE = { latitude: 37.8044, longitude: -122.2712 };
const SITE = { latitude: 37.6879, longitude: -122.4702 };

function trip(over: Partial<ClassifiableTrip> = {}): ClassifiableTrip {
  return {
    startedAt: new Date("2026-08-19T16:00:00.000Z"), // Wed 09:00 PT
    endedAt: new Date("2026-08-19T16:30:00.000Z"),
    start: HOME,
    end: OFFICE,
    classification: "unclassified",
    classifiedByKind: null,
    ...over,
  };
}

const commuteRule: ClassificationRule = {
  id: "rule_commute",
  priority: 10,
  resultClassification: "commute",
  predicate: { kind: "commute_exclusion", home: HOME, homeRadiusMetres: 250 },
};

const workHoursRule: ClassificationRule = {
  id: "rule_hours",
  priority: 100,
  resultClassification: "business",
  predicate: {
    kind: "work_hours",
    daysOfWeek: [1, 2, 3, 4, 5],
    startMinuteOfDay: 8 * 60,
    endMinuteOfDay: 18 * 60,
    utcOffsetMinutes: -7 * 60,
  },
};

describe("haversineMetres", () => {
  it("measures a known separation", () => {
    // Home to office is roughly 13.4 km across the bay.
    expect(haversineMetres(HOME, OFFICE)).toBeGreaterThan(13_000);
    expect(haversineMetres(HOME, OFFICE)).toBeLessThan(14_000);
  });

  it("is zero for the same point", () => {
    expect(haversineMetres(HOME, HOME)).toBe(0);
  });
});

describe("classifyTrip", () => {
  it("classifies the drive out of home as commute, not business", () => {
    const outcome = classifyTrip(trip(), [commuteRule, workHoursRule]);
    // Commute is more specific than work-hours and must win despite the drive
    // falling squarely inside working hours — this is the whole point of the
    // commute-exclusion feature.
    expect(outcome.classification).toBe("commute");
    expect(outcome.ruleId).toBe("rule_commute");
  });

  it("classifies a site-to-site drive in working hours as business", () => {
    const outcome = classifyTrip(trip({ start: OFFICE, end: SITE }), [
      commuteRule,
      workHoursRule,
    ]);
    expect(outcome.classification).toBe("business");
    expect(outcome.ruleId).toBe("rule_hours");
  });

  it("treats a loop starting and ending at home as not a commute", () => {
    const nearHome = { latitude: HOME.latitude + 0.0005, longitude: HOME.longitude };
    const outcome = classifyTrip(
      trip({
        start: HOME,
        end: nearHome,
        startedAt: new Date("2026-08-22T04:00:00.000Z"), // Fri 21:00 PT, outside hours
        endedAt: new Date("2026-08-22T04:20:00.000Z"),
      }),
      [commuteRule, workHoursRule],
    );
    // Both ends at home is an errand, not a commute leg.
    expect(outcome.classification).toBe("unclassified");
  });

  it("leaves a drive outside working hours unclassified rather than guessing", () => {
    const outcome = classifyTrip(
      trip({
        start: OFFICE,
        end: SITE,
        startedAt: new Date("2026-08-23T20:00:00.000Z"), // Sunday
        endedAt: new Date("2026-08-23T20:30:00.000Z"),
      }),
      [commuteRule, workHoursRule],
    );
    expect(outcome.classification).toBe("unclassified");
    expect(outcome.ruleId).toBeNull();
  });

  it("never overrules a driver's own classification", () => {
    const outcome = classifyTrip(
      trip({ classification: "business", classifiedByKind: "driver" }),
      [commuteRule, workHoursRule],
    );
    // The commute rule matches this trip, but a human already decided.
    expect(outcome.classification).toBe("business");
    expect(outcome.ruleId).toBeNull();
  });

  it("never overrules an admin's classification either", () => {
    const outcome = classifyTrip(
      trip({ classification: "personal", classifiedByKind: "admin" }),
      [commuteRule],
    );
    expect(outcome.classification).toBe("personal");
  });

  it("may re-decide a trip a previous rule classified", () => {
    const outcome = classifyTrip(
      trip({ classification: "business", classifiedByKind: "rule" }),
      [commuteRule],
    );
    // Rule output is not human intent, so a corrected rule set may revise it.
    expect(outcome.classification).toBe("commute");
  });
});

describe("qualifiesForRepeatedRoute", () => {
  const candidate = {
    kind: "repeated_route" as const,
    start: OFFICE,
    end: SITE,
    matchRadiusMetres: 200,
  };

  function driverTrip(classification: "business" | "personal"): ClassifiableTrip {
    return trip({ start: OFFICE, end: SITE, classification, classifiedByKind: "driver" });
  }

  it("qualifies once the driver has classified the route the same way enough times", () => {
    const history = Array.from({ length: REPEATED_ROUTE_THRESHOLD }, () =>
      driverTrip("business"),
    );
    expect(qualifiesForRepeatedRoute(history, candidate)).toBe("business");
  });

  it("does not qualify below the threshold", () => {
    const history = Array.from({ length: REPEATED_ROUTE_THRESHOLD - 1 }, () =>
      driverTrip("business"),
    );
    expect(qualifiesForRepeatedRoute(history, candidate)).toBeNull();
  });

  it("does not qualify when the driver has classified the route inconsistently", () => {
    const history = [driverTrip("business"), driverTrip("business"), driverTrip("personal")];
    // An ambiguous route is exactly the one a person should keep deciding.
    expect(qualifiesForRepeatedRoute(history, candidate)).toBeNull();
  });

  it("ignores rule-classified history when deciding to automate", () => {
    const history = Array.from({ length: REPEATED_ROUTE_THRESHOLD }, () =>
      trip({ start: OFFICE, end: SITE, classification: "business", classifiedByKind: "rule" }),
    );
    // Automating off your own automation would let one bad rule entrench itself.
    expect(qualifiesForRepeatedRoute(history, candidate)).toBeNull();
  });
});
