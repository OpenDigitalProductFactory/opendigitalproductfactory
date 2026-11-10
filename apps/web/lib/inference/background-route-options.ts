import type { RouteAndCallOptions } from "./routed-inference-options";

/** Background callers consume completed responses rather than watching tokens arrive. */
export const BACKGROUND_ROUTE_OPTIONS = { requiresStreaming: false } as const satisfies RouteAndCallOptions;

/** Preserve the caller's routing requirements while stating its non-interactive contract. */
export function backgroundRouteOptions<T extends RouteAndCallOptions>(
  extra?: T,
): Omit<T, "requiresStreaming"> & { requiresStreaming: false } {
  return { ...(extra ?? ({} as T)), ...BACKGROUND_ROUTE_OPTIONS };
}
