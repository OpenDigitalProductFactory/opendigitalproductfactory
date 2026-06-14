import { describe, expect, it } from "vitest";

import {
  type AssignmentCandidate,
  type DispatchBoard,
  type DispatchBoardJob,
  type EquipmentWarranty,
  planBoardActions,
  planCompletionActions,
  planDepartureActions,
} from "./index";

const NOW = "2026-06-14T08:00:00.000Z";

const job = (over: Partial<DispatchBoardJob> = {}): DispatchBoardJob => ({
  jobId: "J1",
  status: "scheduled",
  scheduledForIso: "2026-06-15T09:00:00.000Z", // ~25h out → inside the 36h window
  notificationVars: { company: "Acme HVAC" },
  ...over,
});

const tech = (id: string, over: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
  resourceId: id,
  skills: ["hvac"],
  available: true,
  proximityScore: 0.5,
  loadFactor: 0,
  valueFit: 0.5,
  ...over,
});

const board = (jobs: DispatchBoardJob[], resources: AssignmentCandidate[] = []): DispatchBoard => ({ jobs, resources });

describe("planBoardActions — confirmations (F2a)", () => {
  it("proposes a confirmation for a scheduled-unconfirmed job inside the window", () => {
    const actions = planBoardActions(board([job()]), NOW);
    const confirm = actions.find((a) => a.kind === "notify" && a.intent.event === "confirm");
    expect(confirm).toBeDefined();
    expect(confirm).toMatchObject({ kind: "notify", jobId: "J1" });
  });

  it("does not propose a confirmation once the customer has confirmed", () => {
    const actions = planBoardActions(board([job({ confirmedAtIso: "2026-06-14T07:00:00.000Z" })]), NOW);
    expect(actions.some((a) => a.kind === "notify" && a.intent.event === "confirm")).toBe(false);
  });

  it("does not propose a confirmation for a visit beyond the look-ahead window", () => {
    const actions = planBoardActions(board([job({ scheduledForIso: "2026-06-30T09:00:00.000Z" })]), NOW);
    expect(actions.some((a) => a.kind === "notify" && a.intent.event === "confirm")).toBe(false);
  });
});

describe("planBoardActions — assignment (F4)", () => {
  it("proposes the best eligible resource for an unassigned job", () => {
    const actions = planBoardActions(
      board([job({ requiredSkills: ["hvac"] })], [tech("FAR", { proximityScore: 0.2 }), tech("NEAR", { proximityScore: 0.95 })]),
      NOW,
    );
    const assign = actions.find((a) => a.kind === "assign");
    expect(assign).toMatchObject({ kind: "assign", jobId: "J1", resourceId: "NEAR" });
  });

  it("flags unassignable when no resource has the required skill", () => {
    const actions = planBoardActions(board([job({ requiredSkills: ["welding"] })], [tech("T1", { skills: ["hvac"] })]), NOW);
    expect(actions.some((a) => a.kind === "flag-unassignable" && a.jobId === "J1")).toBe(true);
    expect(actions.some((a) => a.kind === "assign")).toBe(false);
  });

  it("does not propose an assignment for an already-assigned job", () => {
    const actions = planBoardActions(board([job({ assignedResourceId: "T1" })], [tech("T1")]), NOW);
    expect(actions.some((a) => a.kind === "assign")).toBe(false);
  });

  it("an emergency job favors proximity over value-fit (composition with F4 weights)", () => {
    const emergency = job({ requiredSkills: ["hvac"], urgency: "emergency", valueWeight: 1, scheduledForIso: null });
    const actions = planBoardActions(
      board([emergency], [tech("FAR_SENIOR", { proximityScore: 0.1, valueFit: 0.95 }), tech("CLOSE", { proximityScore: 0.95, valueFit: 0.2 })]),
      NOW,
    );
    const assign = actions.find((a) => a.kind === "assign");
    expect(assign).toMatchObject({ resourceId: "CLOSE" });
  });

  it("does not try to assign a completed job", () => {
    const actions = planBoardActions(board([job({ status: "complete" })], [tech("T1")]), NOW);
    expect(actions.some((a) => a.kind === "assign")).toBe(false);
  });
});

