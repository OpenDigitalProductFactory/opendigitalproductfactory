import {
  BUSINESS_ANALYSIS_DIMENSIONS,
  PERFORMANCE_METRIC_COMPARISONS,
  PERFORMANCE_METRIC_GRAINS,
  type BusinessAnalysisDimensionKey,
  type PerformanceMetricComparison,
  type PerformanceMetricGrain,
  type PerformanceMetricSensitivity,
} from "./business-view-profile";
import {
  getPerformanceMetricDefinition,
  PERFORMANCE_METRIC_DEFINITION_VERSION,
} from "./performance-metric-catalog";

export const BUSINESS_ANALYSIS_INTENTS = [
  "status",
  "change",
  "diagnosis",
  "decision",
] as const;
export type BusinessAnalysisIntent = (typeof BUSINESS_ANALYSIS_INTENTS)[number];

export const BUSINESS_ANALYSIS_FILTER_OPERATORS = [
  "equals",
  "not-equals",
  "in",
  "not-in",
] as const;
export type BusinessAnalysisFilterOperator = (typeof BUSINESS_ANALYSIS_FILTER_OPERATORS)[number];

export const BUSINESS_ANALYSIS_CHECK_KINDS = [
  "completeness",
  "comparison-baseline",
  "decision-boundary",
] as const;
export type BusinessAnalysisCheckKind = (typeof BUSINESS_ANALYSIS_CHECK_KINDS)[number];

export interface BusinessAnalysisMetricRef {
  readonly key: string;
}

export interface BusinessAnalysisDimension {
  readonly key: BusinessAnalysisDimensionKey;
}

export interface BusinessAnalysisFilter {
  readonly dimension: BusinessAnalysisDimensionKey;
  readonly operator: BusinessAnalysisFilterOperator;
  readonly values: ReadonlyArray<string | number | boolean>;
}

export interface BusinessAnalysisPeriod {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly grain: PerformanceMetricGrain;
}

export interface BusinessAnalysisComparison {
  readonly basis: PerformanceMetricComparison;
}

export interface BusinessAnalysisSourceRequirement {
  readonly owner: string;
  readonly maximumAge: string;
}

export interface BusinessAnalysisCheck {
  readonly kind: BusinessAnalysisCheckKind;
}

export interface BusinessAnalysisPlan {
  readonly schemaVersion: 1;
  readonly question: string;
  readonly intent: BusinessAnalysisIntent;
  readonly metrics: readonly BusinessAnalysisMetricRef[];
  readonly dimensions: readonly BusinessAnalysisDimension[];
  readonly filters: readonly BusinessAnalysisFilter[];
  readonly period: BusinessAnalysisPeriod;
  readonly comparison: BusinessAnalysisComparison;
  readonly sources: readonly BusinessAnalysisSourceRequirement[];
  readonly checks: readonly BusinessAnalysisCheck[];
}

export interface NormalizedBusinessAnalysisPlan extends BusinessAnalysisPlan {
  readonly definitionVersion: string;
  readonly sensitivity: readonly PerformanceMetricSensitivity[];
}

export type BusinessAnalysisIssueCode =
  | "invalid-plan"
  | "unsupported-schema-version"
  | "question-required"
  | "invalid-intent"
  | "metrics-required"
  | "invalid-metric"
  | "unknown-metric"
  | "duplicate-metric"
  | "unsupported-dimension"
  | "duplicate-dimension"
  | "invalid-filter"
  | "invalid-filter-operator"
  | "invalid-period"
  | "invalid-comparison"
  | "comparison-required"
  | "unsupported-comparison"
  | "invalid-source"
  | "duplicate-source-requirement"
  | "missing-source-requirement"
  | "invalid-check"
  | "missing-check";

export interface BusinessAnalysisIssue {
  code: BusinessAnalysisIssueCode;
  path: string;
  message: string;
}

