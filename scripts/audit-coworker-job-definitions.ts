/**
 * Run the existing estate through the job-definition contract.
 *
 * THE OPERATOR'S CLOSING INSTRUCTION (2026-09-16): "Once the process is well
 * established and refined, we need to run our gaps through this process to make
 * sure existing instances are properly setup."
 *
 * Slices 1-4 built the contract, made the door demand it, derived job
 * definitions from the archetype's value stream, and derived priming. Those
 * govern coworkers created FROM NOW ON. This audits the ones that already
 * exist.
 *
 * HOW IT AVOIDS INVENTING ANYTHING. It does not ask a model what a coworker's
 * job is. `AXIS_TO_CAPABILITY_PLANE` already pins seven of the nine axes onto
 * the planes the capability measure grades, so each existing coworker's
 * job-definition state is DERIVABLE from the grader:
 *
 *     plane at its ceiling  -> that axis is ANSWERED by substrate that exists
 *     plane below ceiling   -> that axis is OPEN: answer it, or waive it
 *
 * The two axes with no plane (supervision, tailoring) are facts about a
 * coworker's PLACE rather than its capability, and are read from the registry.
 *
 * WHY THIS IS NOT A SECOND MEASURE. It reports the same 67 open gaps the
 * ratchet already tracks, re-expressed as the job questions they answer. A
 * coworker missing a work shape is not "failing plane 4"; it is a hire nobody
 * wrote accountabilities for. That re-framing is the entire point: it converts
 * a compliance number into a worklist a person can act on.
 *
 *   pnpm audit:job-definitions
 *   pnpm audit:job-definitions -- --json   machine-readable, for remediation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AXIS_TO_CAPABILITY_PLANE,
  JOB_DEFINITION_AXES,
  type JobDefinitionAxis,
} from "../packages/db/src/coworker-job-definition";

const REPO_ROOT = join(import.meta.dirname, "..");
const MEASURE = join(
  REPO_ROOT,
  "apps/web/lib/coworker-lifecycle/capability-completeness.generated.json",
);
const REGISTRY = join(REPO_ROOT, "packages/db/data/agent_registry.json");

/** Classes whose gaps are a recorded decision, not a hole (PR #5384). */
const POSTURED = new Set(["superseded", "deliberately-unstaffed"]);

type PlaneState = { level: number; ceiling: number };
type MeasuredAgent = {
  key: string;
  displayName: string;
  identityClass: string;
  handles?: string[];
  planes: Record<string, PlaneState>;
};

type RegistryAgent = { agent_id: string; escalates_to?: string; value_stream?: string };

type AxisStatus = "answered" | "open";

type AuditRow = {
  key: string;
  displayName: string;
  identityClass: string;
  axes: Record<JobDefinitionAxis, AxisStatus>;
  openAxes: JobDefinitionAxis[];
};

function loadMeasure(): MeasuredAgent[] {
  const parsed = JSON.parse(readFileSync(MEASURE, "utf8")) as { agents?: MeasuredAgent[] };
  if (!parsed.agents?.length) {
    throw new Error(
      "capability-completeness.generated.json has no agents — run "
      + "`node scripts/measure-capability-completeness.mjs` first.",
    );
  }
  return parsed.agents;
}

function loadRegistry(): Map<string, RegistryAgent> {
  const parsed = JSON.parse(readFileSync(REGISTRY, "utf8")) as
    | { agents?: RegistryAgent[] }
    | RegistryAgent[];
  const rows = Array.isArray(parsed) ? parsed : parsed.agents ?? [];
  return new Map(rows.map((r) => [r.agent_id, r]));
}

/**
 * Derive one coworker's job-definition state.
 *
 * Nothing here is a judgement about whether the coworker is GOOD. It answers
 * one question per axis: has anyone said this yet?
 */
