import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The wiring tests (BI-2624B7EA).
 *
 * The actuator shipped twice in a state that looked delivered and was not.
 *
 *   1. It merged with every unit test green and NOTHING calling it. The module
 *      was inert, not broken — the tests invoked it directly, and nobody
 *      asserted that production code did.
 *   2. It was then wired into `recordEmploymentLifecycleEvent`, and a
 *      per-function test proved that one seam. Three other functions were still
 *      writing employment events that did nothing, and hiring was among them.
 *
 * So these assertions are about the CLASS, not a call site: one canonical writer,
 * every action routed through it, and nothing writing the row directly.
 * `scripts/check-employment-event-writers.mjs` enforces the same invariant
 * repo-wide, including surfaces this file does not name.
 */

const workforceActions = readFileSync(
  fileURLToPath(new URL("../actions/workforce.ts", import.meta.url)),
  "utf8",
);

const actuatorRuntime = readFileSync(
  fileURLToPath(new URL("./employment-event-actuator-runtime.ts", import.meta.url)),
  "utf8",
);

function canonicalWriterBody(): string {
  const start = actuatorRuntime.indexOf("export async function recordAndActuateEmploymentEvent");
  if (start === -1) throw new Error("recordAndActuateEmploymentEvent not found");
  return actuatorRuntime.slice(start);
}

function actionBody(fn: string): string {
  const start = workforceActions.indexOf(`export async function ${fn}`);
  if (start === -1) throw new Error(`${fn} not found`);
  const next = workforceActions.indexOf("\nexport ", start + 1);
  return workforceActions.slice(start, next === -1 ? undefined : next);
}

describe("every EmploymentEvent write actuates", () => {
  it("routes all four action-module writers through the canonical writer", () => {
    // Asserting per-function is what let the half-wired state through, so this
    // asserts every writer instead.
    for (const fn of [
      "createEmployeeProfile",
      "assignEmployeeOrg",
      "reassignEmployeeManager",
      "recordEmploymentLifecycleEvent",
    ]) {
      expect(actionBody(fn), `${fn} must actuate`).toContain(
        "recordAndActuateEmploymentEvent(",
      );
    }
  });

  it("leaves no direct employmentEvent.create in the action module", () => {
    expect(workforceActions).not.toMatch(/employmentEvent\s*\.\s*create\s*\(/);
  });

  it("actuates inside the transaction that writes the event", () => {
    const writer = canonicalWriterBody();
    const create = writer.indexOf("tx.employmentEvent.create");
    const actuate = writer.indexOf("actuateForLifecycleEvent(");

    expect(create).toBeGreaterThan(-1);
    expect(actuate).toBeGreaterThan(create);
    // Same tx handle for both halves — an event must never commit without its room.
    expect(writer).toMatch(/actuateForLifecycleEvent\(\s*tx/);
  });

  it("resolves the worker facts itself rather than trusting the caller", () => {
    // A caller that omitted these would get a permanent stream of operator work
    // that looks exactly like the classification gate working correctly.
    const writer = canonicalWriterBody();
    expect(writer).toContain("employmentType: { select: { classification: true } }");
    expect(writer).toContain("workLocation: { select: { id: true, jurisdictionSlug: true } }");
    expect(writer).toMatch(/businessContext\.findFirst/);
  });

  it("reports the outcome back to the operator", () => {
    expect(workforceActions).toContain("describeActuation(");
  });
});

describe("the actuator is reached by production code, not only by tests", () => {
  it("is imported by the workforce action module", () => {
    expect(workforceActions).toMatch(
      /import\s*\{[\s\S]*recordAndActuateEmploymentEvent[\s\S]*\}\s*from\s*"@\/lib\/workforce\/employment-event-actuator-runtime"/,
    );
  });

  it("is reached by the MCP surface too", () => {
    // Governance approves evidence, not provenance: an event recorded by an
    // agent must open the same room an event recorded through the portal does.
    const pack = readFileSync(
      fileURLToPath(new URL("../mcp/packs/workforce-pack.ts", import.meta.url)),
      "utf8",
    );
    expect(pack).toContain("recordAndActuateEmploymentEvent");
    expect(pack).not.toMatch(/prisma\.employmentEvent\s*\.\s*create\s*\(/);
  });
});
