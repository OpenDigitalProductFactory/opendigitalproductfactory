// Back-compat shim. The org-capability read path was rehomed to the
// surface-neutral `org-capabilities.server.ts` — it gates every archetype
// family, not just civic/governance surfaces (spec 2026-07-24-capability-
// enforcement-completion §5.2). Existing importers keep working through this
// re-export for one release; new consumers should import from
// `@/lib/storefront/org-capabilities.server` directly.
export {
  getActiveOrgCapabilities,
  hasActiveOrgCapability,
} from "@/lib/storefront/org-capabilities.server";
