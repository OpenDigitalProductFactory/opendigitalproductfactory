import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mdmStewardTask: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customerAccount: { findUnique: vi.fn(), update: vi.fn() },
    customerContact: { findUnique: vi.fn(), update: vi.fn() },
    activity: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/mdm/crosswalk", () => ({
  registerCustomerAccountSource: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@dpf/db";
import { registerCustomerAccountSource } from "@/lib/mdm/crosswalk";
import {
  applyEnrichmentProposal,
  fileEnrichmentProposal,
  ENRICHMENT_RESOLUTION,
  ENRICHMENT_TASK_KIND,
} from "./enrichment-service";
import type { EnrichmentProposal } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.mdmStewardTask.create).mockResolvedValue({} as never);
  vi.mocked(prisma.mdmStewardTask.update).mockResolvedValue({} as never);
  vi.mocked(prisma.customerAccount.update).mockResolvedValue({} as never);
  vi.mocked(prisma.customerAccount.findUnique).mockResolvedValue({ notes: null } as never);
  vi.mocked(prisma.customerContact.update).mockResolvedValue({} as never);
  vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({ accountId: "ACCT-1" } as never);
  vi.mocked(prisma.activity.create).mockResolvedValue({} as never);
});

const PROPOSAL: EnrichmentProposal = {
  recordKind: "customer-account",
  recordId: "ACCT-1",
  changes: [
    { field: "industry", current: null, proposed: "Managed IT Services", source: "website", sourceRef: "https://teamlogicit.com" },
    { field: "employeeCount", current: null, proposed: "12 employees", source: "web-search", sourceRef: "serp:1" },
    { field: "location", current: null, proposed: "Round Rock, TX", source: "web-search", sourceRef: "serp:2" },
  ],
  unresolvedGaps: [{ field: "notes", reason: "left blank; please confirm" }],
  rejected: [],
  scope: { sources: ["website", "web-search"], fields: ["industry", "employeeCount", "location", "notes"] },
  identity: { score: 1, agreements: ["domain"], conflicts: [], verdict: "agree" },
};

describe("fileEnrichmentProposal (AC7 — propose-to-queue, no direct write)", () => {
  it("creates an open enrichment steward task and writes nothing to the record", async () => {
    const taskId = await fileEnrichmentProposal(PROPOSAL, {
      proactivity: { level: "balanced", policyId: "proactivity:crm-record-enrichment:balanced" },
    });
    expect(taskId).toMatch(/^STEW-/);
    expect(prisma.mdmStewardTask.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.mdmStewardTask.create).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data["kind"]).toBe(ENRICHMENT_TASK_KIND);
    expect(arg.data["domain"]).toBe("customer-account");
    // No record write happened at file time.
    expect(prisma.customerAccount.update).not.toHaveBeenCalled();
  });

  it("returns null when there is nothing to propose", async () => {
    const empty = { ...PROPOSAL, changes: [], unresolvedGaps: [] };
    expect(await fileEnrichmentProposal(empty)).toBeNull();
    expect(prisma.mdmStewardTask.create).not.toHaveBeenCalled();
  });

  it("refreshes an existing open task instead of duplicating", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue({ id: "row1", taskId: "STEW-OLD" } as never);
    const taskId = await fileEnrichmentProposal(PROPOSAL);
    expect(taskId).toBe("STEW-OLD");
    expect(prisma.mdmStewardTask.update).toHaveBeenCalledOnce();
    expect(prisma.mdmStewardTask.create).not.toHaveBeenCalled();
  });
});

