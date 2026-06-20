import { describe, expect, it, vi } from "vitest";
import {
  createBacklogItemFromFinding,
  updateAssuranceFindingStatus,
} from "./finding-actions";

function findingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "af-1",
    findingKey: "finding-key-1",
    title: "Critical issue in alpha",
    status: "open",
    policySeverity: "critical",
    buildId: "BUILD-1",
    digitalProductId: "product-1",
    bomComponentId: "component-1",
    vendorIdentifier: "GHSA-1111",
    evidence: { moduleName: "alpha" },
    ...overrides,
  };
}

describe("updateAssuranceFindingStatus", () => {
  it("rejects invalid status values", async () => {
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    await expect(updateAssuranceFindingStatus(db, {
      findingKey: "finding-key-1",
      status: "bogus" as never,
      now: new Date(),
    })).rejects.toThrow("Invalid assurance finding status");
  });

  it("throws when the finding does not exist", async () => {
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(),
      },
    };

    await expect(updateAssuranceFindingStatus(db, {
      findingKey: "missing",
      status: "planned",
      now: new Date(),
    })).rejects.toThrow("Assurance finding not found: missing");
  });

  it("writes resolvedAt and appends remediation event when transitioning to a terminal status", async () => {
    const now = new Date("2026-05-22T18:00:00.000Z");
    const update = vi.fn(async () => ({ id: "af-1" }));
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(async () => findingRow()),
        update,
      },
    };

    const result = await updateAssuranceFindingStatus(db, {
      findingKey: "finding-key-1",
      status: "resolved",
      reason: "Patched dependency to 1.2.4",
      userId: "user-9",
      now,
    });

    expect(result).toEqual({
      findingKey: "finding-key-1",
      previousStatus: "open",
      status: "resolved",
    });

    expect(update).toHaveBeenCalledWith({
      where: { findingKey: "finding-key-1" },
      data: expect.objectContaining({
        status: "resolved",
        resolvedAt: now,
        ownerUserId: "user-9",
        evidence: expect.objectContaining({
          moduleName: "alpha",
          remediation: [expect.objectContaining({
            status: "resolved",
            reason: "Patched dependency to 1.2.4",
            byUserId: "user-9",
            at: now.toISOString(),
          })],
        }),
      }),
    });
  });

  it("clears resolvedAt when transitioning to a non-terminal status", async () => {
    const now = new Date("2026-05-22T18:30:00.000Z");
    const update = vi.fn(async () => ({ id: "af-1" }));
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(async () => findingRow({ status: "resolved" })),
        update,
      },
    };

    await updateAssuranceFindingStatus(db, {
      findingKey: "finding-key-1",
      status: "open",
      now,
    });

    expect(update).toHaveBeenCalledWith({
      where: { findingKey: "finding-key-1" },
      data: expect.objectContaining({
        status: "open",
        resolvedAt: null,
      }),
    });
  });
});

describe("createBacklogItemFromFinding", () => {
  it("returns alreadyLinked when an existing backlog id is in evidence", async () => {
    const ingest = vi.fn();
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(async () => findingRow({
          evidence: { moduleName: "alpha", backlogItemId: "BI-EXISTING" },
        })),
        update: vi.fn(),
      },
      epic: { findFirst: vi.fn() },
    };

    const result = await createBacklogItemFromFinding(db, {
      findingKey: "finding-key-1",
      now: new Date(),
    }, ingest);

    expect(result).toEqual({
      findingKey: "finding-key-1",
      backlogItemId: "BI-EXISTING",
      epicCuid: null,
      alreadyLinked: true,
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("files through the shared front door and links it back through finding evidence + planned status", async () => {
    const now = new Date("2026-05-22T19:00:00.000Z");
    const epicUpdate = vi.fn();
    const ingest = vi.fn(async () => ({ itemId: "BI-NEW", id: "bi-db-1", created: true }));
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(async () => findingRow()),
        update: vi.fn(async () => ({ id: "af-1" })),
      },
      epic: {
        findFirst: vi.fn(async () => ({ id: "epic-cuid", epicId: "EP-ASSURANCE-LEDGER", status: "done" })),
        update: epicUpdate,
      },
    };

    const result = await createBacklogItemFromFinding(db, {
      findingKey: "finding-key-1",
      userId: "user-9",
      now,
    }, ingest);

    expect(result).toEqual({
      findingKey: "finding-key-1",
      backlogItemId: "BI-NEW",
      epicCuid: "epic-cuid",
      alreadyLinked: false,
    });

    // Filed through the shared front door with the finding origin (not a bespoke create).
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/^Remediate:/),
        workType: "bug",
        source: "automated-detection",
        proposedOutcome: "build",
        epicId: "EP-ASSURANCE-LEDGER",
        digitalProductId: "product-1",
        origin: { kind: "assuranceFinding", id: "finding-key-1" },
      }),
    );

    expect(epicUpdate).toHaveBeenCalledWith({
      where: { id: "epic-cuid" },
      data: { status: "open" },
    });

    expect(db.assuranceFinding.update).toHaveBeenCalledWith({
      where: { findingKey: "finding-key-1" },
      data: expect.objectContaining({
        status: "planned",
        ownerUserId: "user-9",
        evidence: expect.objectContaining({
          backlogItemId: "BI-NEW",
          remediation: [expect.objectContaining({
            status: "planned",
            backlogItemId: "BI-NEW",
            byUserId: "user-9",
          })],
        }),
      }),
    });
  });

  it("does not flip a non-done epic when linking", async () => {
    const ingest = vi.fn(async () => ({ itemId: "BI-NEW-2", id: "bi-db-2", created: true }));
    const db = {
      assuranceFinding: {
        findUnique: vi.fn(async () => findingRow()),
        update: vi.fn(async () => ({ id: "af-1" })),
      },
      epic: {
        findFirst: vi.fn(async () => ({ id: "epic-cuid", epicId: "EP-ASSURANCE-LEDGER", status: "in-progress" })),
        update: vi.fn(),
      },
    };

    await createBacklogItemFromFinding(db, {
      findingKey: "finding-key-1",
      now: new Date(),
    }, ingest);

    expect(db.epic.update).not.toHaveBeenCalled();
  });
});