export function auditAgent(agent: MeasuredAgent, registry: Map<string, RegistryAgent>): AuditRow {
  const axes = {} as Record<JobDefinitionAxis, AxisStatus>;
  const reg = registry.get(agent.key)
    ?? (agent.handles ?? []).map((h) => registry.get(h)).find(Boolean);

  for (const axis of JOB_DEFINITION_AXES) {
    const plane = AXIS_TO_CAPABILITY_PLANE[axis];
    if (plane) {
      const state = agent.planes?.[plane];
      // No plane state at all is OPEN, not answered: absence of evidence is
      // exactly what this audit is looking for.
      axes[axis] = state && Number(state.level) >= Number(state.ceiling) ? "answered" : "open";
      continue;
    }
    // The two axes the measure does not grade, because they describe a
    // coworker's place rather than its capability.
    if (axis === "supervision") {
      axes[axis] = reg?.escalates_to ? "answered" : "open";
    } else {
      // tailoring — a coworker bound to a value stream is placed within the
      // business's own operating model; one that is not, is not.
      axes[axis] = reg?.value_stream ? "answered" : "open";
    }
  }

  return {
    key: agent.key,
    displayName: agent.displayName,
    identityClass: agent.identityClass,
    axes,
    openAxes: JOB_DEFINITION_AXES.filter((a) => axes[a] === "open"),
  };
}

function main(): void {
  const json = process.argv.includes("--json");
  const agents = loadMeasure();
  const registry = loadRegistry();

  // Postured roles are excluded for the same reason the ratchet excludes them:
  // a decision already recorded, with a reason and an expiry, is not a hire
  // waiting to be written up.
  const inScope = agents.filter((a) => !POSTURED.has(a.identityClass));
  const rows = inScope.map((a) => auditAgent(a, registry)).sort((x, y) =>
    y.openAxes.length - x.openAxes.length || x.key.localeCompare(y.key),
  );

  const byAxis = new Map<JobDefinitionAxis, number>();
  for (const axis of JOB_DEFINITION_AXES) {
    byAxis.set(axis, rows.filter((r) => r.axes[axis] === "open").length);
  }
  const complete = rows.filter((r) => r.openAxes.length === 0);

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          inScope: rows.length,
          complete: complete.length,
          openAxisCounts: Object.fromEntries(byAxis),
          rows,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log(`[job-definition-audit] ${rows.length} coworker(s) in scope; `
    + `${agents.length - rows.length} postured and excluded.`);
  console.log(`  complete job definitions: ${complete.length}/${rows.length}`);
  console.log("\n  open by axis — the worklist, as job questions:");
  const QUESTION: Record<JobDefinitionAxis, string> = {
    purpose: "why does this role exist?",
    accountabilities: "what outcomes does it own?",
    authority: "what may it decide alone?",
    cadence: "when does it work without being asked?",
    qualifications: "what tools and skills does it need?",
    context: "what must it know before acting?",
    measures: "how would anyone know it worked?",
    supervision: "who does it answer to?",
    tailoring: "where does it sit in this business?",
  };
  for (const [axis, count] of [...byAxis].sort((a, b) => b[1] - a[1])) {
    if (count === 0) continue;
    console.log(`    ${String(count).padStart(3)}  ${axis.padEnd(17)} ${QUESTION[axis]}`);
  }

  const worst = rows.filter((r) => r.openAxes.length > 0).slice(0, 12);
  if (worst.length > 0) {
    console.log("\n  coworkers with the most unanswered:");
    for (const r of worst) {
      console.log(`    ${r.displayName} (${r.key}) — ${r.openAxes.length}: ${r.openAxes.join(", ")}`);
    }
  }
  console.log(
    "\n  Each open axis is answered by landing the substrate it names, or WAIVED with a reason\n"
    + "  and a review date. A waiver expires; when it falls due the axis is re-decided, never\n"
    + "  extended. See docs/superpowers/specs/2026-09-16-coworker-job-definition-and-establishment-contract-design.md",
  );
}

if (process.argv[1]?.includes("audit-coworker-job-definitions")) main();