export type BusinessAnalysisPlanResult =
  | {
      status: "accepted";
      plan: NormalizedBusinessAnalysisPlan;
      fingerprint: string;
    }
  | {
      status: "clarification-required";
      issues: BusinessAnalysisIssue[];
    }
  | {
      status: "refused";
      issues: BusinessAnalysisIssue[];
    };

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

const issue = (
  code: BusinessAnalysisIssueCode,
  path: string,
  message: string,
): BusinessAnalysisIssue => ({ code, path, message });

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const byKey = <T extends { key: string }>(left: T, right: T): number =>
  compareText(left.key, right.key);

const byOwner = (
  left: BusinessAnalysisSourceRequirement,
  right: BusinessAnalysisSourceRequirement,
): number => compareText(left.owner, right.owner);

const byKind = <T extends { kind: string }>(left: T, right: T): number =>
  compareText(left.kind, right.kind);

const byFilter = (left: BusinessAnalysisFilter, right: BusinessAnalysisFilter): number =>
  compareText(
    `${left.dimension}:${left.operator}:${JSON.stringify(left.values)}`,
    `${right.dimension}:${right.operator}:${JSON.stringify(right.values)}`,
  );

type JsonScalar = string | number | boolean;

const scalarTypeRank = (value: JsonScalar): number => {
  switch (typeof value) {
    case "boolean": return 0;
    case "number": return 1;
    case "string": return 2;
  }
};

const compareScalar = (left: JsonScalar, right: JsonScalar): number => {
  const rankDifference = scalarTypeRank(left) - scalarTypeRank(right);
  if (rankDifference !== 0) return rankDifference;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return compareText(String(left), String(right));
};

