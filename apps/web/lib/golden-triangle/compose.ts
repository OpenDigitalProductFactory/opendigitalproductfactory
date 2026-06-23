/**
 * EP-GOLDEN-TRIANGLE Slice 3 (BI-CF28CCF0) — composition: map a compiled
 * `PostureOverride` into the inputs the routing layer accepts.
 *
 * `inferContract()`'s `routeContext` accepts `budgetClass` / `reasoningDepth` /
 * `minimumTier` / `minimumDimensions` / `maxLatencyMs` / `residencyPolicy`
 * (the last two pre-existing; the others added additively in Slice 3). `effort`
 * is NOT a `RequestContract` field — it rides `AgentRouteConfig`/routeOptions —
 * so it is returned separately for the caller to thread into the dispatch
 * options rather than the contract.
 *
 * The compiler still FEEDS routing; it never re-implements it.
 */
import type { Effort, PostureOverride } from "./types";

export interface PostureRouteContext {
  budgetClass?: PostureOverride["budgetClass"];
  reasoningDepth?: PostureOverride["reasoningDepth"];
  minimumTier?: PostureOverride["minimumTier"];
  maxLatencyMs?: number;
  residencyPolicy?: PostureOverride["residencyPolicy"];
}

export interface AppliedPosture {
  /** Spread into `inferContract()`'s `routeContext` caller-override argument. */
  routeContext: PostureRouteContext;
  /** Thread into `AgentRouteConfig`/routeOptions — NOT the request contract. */
  effort?: Effort;
}

/**
 * Split a `PostureOverride` into the routing-contract fields (for `inferContract`)
 * and the `effort` lever (for routeOptions). Undefined fields are omitted so the
 * result is safe to spread over an existing route context without clobbering.
 */
export function applyPostureToRouteContext(posture: PostureOverride): AppliedPosture {
  const routeContext: PostureRouteContext = {};
  if (posture.budgetClass !== undefined) routeContext.budgetClass = posture.budgetClass;
  if (posture.reasoningDepth !== undefined) routeContext.reasoningDepth = posture.reasoningDepth;
  if (posture.minimumTier !== undefined) routeContext.minimumTier = posture.minimumTier;
  if (posture.maxLatencyMs !== undefined) routeContext.maxLatencyMs = posture.maxLatencyMs;
  if (posture.residencyPolicy !== undefined) routeContext.residencyPolicy = posture.residencyPolicy;
  return { routeContext, effort: posture.effort };
}
