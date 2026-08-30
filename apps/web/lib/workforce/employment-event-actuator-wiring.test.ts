import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The wiring test (BI-2624B7EA).
 *
 * The actuator shipped once with every unit test green and NOTHING CALLING IT.
 * `EmploymentEvent` rows were still written by `recordEmploymentLifecycleEvent`
 * and still did nothing, because the subscriber was never invoked — a module can
 * be perfectly tested and completely inert.
 *
 * These assertions read the action source directly. They are deliberately
 * structural: a mocked-Prisma behaviour test proves the actuator works when
 * called, which is exactly the thing that was already true and still left the
 * epic undelivered. What needed proving is that the call EXISTS on the path that
 * writes the event.
 */

const workforceActions = readFileSync(
  fileURLToPath(new URL("../actions/workforce.ts", import.meta.url)),
  "utf8",
);

function recordEmploymentLifecycleEventBody(): string {
  const start = workforceActions.indexOf("export async function recordEmploymentLifecycleEvent");
  if (start === -1) throw new Error("recordEmploymentLifecycleEvent not found");
  const next = workforceActions.indexOf("\nexport ", start + 1);
  return workforceActions.slice(start, next === -1 ? undefined : next);
}

describe("the event-writing path actually invokes the actuator", () => {
  const body = recordEmploymentLifecycleEventBody();

  it("calls the actuator", () => {
    expect(body).toContain("actuateForLifecycleEvent(");
  });

  it("writes the EmploymentEvent and actuates in the SAME transaction", () => {
    // An event that commits without its room is the silent failure-to-act the
    // epic exists to remove.
    const txStart = body.indexOf("prisma.$transaction");
    const eventWrite = body.indexOf("tx.employmentEvent.create");
    const actuate = body.indexOf("actuateForLifecycleEvent(");

    expect(txStart).toBeGreaterThan(-1);
    expect(eventWrite).toBeGreaterThan(txStart);
    expect(actuate).toBeGreaterThan(eventWrite);
  });

  it("passes the transaction client, not the ambient prisma client", () => {
    expect(body).toMatch(/actuateForLifecycleEvent\(\s*tx\b/);
  });

  it("the helper it calls really does reach actuateEmploymentEvent", () => {
    // Guards the indirection: a helper that stopped actuating would leave every
    // assertion above green while the event quietly went back to doing nothing.
    const runtime = readFileSync(
      fileURLToPath(new URL("./employment-event-actuator-runtime.ts", import.meta.url)),
      "utf8",
    );
    const helper = runtime.slice(runtime.indexOf("export async function actuateForLifecycleEvent"));
    expect(helper).toContain("actuateEmploymentEvent(");
    expect(helper).toContain("prismaActuatorWriter(");
  });

  it("supplies the worker facts the actuator refuses to guess", () => {
    // Without these in the select, every event would resolve to operator work.
    expect(body).toContain("employmentType: { select: { classification: true } }");
    expect(body).toContain("workLocation: { select: { id: true, jurisdictionSlug: true } }");
  });

  it("reads the organisation's employing jurisdictions", () => {
    expect(body).toMatch(/businessContext\.findFirst/);
    expect(body).toContain("employsIn");
  });

  it("reports what the event did back to the operator", () => {
    // An actuator that silently succeeds is only marginally better than the log
    // it replaced, and swallowed operator work never reaches the person who can
    // resolve it.
    expect(body).toContain("describeActuation(");
  });
});

describe("the actuator module is imported by production code, not only by tests", () => {
  it("is imported by the workforce action module", () => {
    expect(workforceActions).toMatch(
      /import\s*\{[\s\S]*actuateForLifecycleEvent[\s\S]*\}\s*from\s*"@\/lib\/workforce\/employment-event-actuator-runtime"/,
    );
  });
});
