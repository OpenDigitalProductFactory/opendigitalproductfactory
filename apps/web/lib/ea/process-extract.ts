// apps/web/lib/ea/process-extract.ts
//
// Pure extractor for the BPMN process projection (Parity Engine, domain 6). Platform
// behaviour lives in pure transition tables (the HITL CoworkerActionEnvelope lifecycle,
// the backlog-item lifecycle, …). This projects each such state machine into the
// already-seeded BPMN 2.0 notation so the ACTUAL process flows are represented in a
// notation business users know — and cannot drift, because they are re-derived from
// the transition tables every run.
//
// State-machine → BPMN mapping (states-as-nodes, transitions-as-flows):
//   - the machine         → bpmn_process (proc:<key>)
//   - a synthetic entry   → bpmn_start_event (proc:<key>:start) → the initial state
//   - a non-terminal state→ bpmn_task       (proc:<key>:state:<status>)
//   - a terminal state    → bpmn_end_event  (proc:<key>:end:<status>)
//   - a legal transition  → sequence_flow
// This yields a valid start→…→end BPMN process per machine. The reconcile applies the
// model under the bpmn20 notation via the shared applySysmlModel.

import type { SysmlDesiredModel } from "./sysml-model-seed";

export interface ProcessStateMachine {
  /** Stable key (→ infraCiKey prefix, under "proc:"). */
  key: string;
  name: string;
  statuses: readonly string[];
  isTerminal: (status: string) => boolean;
  /** True iff there is a real (non-self) transition from→to. */
  canTransition: (from: string, to: string) => boolean;
  description?: string;
  /** Explicit entry status; otherwise derived (the no-incoming source, else statuses[0]). */
  initial?: string;
}

const PROC_PREFIX = "proc:";

function nodeKey(mKey: string, status: string, terminal: boolean): string {
  return `${PROC_PREFIX}${mKey}:${terminal ? "end" : "state"}:${status}`;
}

/** Entry status: explicit override → the unique no-incoming status → declared first
 *  (both platform machines list their entry status first). */
function initialStatusOf(m: ProcessStateMachine): string | null {
  if (!m.statuses.length) return null;
  if (m.initial && m.statuses.includes(m.initial)) return m.initial;
  const hasIncoming = (s: string) => m.statuses.some((f) => f !== s && m.canTransition(f, s));
  const sources = m.statuses.filter((s) => !hasIncoming(s));
  return sources[0] ?? m.statuses[0]!;
}

export function buildProcessModel(machines: ProcessStateMachine[]): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  for (const m of machines) {
    const procKey = `${PROC_PREFIX}${m.key}`;
    const startKey = `${PROC_PREFIX}${m.key}:start`;

    elements.push({
      sysmlKey: procKey,
      typeSlug: "bpmn_process",
      name: m.name,
      description: m.description ?? `Process model auto-derived from the ${m.key} state machine.`,
      properties: { sourceKey: `state-machine:${m.key}`, machine: m.key },
    });
    elements.push({
      sysmlKey: startKey,
      typeSlug: "bpmn_start_event",
      name: "Start",
      description: `Entry into the ${m.name}.`,
      properties: { sourceKey: `state-machine:${m.key}:start`, machine: m.key },
    });

    for (const status of m.statuses) {
      const terminal = m.isTerminal(status);
      elements.push({
        sysmlKey: nodeKey(m.key, status, terminal),
        typeSlug: terminal ? "bpmn_end_event" : "bpmn_task",
        name: status,
        description: `${terminal ? "Terminal state" : "State"} "${status}" of the ${m.name}.`,
        properties: { sourceKey: `state-machine:${m.key}:status:${status}`, machine: m.key, status, terminal },
      });
    }

    const initial = initialStatusOf(m);
    if (initial) {
      relationships.push({ fromKey: startKey, toKey: nodeKey(m.key, initial, m.isTerminal(initial)), relSlug: "sequence_flow" });
    }
    for (const from of m.statuses) {
      if (m.isTerminal(from)) continue; // terminals have no outgoing flow
      for (const to of m.statuses) {
        if (from === to || !m.canTransition(from, to)) continue;
        relationships.push({
          fromKey: nodeKey(m.key, from, false),
          toKey: nodeKey(m.key, to, m.isTerminal(to)),
          relSlug: "sequence_flow",
        });
      }
    }
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["bpmn_process", "bpmn_start_event", "bpmn_task", "bpmn_end_event"],
    relTypeSlugs: ["sequence_flow"],
    view: {
      name: "Platform Process Models — Live Projection",
      description:
        "Live BPMN projection of platform process state machines (HITL envelope, backlog lifecycle, …), auto-derived from their transition tables so they cannot drift from the code.",
      viewpointName: "Process Architecture",
      scopeRef: "process-models",
    },
    softRemovePrefix: PROC_PREFIX,
  };
}
