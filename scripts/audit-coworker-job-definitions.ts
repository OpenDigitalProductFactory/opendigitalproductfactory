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

type RegistryAgent = {
  agent_id: string;
  /** The purpose axis's declared home (design §3) — why this role exists. */
  capability_domain?: string;
  escalates_to?: string;
  value_stream?: string;
  /**
   * Per-axis waivers: "this axis does not apply to this role, for this reason,
   * and the decision expires on this date".
   *
   * WHY THIS EXISTS. The contract has defined `{ state: "waived", reason,
   * reviewBy }` since its first slice, and establish_coworker honours it — but
   * this audit read NO waiver input, deriving every axis from planes and
   * registry fields alone. So a role that is genuinely event-triggered rather
   * than standing could never be anything but OPEN on the cadence axis, however
   * carefully anyone reasoned about it. There was nowhere to record the answer.
   *
   * Same shape and same discipline as `staffing_posture` (BI-4CE4F52F): one
   * home, two readers, a reason a person can argue with, and a review date the
   * build FAILS on once it passes. A waiver is a decision with an expiry, not
   * amnesia.
   */
  job_definition_waivers?: Partial<Record<JobDefinitionAxis, { reason: string; reviewBy: string }>>;
};

/** A waiver's reason must be arguable; the contract's own floor (MIN_JUSTIFICATION). */
const MIN_WAIVER_REASON = 40;

export type WaiverProblem = { agentId: string; axis: string; code: string; detail: string };

/**
 * Validate every declared waiver. Returns problems rather than throwing so the
 * audit can report all of them at once.
 *
 * The expiry check is the point: a waiver whose date has passed is not a waiver,
 * it is an unanswered axis wearing one. Re-decide it; never extend it because the
 * build is red.
 */
export function validateWaivers(
  rows: readonly RegistryAgent[],
  now: Date = new Date(),
): WaiverProblem[] {
  const problems: WaiverProblem[] = [];
  for (const row of rows) {
    for (const [axis, waiver] of Object.entries(row.job_definition_waivers ?? {})) {
      if (!JOB_DEFINITION_AXES.includes(axis as JobDefinitionAxis)) {
        problems.push({
          agentId: row.agent_id, axis, code: "unknown-axis",
          detail: `"${axis}" is not a job-definition axis.`,
        });
        continue;
      }
      if ((waiver?.reason ?? "").trim().length < MIN_WAIVER_REASON) {
        problems.push({
          agentId: row.agent_id, axis, code: "thin-justification",
          detail: `${axis} is waived with ${(waiver?.reason ?? "").trim().length} characters of reason; `
            + "a waiver a reader cannot disagree with is a blank.",
        });
      }
      const due = new Date(waiver?.reviewBy ?? "");
      if (Number.isNaN(due.getTime())) {
        problems.push({
          agentId: row.agent_id, axis, code: "unparseable-review-date",
          detail: `${axis} waiver has an unparseable reviewBy (${waiver?.reviewBy}).`,
        });
      } else if (due.getTime() <= now.getTime()) {
        problems.push({
          agentId: row.agent_id, axis, code: "expired-waiver",
          detail: `${axis} waiver expired on ${waiver?.reviewBy} — re-decide it rather than extending it.`,
        });
      }
    }
  }
  return problems;
}

type AxisStatus = "answered" | "waived" | "open";

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
    // A declared waiver answers the axis — and stays VISIBLE as "waived" rather
    // than being folded into "answered", because a reader must be able to tell a
    // role that satisfied an axis from one that decided it does not apply.
    const waiver = reg?.job_definition_waivers?.[axis];
    if (waiver) {
      axes[axis] = "waived";
      continue;
    }
    const plane = AXIS_TO_CAPABILITY_PLANE[axis];
    if (plane) {
      const state = agent.planes?.[plane];
      // No plane state at all is OPEN, not answered: absence of evidence is
      // exactly what this audit is looking for.
      axes[axis] = state && Number(state.level) >= Number(state.ceiling) ? "answered" : "open";
      continue;
    }
    // The three axes the measure does not grade, because they describe a
    // coworker's definition and place rather than its capability.
    if (axis === "purpose") {
      // Its declared home (design §3), not the identity plane's status flag
      // (DI-4560387876E1). A role that has said why it exists has answered this,
      // whether or not it has been promoted to active yet — and a role promoted
      // to active that has NOT said so has not.
      axes[axis] = (reg?.capability_domain ?? "").trim() ? "answered" : "open";
    } else if (axis === "supervision") {
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

  // Validate every waiver BEFORE reporting anything. An expired or thin waiver
  // must not quietly answer an axis — that would make this store the gap-hiding
  // mechanism it exists to not be. Reported and non-zero exit, so the build
  // notices on the day a review date passes rather than whenever someone looks.
  const waiverProblems = validateWaivers([...registry.values()]);
  if (waiverProblems.length > 0) {
    process.stderr.write("job-definition waivers FAILED:\n\n");
    for (const p of waiverProblems) {
      process.stderr.write(`  - ${p.agentId} ${p.axis} [${p.code}]: ${p.detail}\n`);
    }
    process.stderr.write(
      "\nA waiver carries a reason a reader can disagree with and a review date. When the date "
        + "falls due the axis is RE-DECIDED, never extended.\n",
    );
    process.exitCode = 1;
    return;
  }

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
  const waivedCount = rows.reduce(
    (n, r) => n + JOB_DEFINITION_AXES.filter((a) => r.axes[a] === "waived").length,
    0,
  );

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
  if (waivedCount > 0) {
    // Named separately on purpose: a waived axis is a recorded decision with an
    // expiry, not a satisfied one, and a reader must be able to tell them apart.
    console.log(`  of which waived axes: ${waivedCount} (each with a reason and a review date)`);
  }
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
