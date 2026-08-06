/**
 * Auth-gated navigation decisions for the root layout.
 *
 * Pulled out of the layout as a pure function so the routing rules are unit
 * testable without an expo-router render harness. The layout wires the live
 * router to whatever target this returns.
 *
 * The anonymous walk-up front door (BI-A9E21384): an unauthenticated app-open
 * lands on the visitor Nearby surface, NOT the login gate — a customer with no
 * account walks up and sees the menu. "Sign in" stays reachable (the `login`
 * route is never redirected away for an anonymous user) but is never required.
 */

/** The anonymous walk-up surface an unauthenticated visitor is allowed on. */
export const VISITOR_HOME = "/(tabs)/nearby" as const;
export const TABS_HOME = "/(tabs)" as const;

export interface AuthRedirectInput {
  /** expo-router `useSegments()` output for the current route. */
  segments: string[];
  isAuthenticated: boolean;
}

/**
 * Decide where (if anywhere) to redirect for the current route + auth state.
 * Returns a route path to `router.replace(...)` to, or `null` to stay put.
 *
 * - Authenticated: only nudge off the `login` screen back into the app; every
 *   other route is left alone so the persona/manifest default tab wins.
 * - Unauthenticated: `login` and `connect` stay reachable (Sign in is optional;
 *   connect is first-run join + in-app business switch), the visitor already on
 *   Nearby is left alone, and every other landing — including the bare `/`
 *   (index) cold open — is sent to the visitor Nearby front door.
 */
export function resolveAuthRedirect(
  input: AuthRedirectInput,
): string | null {
  const { segments, isAuthenticated } = input;
  const root = segments[0];
  const inAuthRoute = root === "login" || root === "connect";

  if (isAuthenticated) {
    return root === "login" ? TABS_HOME : null;
  }

  // Anonymous: Nearby is the front door, not the login gate.
  const tabSegment = root === "(tabs)" ? segments[1] : undefined;
  const onVisitorSurface = tabSegment === "nearby";
  if (inAuthRoute || onVisitorSurface) return null;
  return VISITOR_HOME;
}
