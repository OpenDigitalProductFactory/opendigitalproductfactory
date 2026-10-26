import type { GppGate } from "./gpp-shape-schema.ts";

export type GateRatificationEntry =
  | { status: "proposed"; proposed: GppGate; basis: string }
  | { status: "ratified"; proposed: GppGate; basis: string; decisionId: string; ratifiedAt: string };

/** Lookup only. Authenticity, current validity and owning-scope ratification stay with the host. */
export function ratifiedGateFor(decisionScope: string, table: Readonly<Record<string, GateRatificationEntry>>): GppGate | null {
  const entry = Object.hasOwn(table, decisionScope) ? table[decisionScope] : undefined;
  return entry?.status === "ratified" ? entry.proposed : null;
}
