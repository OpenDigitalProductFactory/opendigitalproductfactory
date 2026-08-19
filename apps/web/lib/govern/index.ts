// lib/govern/index.ts — IT4IT S6 Governance (AGT-ORCH-800 + AGT-ORCH-000)
// Barrel export for the govern (auth/credentials/policy) domain module.
// governance-data/resolver/types + user-governance moved to lib/governance/
// (Simplify & Strengthen W10 govern-vs-governance collision resolution).
export * from "./auth";
export * from "./auth-utils";
export * from "./permissions";
export * from "./manager-scope";
export * from "./principal-context";
export * from "./approval-authority";
export * from "./credential-crypto";
export * from "./password";
export * from "./password-reset";
export * from "./social-auth";
export * from "./provider-oauth";
export * from "./compliance-types";
export * from "./regulatory-monitor-types";
export * from "./policy-types";
