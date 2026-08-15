import { createHash } from "node:crypto";

import {
  DEMO_REF_PREFIX,
  getPerformanceMetricDefinition,
  validateBusinessAnalysisPlan,
} from "@dpf/storefront-templates";

import { BUSINESS_ANALYSIS_WATCH_TASK_KIND } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import {
  RESTAURANT_METRIC_DEFINITION_VERSION,
  restaurantMetricWindow,
} from "@/lib/performance/business-metric-rollup";
import { parseBusinessAnalysisWatchConfig } from "@/lib/performance/business-analysis-watch";

export type PerformanceAcceptanceFixtureDatabase = {
  storefrontConfig: {
    findUnique(input: unknown): Promise<{
      id: string;
      organizationId: string;
      timezone: string;
      archetype: { archetypeId: string };
    } | null>;
  };
  storefrontBooking: { count(input: unknown): Promise<number> };
  platformSetupProgress: {
    findUnique(input: unknown): Promise<{ organizationId: string | null } | null>;
  };
  businessMetricRollup: { upsert(input: unknown): Promise<unknown> };
  scheduledAgentTask: { upsert(input: unknown): Promise<unknown> };
};

type SeedPerformanceAcceptanceFixtureInput = {
  database: PerformanceAcceptanceFixtureDatabase;
  organizationId: string;
  storefrontId: string;
  ownerUserId: string;
  now?: Date;
};

const METRICS = [
  { key: "covers", previous: 80, current: 96, watermarkMinutes: 15 },
  { key: "turn-time", previous: 88, current: 82, watermarkMinutes: 30 },
  { key: "table-utilization", previous: 0.52, current: 0.61, watermarkMinutes: 90 },
  { key: "wait-no-show-rate", previous: 0.12, current: 0.08, watermarkMinutes: 45 },
  { key: "sales", previous: null, current: null, watermarkMinutes: 20 },
  { key: "average-check", previous: null, current: null, watermarkMinutes: 20 },
  { key: "labor-percentage", previous: null, current: null, watermarkMinutes: 20 },
] as const;

const UNAVAILABLE_REASONS: Record<string, string> = {
  sales: "Recognized restaurant sales are not linked in this demo fixture.",
  "average-check": "Average check remains unavailable until recognized sales are linked.",
  "labor-percentage": "Labor percentage remains unavailable until canonical labor cost is linked.",
};

function fixtureTaskId(organizationId: string, ownerUserId: string): string {
  const digest = createHash("sha256")
    .update(`${organizationId}:${ownerUserId}`)
    .digest("hex")
    .slice(0, 20);
  return `demo-performance-watch-${digest}`;
}

