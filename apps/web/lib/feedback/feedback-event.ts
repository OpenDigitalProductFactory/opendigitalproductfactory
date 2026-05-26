export const FEEDBACK_TRIGGER_KINDS = [
  "manual",
  "runtime-error",
  "grant-denied",
  "structural-verification-fail",
  "coworker-stall",
  "issue-spike",
] as const;

export type FeedbackTriggerKind = (typeof FEEDBACK_TRIGGER_KINDS)[number];

export type FeedbackAutoFilePolicy = "ask" | "auto-hard-failure";

export type FeedbackEventDetail = {
  triggerKind: FeedbackTriggerKind;
  routeContext: string;
  title?: string;
  description?: string;
  errorStack?: string;
  userAgent?: string;
  featureBuildId?: string;
  threadId?: string;
  taskRunId?: string;
  sourceId?: string;
  autoFilePolicy?: FeedbackAutoFilePolicy;
  supportSessionId: string;
};

const SUPPORT_SESSION_ID_PREFIX = "dpf_support_";
const SUPPORT_SESSION_ID_RANDOM_BYTES = 16;
const SUPPORT_SESSION_ID_PATTERN = /^dpf_support_[a-f0-9]{32}$/;
const MAX_ROUTE_CONTEXT_LENGTH = 512;
const ROUTE_CONTEXT_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const OPTIONAL_STRING_KEYS = [
  "title",
  "description",
  "errorStack",
  "userAgent",
  "featureBuildId",
  "threadId",
  "taskRunId",
  "sourceId",
] as const;

function isFeedbackTriggerKind(value: unknown): value is FeedbackTriggerKind {
  return typeof value === "string" && FEEDBACK_TRIGGER_KINDS.includes(value as FeedbackTriggerKind);
}

function isFeedbackAutoFilePolicy(value: unknown): value is FeedbackAutoFilePolicy | undefined {
  return value === undefined || value === "ask" || value === "auto-hard-failure";
}

function generateSupportSessionId(): string {
  const bytes = new Uint8Array(SUPPORT_SESSION_ID_RANDOM_BYTES);
  const crypto = globalThis.crypto;

  if (!crypto?.getRandomValues) {
    throw new Error("Web Crypto getRandomValues is required to create support feedback events");
  }

  crypto.getRandomValues(bytes);

  return `${SUPPORT_SESSION_ID_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeFeedbackRoute(routeContext: string): string {
  const rawRoute = routeContext.trim();

  if (!rawRoute) {
    throw new Error("Invalid feedback route context");
  }

  const schemeMatch = rawRoute.match(/^([a-z][a-z0-9+.-]*):/i);
  const routeWithoutOrigin = schemeMatch
    ? normalizeAbsoluteFeedbackRoute(rawRoute, schemeMatch[1])
    : rawRoute.split(/[?#]/, 1)[0];
  const routeWithLeadingSlash = routeWithoutOrigin.startsWith("/") ? routeWithoutOrigin : `/${routeWithoutOrigin}`;
  const normalizedRoute = routeWithLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";

  if (!isValidFeedbackRoute(normalizedRoute)) {
    throw new Error("Invalid feedback route context");
  }

  return normalizedRoute;
}

function normalizeAbsoluteFeedbackRoute(routeContext: string, scheme: string): string {
  if (scheme !== "http" && scheme !== "https") {
    throw new Error("Invalid feedback route context");
  }

  return new URL(routeContext).pathname;
}

export function createManualFeedbackEventDetail(routeContext: string): FeedbackEventDetail {
  return {
    routeContext: normalizeFeedbackRoute(routeContext),
    triggerKind: "manual",
    supportSessionId: generateSupportSessionId(),
    autoFilePolicy: "ask",
  };
}

export function isFeedbackEventDetail(value: unknown): value is FeedbackEventDetail {
  if (!value || typeof value !== "object") {
    return false;
  }

  const detail = value as Partial<FeedbackEventDetail>;

  return (
    isFeedbackTriggerKind(detail.triggerKind) &&
    typeof detail.routeContext === "string" &&
    isValidFeedbackRoute(detail.routeContext) &&
    typeof detail.supportSessionId === "string" &&
    SUPPORT_SESSION_ID_PATTERN.test(detail.supportSessionId) &&
    isFeedbackAutoFilePolicy(detail.autoFilePolicy) &&
    OPTIONAL_STRING_KEYS.every((key) => detail[key] === undefined || typeof detail[key] === "string")
  );
}

function isValidFeedbackRoute(routeContext: string): boolean {
  if (routeContext.length === 0 || routeContext.length > MAX_ROUTE_CONTEXT_LENGTH) {
    return false;
  }

  if (routeContext.includes("?") || routeContext.includes("#")) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(routeContext)) {
    return false;
  }

  return ROUTE_CONTEXT_PATTERN.test(routeContext);
}
