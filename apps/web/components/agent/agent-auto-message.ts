export type AutoMessageDispatchTarget = {
  targetBuildId?: string | null;
  activeBuildId: string | null;
  threadId: string | null;
};

export type AutoMessageSignatureState = {
  signature: string;
  at: number;
} | null;

export function shouldDispatchAutoMessageImmediately({
  targetBuildId,
  activeBuildId,
  threadId,
}: AutoMessageDispatchTarget): boolean {
  if (!targetBuildId) {
    return true;
  }

  return targetBuildId === activeBuildId && threadId != null;
}

export function shouldSuppressAutoMessage(params: {
  last: AutoMessageSignatureState;
  nextSignature: string;
  now: number;
  suppressWindowMs?: number;
}): boolean {
  const { last, nextSignature, now, suppressWindowMs = 750 } = params;
  if (!last) {
    return false;
  }

  return last.signature === nextSignature && now - last.at < suppressWindowMs;
}

/**
 * Is a queued auto-message the one this thread should release?
 *
 * Both drains ask the same question — the thread-load callback and the effect
 * that covers an already-loaded thread — so the predicate lives here rather
 * than being written twice and drifting.
 */
export function queuedAutoMessageIsForThread(params: {
  queued: { targetBuildId?: string | null; routeContext?: string | null } | null;
  threadId: string | null;
  activeBuildId: string | null;
  pathname: string;
  threadContext: string | null;
}): boolean {
  const { queued, threadId, activeBuildId, pathname, threadContext } = params;
  if (!queued || !threadId) return false;
  const expectedBuildId = activeBuildId && pathname === "/build" ? activeBuildId : null;
  if ((queued.targetBuildId ?? null) !== expectedBuildId) return false;
  return !queued.routeContext || queued.routeContext === threadContext;
}

export type AutoMessagePlan = {
  send: boolean;
  message: string;
  targetBuildId: string | null;
  routeContext: string | null;
};

/**
 * Decide whether an auto-message goes out now or waits for the thread to catch
 * up. Pure, so the three-way choice can be tested without a rendered Shell.
 */
export function planAutoMessage(params: {
  message: string;
  targetBuildId: string | null;
  requestedRouteContext: string | null;
  threadContext: string | null;
  activeBuildId: string | null;
  threadId: string | null;
}): AutoMessagePlan {
  const { message, targetBuildId, requestedRouteContext } = params;
  const queued = (routeContext: string | null): AutoMessagePlan => ({
    send: false, message, targetBuildId, routeContext,
  });
  // A route switch was requested: hold until threadContext advances to it.
  if (requestedRouteContext && requestedRouteContext !== params.threadContext) {
    return queued(requestedRouteContext);
  }
  // Route-level auto-messages carry no target build and must fire right away
  // (the onboarding COO introducing each setup step depends on this).
  if (shouldDispatchAutoMessageImmediately({
    targetBuildId,
    activeBuildId: params.activeBuildId,
    threadId: params.threadId,
  })) {
    return { send: true, message, targetBuildId, routeContext: null };
  }
  if (targetBuildId) return queued(null);
  return { send: true, message, targetBuildId, routeContext: null };
}