export async function seedPerformanceAcceptanceFixture(
  input: SeedPerformanceAcceptanceFixtureInput,
) {
  const now = input.now ?? new Date();
  const storefront = await input.database.storefrontConfig.findUnique({
    where: { id: input.storefrontId },
    select: {
      id: true,
      organizationId: true,
      timezone: true,
      archetype: { select: { archetypeId: true } },
    },
  });
  if (!storefront
    || storefront.organizationId !== input.organizationId
    || storefront.archetype.archetypeId !== "restaurant") {
    throw new Error("Performance acceptance requires an exact organization-scoped restaurant storefront.");
  }
  const [demoBookings, ownerContext] = await Promise.all([
    input.database.storefrontBooking.count({
      where: {
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        bookingRef: { startsWith: DEMO_REF_PREFIX },
      },
    }),
    input.database.platformSetupProgress.findUnique({
      where: { userId: input.ownerUserId },
      select: { organizationId: true },
    }),
  ]);
  if (demoBookings < 1) {
    throw new Error("Performance acceptance requires the seeded restaurant demo before it can write.");
  }
  if (ownerContext?.organizationId !== input.organizationId) {
    throw new Error("Performance acceptance owner must have this organization as their current organization.");
  }

  const current = restaurantMetricWindow(now, storefront.timezone);
  const previous = restaurantMetricWindow(new Date(current.start.getTime() - 1), storefront.timezone);
  // Use the production projection identity so the fixture cannot leave a
  // competing row for the same metric and period. Demo provenance belongs in
  // lineage, not in a second metric definition or dimension.
  const dimensions = { storefrontId: storefront.id };
  const dimensionsHash = createHash("sha256").update(JSON.stringify(dimensions)).digest("hex");

  for (const window of [previous, current]) {
    for (const metric of METRICS) {
      const definition = getPerformanceMetricDefinition(metric.key);
      if (!definition) throw new Error(`Missing performance metric definition: ${metric.key}`);
      const value = window === current ? metric.current : metric.previous;
      const sourceWatermark = window === current
        ? new Date(now.getTime() - metric.watermarkMinutes * 60_000)
        : new Date(previous.end.getTime() - metric.watermarkMinutes * 60_000);
      const identity = {
        organizationId: input.organizationId,
        metricKey: metric.key,
        periodStart: window.start,
        periodEnd: window.end,
        dimensionsHash,
        definitionVersion: RESTAURANT_METRIC_DEFINITION_VERSION,
      };
      const row = {
        ...identity,
        timezone: storefront.timezone,
        dimensions,
        value,
        unit: definition.unit,
        availability: value === null ? "unavailable" : "available",
        unavailableReason: value === null ? UNAVAILABLE_REASONS[metric.key] : null,
        sourceWatermark,
        sourceLineage: {
          sourceModels: ["StorefrontBooking", "HospitalityServiceTurn"],
          sourceRows: demoBookings,
          storefrontId: storefront.id,
          fixture: true,
        },
        computedAt: now,
      };
      await input.database.businessMetricRollup.upsert({
        where: {
          organizationId_metricKey_periodStart_periodEnd_dimensionsHash_definitionVersion: identity,
        },
        create: row,
        update: row,
      });
    }
  }

  const planResult = validateBusinessAnalysisPlan({
    schemaVersion: 1,
    question: "Did covers move enough to deserve attention?",
    intent: "change",
    metrics: [{ key: "covers" }],
    dimensions: [],
    filters: [],
    period: {
      start: current.periodKey,
      end: current.periodKey,
      timezone: storefront.timezone,
      grain: "day",
    },
    comparison: { basis: "prior-period" },
    sources: [{ owner: "restaurant-service", maximumAge: "PT2H" }],
    checks: [{ kind: "completeness" }, { kind: "comparison-baseline" }],
  });
  if (planResult.status !== "accepted") {
    throw new Error("The fixture's governed business-analysis plan was refused.");
  }
  const coversWatermark = new Date(now.getTime() - 15 * 60_000).toISOString();
  const taskConfig = parseBusinessAnalysisWatchConfig({
    schemaVersion: 1,
    plan: planResult.plan,
    fingerprint: planResult.fingerprint,
    materiality: { mode: "relative", direction: "either", value: 0.1 },
    baseline: { value: 80, sourceWatermark: previous.end.toISOString() },
    lastEvaluation: {
      status: "material-change",
      fingerprint: planResult.fingerprint,
      metricKey: "covers",
      baselineValue: 80,
      currentValue: 96,
      delta: 0.2,
      evaluatedAt: now.toISOString(),
      sourceWatermark: coversWatermark,
    },
  });
  const taskId = fixtureTaskId(input.organizationId, input.ownerUserId);
  const task = {
    taskId,
    agentId: "operations-manager",
    title: "Watch covers for a material change",
    prompt: "Evaluate the accepted business analysis plan deterministically.",
    routeContext: "/performance",
    schedule: "0 9 * * 1",
    timezone: "UTC",
    isActive: true,
    ownerUserId: input.ownerUserId,
    organizationId: input.organizationId,
    taskKind: BUSINESS_ANALYSIS_WATCH_TASK_KIND,
    taskConfig,
  };
  await input.database.scheduledAgentTask.upsert({
    where: { taskId },
    create: task,
    update: task,
  });

  return {
    organizationId: input.organizationId,
    storefrontId: input.storefrontId,
    ownerUserId: input.ownerUserId,
    rollups: METRICS.length * 2,
    watchedQuestions: 1,
    taskId,
    fingerprint: planResult.fingerprint,
  };
}
