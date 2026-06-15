// BrowserDriver contract (EP-BROWSER-DRIVE, spec 2026-06-05 §8.1).
//
// The single interface the coworker and the per-task means selector depend on —
// never a concrete means. Three adapters implement it (M2 live, M1/M3 stubbed in
// this phase). `act` owns the screenshot-then-replan recovery contract for M2.

import type { BrowserMeans, BrowserEngine, BrowserProfileKind } from "./session-binding";

export type { BrowserMeans, BrowserEngine, BrowserProfileKind };

export type BrowserOpenInput = {
  /** Pre-chosen session id; generated if omitted. */
  sessionId?: string;
  url?: string;
  /** /profiles/<principalId>/<siteKey>/ for service accounts; omit for operator-live. */
  profileRef?: string;
  profileKind: BrowserProfileKind;
  /** Driven surface — Chromium in v1 (§4.10). Defaults to "chromium". */
  engine?: BrowserEngine;
  attended?: boolean;
  /** Navigation allowlist — enforced at the sidecar (Phase 2). */
  targetDomains: string[];
  /** Human the session acts for (always recorded). */
  delegatingUserId: string;
  actingPrincipalId?: string | null;
  delegationGrantId?: string | null;
  credentialId?: string | null;
  evidenceDir?: string;
  /** Per-task WWMD means-selector contribution ledger, persisted on the binding. */
  meansDecisionJson?: unknown;
  /** Audit attribution. */
  agentId: string;
  threadId: string;
  routeContext?: string;
};

export type BrowserSessionHandle = { sessionId: string; means: BrowserMeans };

export type BrowserActResult = {
  status: "completed" | "blocked" | "error";
  detail?: string;
  url?: string;
  screenshotRef?: string;
};
export type BrowserReadResult = { status: "completed" | "error"; data?: unknown; detail?: string };
export type BrowserScreenshotResult = { screenshotRef?: string; base64?: string };
export type BrowserCloseResult = { sessionId: string; status: string; actionCount?: number };

/** Options for a single act/read call (carries the envelope link for gated side effects). */
export type BrowserActOptions = {
  /** Set when this act executes a human-approved CoworkerActionEnvelope (destructive boundary). */
  envelopeId?: string;
};

export interface BrowserDriver {
  readonly means: BrowserMeans;
  open(input: BrowserOpenInput): Promise<BrowserSessionHandle>;
  read(session: BrowserSessionHandle, query: string): Promise<BrowserReadResult>;
  act(session: BrowserSessionHandle, command: string, options?: BrowserActOptions): Promise<BrowserActResult>;
  screenshot(session: BrowserSessionHandle): Promise<BrowserScreenshotResult>;
  close(session: BrowserSessionHandle): Promise<BrowserCloseResult>;
}
