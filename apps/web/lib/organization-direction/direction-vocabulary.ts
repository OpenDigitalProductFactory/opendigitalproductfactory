// Client-safe limits for the instance's direction (BI-916216E7). Shared by the
// DirectionPanel (a client component) and the server-side validation in
// direction.ts, so the form and the server agree on one set of numbers.

export const MAX_INSTANCE_OUTCOMES = 5;

export const DIRECTION_LIMITS = {
  mission: 500,
  vision: 500,
  statement: 200,
  measure: 300,
} as const;

/** Where the owner sets the direction: the setup step and the Needs-you link. */
export const DIRECTION_PANEL_HREF = "/storefront/settings/business?section=direction";