const uniqueScalars = (values: readonly JsonScalar[]): JsonScalar[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = `${typeof value}:${JSON.stringify(value)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const uniqueBy = <T>(values: readonly T[], identityFor: (value: T) => string): T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = identityFor(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const normalizeTimeZone = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value })
      .resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
};

const parseIsoDurationSeconds = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || match.slice(1).every((part) => part === undefined)) return null;
  const parts = match.slice(1).map((part) => Number(part ?? 0));
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = parts;
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
};

const isIsoDuration = (value: unknown): value is string =>
  parseIsoDurationSeconds(value) !== null;

const normalizeIsoDuration = (value: string): string => {
  let remaining = parseIsoDurationSeconds(value)!;
  if (remaining === 0) return "PT0S";
  const days = Math.floor(remaining / 86_400);
  remaining %= 86_400;
  const hours = Math.floor(remaining / 3_600);
  remaining %= 3_600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const datePart = days > 0 ? `${days}D` : "";
  const timePart = [
    hours > 0 ? `${hours}H` : "",
    minutes > 0 ? `${minutes}M` : "",
    seconds > 0 ? `${seconds}S` : "",
  ].join("");
  return `P${datePart}${timePart ? `T${timePart}` : ""}`;
};

function fingerprint(canonical: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return `bap1_${hash.toString(16).padStart(16, "0")}`;
}

function freezeNormalizedPlan(
  plan: NormalizedBusinessAnalysisPlan,
): NormalizedBusinessAnalysisPlan {
  plan.metrics.forEach(Object.freeze);
  plan.dimensions.forEach(Object.freeze);
  plan.filters.forEach((filter) => {
    Object.freeze(filter.values);
    Object.freeze(filter);
  });
  plan.sources.forEach(Object.freeze);
  plan.checks.forEach(Object.freeze);
  Object.freeze(plan.metrics);
  Object.freeze(plan.dimensions);
  Object.freeze(plan.filters);
  Object.freeze(plan.period);
  Object.freeze(plan.comparison);
  Object.freeze(plan.sources);
  Object.freeze(plan.checks);
  Object.freeze(plan.sensitivity);
  return Object.freeze(plan);
}

function parseMetrics(
  value: unknown,
  issues: BusinessAnalysisIssue[],
): BusinessAnalysisMetricRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("metrics-required", "metrics", "Select at least one governed metric."));
    return [];
  }

  const metrics: BusinessAnalysisMetricRef[] = [];
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.key !== "string" || candidate.key.trim() === "") {
      issues.push(issue("invalid-metric", `metrics[${index}]`, "Metric references require a non-empty key."));
      return;
    }
    const key = candidate.key.trim();
    if (seen.has(key)) {
      issues.push(issue("duplicate-metric", `metrics[${index}].key`, `Metric ${key} is repeated.`));
      return;
    }
    seen.add(key);
    if (!getPerformanceMetricDefinition(key)) {
      issues.push(issue("unknown-metric", `metrics[${index}].key`, `Metric ${key} is not in the governed catalog.`));
    }
    metrics.push({ key });
  });
  return metrics;
}

function parseDimensions(
  value: unknown,
  issues: BusinessAnalysisIssue[],
): BusinessAnalysisDimension[] {
  if (!Array.isArray(value)) {
    issues.push(issue("unsupported-dimension", "dimensions", "Dimensions must be an array of governed keys."));
    return [];
  }
  const dimensions: BusinessAnalysisDimension[] = [];
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    const key = isRecord(candidate) ? candidate.key : undefined;
    if (!isOneOf(key, BUSINESS_ANALYSIS_DIMENSIONS)) {
      issues.push(issue("unsupported-dimension", `dimensions[${index}].key`, "Dimension is not in the closed business-analysis contract."));
      return;
    }
    if (seen.has(key)) {
      issues.push(issue("duplicate-dimension", `dimensions[${index}].key`, `Dimension ${key} is repeated.`));
      return;
    }
    seen.add(key);
    dimensions.push({ key });
  });
  return dimensions;
}

function parseFilters(value: unknown, issues: BusinessAnalysisIssue[]): BusinessAnalysisFilter[] {
  if (!Array.isArray(value)) {
    issues.push(issue("invalid-filter", "filters", "Filters must be an array."));
    return [];
  }
  const filters: BusinessAnalysisFilter[] = [];
  value.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      issues.push(issue("invalid-filter", `filters[${index}]`, "Filter must be an object."));
      return;
    }
    if (!isOneOf(candidate.operator, BUSINESS_ANALYSIS_FILTER_OPERATORS)) {
      issues.push(issue("invalid-filter-operator", `filters[${index}].operator`, "Filter operator is not supported."));
      return;
    }
    if (!isOneOf(candidate.dimension, BUSINESS_ANALYSIS_DIMENSIONS)) {
      issues.push(issue("unsupported-dimension", `filters[${index}].dimension`, "Filter dimension is not supported."));
      return;
    }
    if (!Array.isArray(candidate.values) || candidate.values.length === 0 || candidate.values.some(
      (entry) => !["string", "number", "boolean"].includes(typeof entry)
        || (typeof entry === "number" && !Number.isFinite(entry)),
    )) {
      issues.push(issue("invalid-filter", `filters[${index}].values`, "Filter values must contain JSON scalar values."));
      return;
    }
    if ((candidate.operator === "equals" || candidate.operator === "not-equals")
      && candidate.values.length !== 1) {
      issues.push(issue(
        "invalid-filter",
        `filters[${index}].values`,
        `${candidate.operator} requires exactly one filter value.`,
      ));
      return;
    }
    filters.push({
      dimension: candidate.dimension,
      operator: candidate.operator,
      values: candidate.values.map((entry) =>
        typeof entry === "number" && Object.is(entry, -0) ? 0 : entry,
      ) as JsonScalar[],
    });
  });
  return filters;
}

function parsePeriod(value: unknown, issues: BusinessAnalysisIssue[]): BusinessAnalysisPeriod | undefined {
  const timezone = isRecord(value) ? normalizeTimeZone(value.timezone) : null;
  if (!isRecord(value)
    || !isIsoDate(value.start)
    || !isIsoDate(value.end)
    || value.start > value.end
    || !timezone
    || !isOneOf(value.grain, PERFORMANCE_METRIC_GRAINS)) {
    issues.push(issue("invalid-period", "period", "Period requires ordered ISO dates, a timezone, and a supported grain."));
    return undefined;
  }
  return {
    start: value.start,
    end: value.end,
    timezone,
    grain: value.grain,
  };
}

function parseComparison(
  value: unknown,
  issues: BusinessAnalysisIssue[],
): BusinessAnalysisComparison | undefined {
  if (!isRecord(value) || !isOneOf(value.basis, PERFORMANCE_METRIC_COMPARISONS)) {
    issues.push(issue("invalid-comparison", "comparison.basis", "Comparison basis is not supported."));
    return undefined;
  }
  return { basis: value.basis };
}

function parseSources(
  value: unknown,
  issues: BusinessAnalysisIssue[],
): BusinessAnalysisSourceRequirement[] {
  if (!Array.isArray(value)) {
    issues.push(issue("invalid-source", "sources", "Source requirements must be an array."));
    return [];
  }
  const sources: BusinessAnalysisSourceRequirement[] = [];
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    if (!isRecord(candidate)
      || typeof candidate.owner !== "string"
      || candidate.owner.trim() === ""
      || !isIsoDuration(candidate.maximumAge)) {
      issues.push(issue("invalid-source", `sources[${index}]`, "Source requires an owner and ISO 8601 maximum age."));
      return;
    }
    const owner = candidate.owner.trim();
    if (seen.has(owner)) {
      issues.push(issue(
        "duplicate-source-requirement",
        `sources[${index}].owner`,
        `Source ${owner} has more than one freshness requirement.`,
      ));
      return;
    }
    seen.add(owner);
    sources.push({ owner, maximumAge: normalizeIsoDuration(candidate.maximumAge) });
  });
  return sources;
}

function parseChecks(value: unknown, issues: BusinessAnalysisIssue[]): BusinessAnalysisCheck[] {
  if (!Array.isArray(value)) {
    issues.push(issue("invalid-check", "checks", "Verification checks must be an array."));
    return [];
  }
  const checks: BusinessAnalysisCheck[] = [];
  value.forEach((candidate, index) => {
    const kind = isRecord(candidate) ? candidate.kind : undefined;
    if (!isOneOf(kind, BUSINESS_ANALYSIS_CHECK_KINDS)) {
      issues.push(issue("invalid-check", `checks[${index}].kind`, "Verification check is not supported."));
      return;
    }
    checks.push({ kind });
  });
  return checks;
}

export function validateBusinessAnalysisPlan(input: unknown): BusinessAnalysisPlanResult {
  if (!isRecord(input)) {
    return {
      status: "refused",
      issues: [issue("invalid-plan", "$", "Business analysis plan must be an object.")],
    };
  }

  const refusalIssues: BusinessAnalysisIssue[] = [];
  const clarificationIssues: BusinessAnalysisIssue[] = [];

  if (input.schemaVersion !== 1) {
    refusalIssues.push(issue("unsupported-schema-version", "schemaVersion", "Only BusinessAnalysisPlan schema version 1 is supported."));
  }
  if (typeof input.question !== "string" || input.question.trim() === "") {
    refusalIssues.push(issue("question-required", "question", "A business question is required."));
  }
  if (!isOneOf(input.intent, BUSINESS_ANALYSIS_INTENTS)) {
    refusalIssues.push(issue("invalid-intent", "intent", "Analysis intent is not supported."));
  }

  const metrics = parseMetrics(input.metrics, refusalIssues);
  const dimensions = parseDimensions(input.dimensions, refusalIssues);
  const filters = parseFilters(input.filters, refusalIssues);
  const period = parsePeriod(input.period, refusalIssues);
  const comparison = parseComparison(input.comparison, refusalIssues);
  const sources = parseSources(input.sources, refusalIssues);
  const checks = parseChecks(input.checks, refusalIssues);

  const definitions = metrics
    .map(({ key }) => getPerformanceMetricDefinition(key))
    .filter((definition) => definition !== undefined);

  for (const dimension of [...dimensions, ...filters.map(({ dimension }) => ({ key: dimension }))]) {
    for (const definition of definitions) {
      if (!definition.allowedDimensions.includes(dimension.key)) {
        refusalIssues.push(issue(
          "unsupported-dimension",
          "dimensions",
          `Metric ${definition.key} does not support dimension ${dimension.key}.`,
        ));
      }
    }
  }

  if (period) {
    for (const definition of definitions) {
      if (definition.grain !== period.grain) {
        refusalIssues.push(issue(
          "invalid-period",
          "period.grain",
          `Metric ${definition.key} requires ${definition.grain} grain.`,
        ));
      }
    }
  }

  if (comparison && comparison.basis !== "none") {
    for (const definition of definitions) {
      if (!definition.supportedComparisons.includes(comparison.basis)) {
        refusalIssues.push(issue(
          "unsupported-comparison",
          "comparison.basis",
          `Metric ${definition.key} does not support ${comparison.basis} comparison.`,
        ));
      }
    }
  }

  if ((input.intent === "change" || input.intent === "diagnosis") && comparison?.basis === "none") {
    clarificationIssues.push(issue(
      "comparison-required",
      "comparison.basis",
      `${input.intent} analysis requires a comparison basis.`,
    ));
  }

  const sourceOwners = new Set(sources.map(({ owner }) => owner));
  for (const owner of unique(definitions.map(({ sourceOwner }) => sourceOwner))) {
    if (!sourceOwners.has(owner)) {
      refusalIssues.push(issue(
        "missing-source-requirement",
        "sources",
        `Metric source ${owner} requires an explicit freshness limit.`,
      ));
    }
  }

  const checkKinds = new Set(checks.map(({ kind }) => kind));
  if (!checkKinds.has("completeness")) {
    refusalIssues.push(issue("missing-check", "checks", "Every plan requires a completeness check."));
  }
  if ((input.intent === "change" || input.intent === "diagnosis") && !checkKinds.has("comparison-baseline")) {
    refusalIssues.push(issue("missing-check", "checks", "Change and diagnosis plans require a comparison-baseline check."));
  }
  if (input.intent === "decision" && !checkKinds.has("decision-boundary")) {
    refusalIssues.push(issue("missing-check", "checks", "Decision plans require a decision-boundary check."));
  }

  if (refusalIssues.length > 0) return { status: "refused", issues: refusalIssues };
  if (clarificationIssues.length > 0) {
    return { status: "clarification-required", issues: clarificationIssues };
  }

  const normalizedFilters = uniqueBy(
    filters
      .map((filter) => ({
        ...filter,
        values: uniqueScalars(filter.values).sort(compareScalar),
      }))
      .sort(byFilter),
    (filter) => `${filter.dimension}:${filter.operator}:${JSON.stringify(filter.values)}`,
  );

  const normalized = freezeNormalizedPlan({
    schemaVersion: 1,
    question: (input.question as string).trim(),
    intent: input.intent as BusinessAnalysisIntent,
    metrics: [...metrics].sort(byKey),
    dimensions: [...dimensions].sort(byKey),
    filters: normalizedFilters,
    period: period!,
    comparison: comparison!,
    sources: [...sources].sort(byOwner),
    checks: unique(checks.map(({ kind }) => kind)).map((kind) => ({ kind })).sort(byKind),
    definitionVersion: PERFORMANCE_METRIC_DEFINITION_VERSION,
    sensitivity: unique(definitions.map(({ sensitivity }) => sensitivity)).sort(),
  });

  return {
    status: "accepted",
    plan: normalized,
    fingerprint: fingerprint(JSON.stringify(normalized)),
  };
}
