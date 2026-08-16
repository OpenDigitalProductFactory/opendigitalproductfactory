// BI-EAD441E0 slice S2 — the repo-declared kernel stance ↔ lifecycle couplings.
//
// These are the platform's OWN standing stances whose stated intent depends on a
// specific grammar element existing. Declaring them in SOURCE (not just per-install
// metadata) is what ships the structural premise fleet-wide: the CI guard
// (lifecycle-grammar-consistency.guard.test.ts) checks these against every grammar
// change, so a structural change that would negate a kernel stance is blocked on
// every install through the normal PR → upstream main → self-upgrade path.
//
// Per-install operator stances declare their OWN dependencies in WikiPage.metadata
// (`lifecycleDependencies`) and are checked at runtime by slice S3 (BI-696B91AB)
// using the SAME analyzer. This file is the kernel-level, source-of-truth half.

import type { StanceDependencies } from "./grammar-negation";

/**
 * Kernel stance couplings. Each entry ties a standing platform stance (by its
 * canonical WWWD slug) to the grammar element its intent rests on. Adding a
 * coupling here protects that structural element fleet-wide.
 */
export const KERNEL_STANCE_DEPENDENCIES: readonly StanceDependencies[] = [
  {
    // "continued / recurring use is the goal" — the recurring-revenue doctrine
    // (business archetype: subscription/usage recurring revenue; the business
    // compounds on retention). Its intent is inert if the value stream has no
    // `retain` stage to instrument, so the OVSM `retain` stage is load-bearing
    // for this stance and must not be silently removed or renamed.
    slug: "stances/how-do-we-manage-the-business-and-what-is-the-goal-of-a-customer-relationship",
    dependencies: [{ grammar: "ovsm", stage: "retain" }],
  },
];