describe("planBoardActions — attention flags (F1)", () => {
  it("flags a needs-review job", () => {
    const actions = planBoardActions(board([job({ status: "needs-review", scheduledForIso: null })]), NOW);
    expect(actions.some((a) => a.kind === "flag-attention" && a.jobId === "J1")).toBe(true);
  });

  it("flags an un-scheduled quote", () => {
    const actions = planBoardActions(board([job({ status: "quoted", scheduledForIso: null })]), NOW);
    expect(actions.some((a) => a.kind === "flag-attention" && a.reason.includes("quote"))).toBe(true);
  });

  it("does not flag a healthy scheduled job for attention", () => {
    const actions = planBoardActions(board([job()]), NOW);
    expect(actions.some((a) => a.kind === "flag-attention")).toBe(false);
  });
});

describe("planDepartureActions", () => {
  it("emits on-my-way and not running-late when the ETA is within the window", () => {
    const actions = planDepartureActions({
      jobId: "J1",
      arrivalEtaIso: "2026-06-15T08:45:00.000Z",
      windowEndIso: "2026-06-15T09:00:00.000Z",
    });
    expect(actions.map((a) => a.kind === "notify" && a.intent.event)).toContain("on-my-way");
    expect(actions.some((a) => a.kind === "notify" && a.intent.event === "running-late")).toBe(false);
  });

  it("emits running-late when the ETA slips past the window end", () => {
    const actions = planDepartureActions({
      jobId: "J1",
      arrivalEtaIso: "2026-06-15T09:30:00.000Z",
      windowEndIso: "2026-06-15T09:00:00.000Z",
    });
    const late = actions.find((a) => a.kind === "notify" && a.intent.event === "running-late");
    expect(late).toBeDefined();
    expect(late).toMatchObject({ intent: { urgency: "urgent" } });
  });
});

describe("planCompletionActions", () => {
  it("emits a complete notification and a plain invoice without warranty context", () => {
    const actions = planCompletionActions({ jobId: "J1", notificationVars: { company: "Acme HVAC" } });
    expect(actions.some((a) => a.kind === "notify" && a.intent.event === "complete")).toBe(true);
    const invoice = actions.find((a) => a.kind === "invoice");
    expect(invoice).toMatchObject({ kind: "invoice", jobId: "J1" });
    if (invoice && invoice.kind === "invoice") {
      expect(invoice.classifiedLines).toBeUndefined();
      expect(invoice.billableTotal).toBeUndefined();
    }
  });

  it("classifies invoice lines when warranty context is supplied (compressor parts covered, labor billed)", () => {
    const equipment: EquipmentWarranty = {
      installDateIso: "2019-06-15T00:00:00.000Z", // ~7 years before the service date
      components: [{ component: "compressor", partsWarrantyMonths: 120, laborWarrantyMonths: 0, source: "manufacturer" }],
    };
    const actions = planCompletionActions({
      jobId: "J1",
      warranty: {
        equipment,
        atIso: "2026-06-15T00:00:00.000Z",
        lines: [
          { kind: "part", component: "compressor", description: "Compressor", amount: 1200 },
          { kind: "labor", component: "compressor", description: "Labor", amount: 600 },
        ],
      },
    });
    const invoice = actions.find((a) => a.kind === "invoice");
    expect(invoice).toBeDefined();
    if (invoice && invoice.kind === "invoice") {
      const part = invoice.classifiedLines?.find((l) => l.kind === "part");
      const labor = invoice.classifiedLines?.find((l) => l.kind === "labor");
      expect(part?.billedAmount).toBe(0); // 10yr parts warranty → covered
      expect(labor?.billedAmount).toBe(600); // no labor coverage → billable
      expect(invoice.billableTotal).toBe(600);
    }
  });
});
