// The six public OAuth scopes and their consent-screen copy — PURE, with no
// server imports, so a client component (the operator surface for headless
// clients, BI-EDB67A2B) can render them without dragging the grant map, the
// agent registry and their Node-only dependencies into the browser bundle.
// oauth-scope-map.ts re-exports these; it stays the home of the TOTAL mapping
// onto internal grants and of every server-side helper.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.3.1

/** The public scope vocabulary. This is an external API contract: adding a
 *  value is a compatible change, renaming or removing one is not. */
export const PUBLIC_SCOPES = [
  "dpf.read",
  "dpf.work",
  "dpf.build",
  "dpf.business",
  "dpf.operate",
  "dpf.admin",
] as const;

export type PublicScope = (typeof PUBLIC_SCOPES)[number];

/** Human-facing text for the consent screen. Deliberately describes what the
 *  holder can DO to the operator's business, not which internal grants are
 *  involved — the operator is approving an outcome, not a data structure. */
export const PUBLIC_SCOPE_COPY: Record<PublicScope, { title: string; detail: string }> = {
  "dpf.read": {
    title: "Read your platform",
    detail:
      "See backlog, work, documents, code, architecture, customers and operational data — everything you can see. Cannot change anything.",
  },
  "dpf.work": {
    title: "Do governed work",
    detail:
      "Create and update backlog items, workrooms, threads, documents, decisions and evidence, and drive portal screens on your behalf.",
  },
  "dpf.build": {
    title: "Run Build Studio",
    detail:
      "Write build plans, advance phases, record evidence, promote builds, and execute code in the sandbox.",
  },
  "dpf.business": {
    title: "Act on business records",
    detail: "Update customers, CRM, marketing and stock, and produce financial reports.",
  },
  "dpf.operate": {
    title: "Operate the platform",
    detail:
      "Create release and deployment plans, tune and investigate security monitoring, respond to incidents, and execute infrastructure changes.",
  },
  "dpf.admin": {
    title: "Administer the platform",
    detail: "Read and change platform administration, policy and integration configuration.",
  },
};