describe("applyEnrichmentProposal (AC5/AC7 — governed write, provenance, diff)", () => {
  function openTask(overrides: Record<string, unknown> = {}) {
    return {
      id: "row1",
      taskId: "STEW-1",
      kind: ENRICHMENT_TASK_KIND,
      domain: "customer-account",
      subjectId: "ACCT-1",
      status: "open",
      reasons: { changes: PROPOSAL.changes, unresolvedGaps: PROPOSAL.unresolvedGaps, scope: PROPOSAL.scope },
      ...overrides,
    };
  }

  it("writes scalar columns, folds columnless fields into notes, registers provenance, resolves the task", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(openTask() as never);
    const res = await applyEnrichmentProposal("STEW-1", { resolvedBy: "user-1" });
    expect(res.ok).toBe(true);

    const update = vi.mocked(prisma.customerAccount.update).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data["industry"]).toBe("Managed IT Services");
    expect(update.data["employeeCount"]).toBe(12); // "12 employees" → 12
    expect(update.data["sourceSystem"]).toBe("coworker-tool");
    // location has no column → annotated into notes
    expect(String(update.data["notes"])).toMatch(/location: Round Rock, TX/);

    expect(registerCustomerAccountSource).toHaveBeenCalledOnce();
    // Diff recorded on the timeline (AC5).
    expect(prisma.activity.create).toHaveBeenCalledOnce();
    // Task resolved (AC7).
    const taskUpdate = vi.mocked(prisma.mdmStewardTask.update).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(taskUpdate.data["status"]).toBe(ENRICHMENT_RESOLUTION);
  });

  it("refuses a non-open task", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(openTask({ status: "resolved_enriched" }) as never);
    const res = await applyEnrichmentProposal("STEW-1", { resolvedBy: null });
    expect(res.ok).toBe(false);
    expect(prisma.customerAccount.update).not.toHaveBeenCalled();
  });

  it("refuses a non-enrichment task kind", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(openTask({ kind: "duplicate" }) as never);
    const res = await applyEnrichmentProposal("STEW-1", { resolvedBy: null });
    expect(res.ok).toBe(false);
  });

  it("errors clearly for an unknown task", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(null as never);
    const res = await applyEnrichmentProposal("STEW-x", { resolvedBy: null });
    expect(res.ok).toBe(false);
  });

  it("REGRESSION: an employeeCount RANGE is not mangled into the Int column (HIGH-1)", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(
      openTask({
        reasons: {
          changes: [
            { field: "employeeCount", current: null, proposed: "11-50 employees", source: "linkedin", sourceRef: "li" },
          ],
          unresolvedGaps: [],
          scope: { sources: ["linkedin"], fields: ["employeeCount"] },
        },
      }) as never,
    );
    const res = await applyEnrichmentProposal("STEW-1", { resolvedBy: "u" });
    expect(res.ok).toBe(true);
    const update = vi.mocked(prisma.customerAccount.update).mock.calls[0]![0] as { data: Record<string, unknown> };
    // Must NOT write 1150 (the digit-strip bug) — the range is kept as a note.
    expect(update.data["employeeCount"]).toBeUndefined();
    expect(String(update.data["notes"])).toMatch(/employeeCount: 11-50 employees/);
  });

  it("writes the timeline activity as system-generated (createdById null, FK-safe)", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(openTask() as never);
    await applyEnrichmentProposal("STEW-1", { resolvedBy: "agent-not-a-user" });
    const activity = vi.mocked(prisma.activity.create).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(activity.data["createdById"]).toBeNull();
  });

  it("REGRESSION: applying to a contact does NOT clobber its original source (HIGH-2)", async () => {
    vi.mocked(prisma.mdmStewardTask.findUnique).mockResolvedValue(
      openTask({
        domain: "customer-contact",
        subjectId: "CT-1",
        reasons: {
          changes: [{ field: "jobTitle", current: null, proposed: "Owner & President", source: "linkedin", sourceRef: "li" }],
          unresolvedGaps: [],
          scope: { sources: ["linkedin"], fields: ["jobTitle"] },
        },
      }) as never,
    );
    const res = await applyEnrichmentProposal("STEW-1", { resolvedBy: "u" });
    expect(res.ok).toBe(true);
    const update = vi.mocked(prisma.customerContact.update).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data["jobTitle"]).toBe("Owner & President");
    expect("source" in update.data).toBe(false); // original provenance preserved
  });
});
