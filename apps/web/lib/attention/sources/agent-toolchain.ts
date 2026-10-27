// Agent-toolchain source (BI-3E66F76F, S4 of BI-63672FBE; spec
// 2026-10-27-self-converging-agent-toolchain M9). Each computer that runs DPF's
// agent clients converges its own toolchain through the host agent
// (toolchain_agent.py), and every connection reports how that agent last fared.
// A host that has been failing, or waiting on the operator, for more than a day
// is the one case automation cannot clear, so it becomes ONE attention item per
// connection credential. Healthy, recently failing, opted-out, ahead-of-portal
// and long-silent hosts raise nothing. Read-only projection of
// AgentToolchainObservation; the row's lifecycle stays owned by the observer.

import type { prisma } from "@dpf/db";

import { clientProduct } from "@/lib/agent-toolchain/connected-clients";
import type { ToolchainObservationRow } from "@/lib/agent-toolchain/fleet-readiness";

import type { AttentionItem } from "../types";

type Db = typeof prisma;

export const CONVERGE_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A host silent this long is unknown, not failing; the fleet view already says so. */
const SILENT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ESCALATING = new Set(["failed", "needs_operator"]);

/** The single plain-words action for each code a host can stop on. */
function operatorStep(status: string, code: string | null): string {
  switch (code) {
    case "identity_changed":
    case "identity_mismatch":
      return "This portal's identity changed since the computer was paired. Confirm the new identity is yours before the computer will update again.";
    case "not-paired":
      return "The computer has never been paired with this portal. Approve one update from the portal on that computer; after that it updates itself.";
    case "ambiguous-origin":
      return "The computer is paired with more than one portal. Choose which one it follows in ~/.dpf/toolchain-agent/config.json.";
    case "not-bootstrapped":
      return "The DPF tools were never installed on that computer. Approve one update from the portal to install them.";
    case "needs-runtime":
      return "The computer has no program that can read its Codex settings. Installing Python 3.11 or newer lets it finish updating.";
    default:
      return status === "needs_operator"
        ? "The computer's update agent stopped and needs a person to look at it."
        : "The computer's update agent keeps failing. The details are on the Self-upgrade page.";
  }
}

/** Pure: newest report per credential, escalated only past a day of failure. */
export function agentToolchainAttentionItems(rows: ToolchainObservationRow[], now: Date): AttentionItem[] {
  const newest = new Map<string, ToolchainObservationRow>();
  for (const row of rows) {
    const seen = newest.get(row.credentialRef);
    if (!seen || row.lastObservedAt > seen.lastObservedAt) newest.set(row.credentialRef, row);
  }
  const items: AttentionItem[] = [];
  for (const row of newest.values()) {
    if (!row.convergeStatus || !ESCALATING.has(row.convergeStatus)) continue;
    if (now.getTime() - row.lastObservedAt.getTime() > SILENT_AFTER_MS) continue;
    const since = row.convergeSince ?? null;
    if (!since || now.getTime() - since.getTime() < CONVERGE_ESCALATE_AFTER_MS) continue;
    const { product } = clientProduct(row);
    const name = product ?? "An agent client";
    items.push({
      id: `agent-toolchain:${row.credentialRef}`,
      source: "agent-toolchain",
      title: `${name} on one of your computers has not been able to update its DPF tools`,
      context: operatorStep(row.convergeStatus, row.convergeCode ?? null),
      decisionClass: { scorability: "unscorable" },
      riskClass: "bounded-write",
      triage: {
        timeToAct: "none",
        residueReason: row.convergeStatus === "needs_operator" ? "needs-credential" : "no-self-heal",
        decideEffort: "review",
        irreversible: false,
      },
      createdAtIso: since.toISOString(),
      actions: [{ kind: "open-in-context", label: "Open Self-upgrade", href: "/ops/self-upgrade" }],
      deepLink: "/ops/self-upgrade",
      audience: { operator: true },
    });
  }
  return items;
}

export async function loadAgentToolchainItems(db: Db, now: Date = new Date()): Promise<AttentionItem[]> {
  const rows = (await db.agentToolchainObservation.findMany({
    where: {
      convergeStatus: { in: ["failed", "needs_operator"] },
      lastObservedAt: { gte: new Date(now.getTime() - SILENT_AFTER_MS) },
    },
    orderBy: { lastObservedAt: "desc" },
    take: 500,
  })) as unknown as ToolchainObservationRow[];
  return agentToolchainAttentionItems(rows, now);
}
