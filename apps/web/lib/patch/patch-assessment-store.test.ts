import { describe, expect, it } from "vitest";

import type { PatchIntelProvider, SoftwareEvidenceLike } from "@dpf/db/patch";

import { runEstatePatchAssessment, type PatchStoreDb } from "./patch-assessment-store";

const NOW = new Date("2026-06-25T00:00:00.000Z");

interface StoredFinding {
  findingKey: string;
  status: string;
  [k: string]: unknown;
}

/** In-memory db faithfully implementing the slices of Prisma the store + persistence use. */
class FakeDb implements PatchStoreDb {
  runCreates: Array<Record<string, unknown>> = [];
  runUpdates: Array<{ data: Record<string, unknown> }> = [];
  findingCreates: Array<Record<string, unknown>> = [];
  findings = new Map<string, StoredFinding>();

  constructor(
    private readonly evidence: Array<Record<string, unknown>>,
    seed: StoredFinding[] = [],
  ) {
    for (const f of seed) this.findings.set(f.findingKey, f);
  }

  discoveredSoftwareEvidence = {
    findMany: async (): Promise<unknown[]> => this.evidence,
  };

  assuranceRun = {
    create: async (args: { data: Record<string, unknown> }) => {
      this.runCreates.push(args.data);
      return { id: "run-1" };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      this.runUpdates.push(args);
      return {};
    },
  };

  assuranceFinding = {
    findMany: async (args: { where?: { findingKey?: { in?: string[] } } }): Promise<unknown[]> => {
      const keys = args?.where?.findingKey?.in ?? [];
      return keys.filter((k) => this.findings.has(k)).map((k) => this.findings.get(k)!);
    },
    create: async (args: { data: StoredFinding }) => {
      this.findings.set(args.data.findingKey, { ...args.data });
      this.findingCreates.push(args.data);
      return {};
    },
    update: async (args: { where: { findingKey: string }; data: Record<string, unknown> }) => {
      const key = args.where.findingKey;
      const prev = this.findings.get(key) ?? { findingKey: key, status: "open" };
      this.findings.set(key, { ...prev, ...args.data } as StoredFinding);
      return {};
    },
    updateMany: async (args: {
      where: { AND: Array<{ findingKey: { startsWith?: string; notIn?: string[] } }>; status: { in: string[] } };
      data: Record<string, unknown>;
    }) => {
      const prefix = args.where.AND[0].findingKey.startsWith ?? "";
      const notIn = new Set(args.where.AND[1].findingKey.notIn ?? []);
      const statusIn = new Set(args.where.status.in);
      let count = 0;
      for (const [key, val] of this.findings) {
        if (key.startsWith(prefix) && !notIn.has(key) && statusIn.has(val.status)) {
          this.findings.set(key, { ...val, status: "resolved" });
          count += 1;
        }
      }
      return { count };
    },
  };
}

const EVIDENCE: Array<Record<string, unknown>> = [
  { id: "e-vuln", evidenceKey: "vuln", inventoryEntityId: "host-1", rawProductName: "openssl", rawPackageName: "openssl", rawVersion: "3.0.0", packageManager: "dpkg" },
  { id: "e-gap", evidenceKey: "gap", inventoryEntityId: "host-1", rawProductName: "curl", rawPackageName: "curl", rawVersion: "8.0.0", packageManager: "dpkg" },
  { id: "e-clean", evidenceKey: "clean", inventoryEntityId: "host-2", rawProductName: "bash", rawPackageName: "bash", rawVersion: "5.2.0", packageManager: "dpkg" },
];

const provider: PatchIntelProvider = (ev: SoftwareEvidenceLike) => {
  switch (ev.evidenceKey) {
    case "vuln":
      return { advisories: [{ id: "CVE-2026-1", severity: "critical" }] };
    case "gap":
      return { latestSafeVersion: "8.8.0" };
    default:
      return { latestSafeVersion: ev.rawVersion };
  }
};

describe("runEstatePatchAssessment", () => {
  it("opens an estate AssuranceRun, writes actionable findings, and closes it", async () => {
    const db = new FakeDb(EVIDENCE);
    const summary = await runEstatePatchAssessment(db, provider, { now: NOW });

    expect(db.runCreates[0]).toMatchObject({
      scopeType: "estate",
      scopeId: "platform",
      adapterKey: "patch-intel",
      status: "running",
    });
    expect(summary.assessed).toBe(3);
    expect(summary.actionable).toBe(2);

    const created = db.findingCreates.map((d) => d.findingKey).sort();
    expect(created).toEqual(["patch:gap", "patch:vuln"]);

    const vuln = db.findingCreates.find((d) => d.findingKey === "patch:vuln")!;
    expect(vuln.findingKind).toBe("vulnerability");
    expect(vuln.affectedType).toBe("inventory-entity");
    expect(vuln.affectedId).toBe("host-1");

    const gap = db.findingCreates.find((d) => d.findingKey === "patch:gap")!;
    expect(gap.findingKind).toBe("missing-patch");

    expect(db.runUpdates[0].data).toMatchObject({ status: "passed" });
  });

  it("carries resolved CatalogIdentity CPE and lifecycle milestones from evidence or its InventoryEntity", async () => {
    const seen: SoftwareEvidenceLike[] = [];
    const db = new FakeDb([
      {
        id: "e-os",
        evidenceKey: "os",
        inventoryEntityId: "host-1",
        rawProductName: "Ubuntu",
        rawPackageName: "ubuntu",
        rawVersion: "22.04",
        packageManager: "dpkg",
        catalogIdentity: null,
        inventoryEntity: {
          customerAccountId: "acct-1",
          customerSiteId: "site-1",
          catalogIdentity: {
            id: "ci-os",
            cpe: "cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:*:*:*:*",
            part: "o",
            lifecycleMilestones: [{ milestone: "eol", date: new Date("2027-04-01T00:00:00.000Z") }],
          },
        },
      },
    ]);

    await runEstatePatchAssessment(
      db,
      (ev) => {
        seen.push(ev);
        return { latestSafeVersion: ev.rawVersion };
      },
      { now: NOW },
    );

    expect(seen[0]).toMatchObject({
      customerAccountId: "acct-1",
      customerSiteId: "site-1",
      catalogIdentityId: "ci-os",
      catalogIdentityCpe: "cpe:2.3:o:canonical:ubuntu_linux:22.04:*:*:*:*:*:*:*",
      catalogIdentityPart: "o",
    });
    expect(seen[0].catalogLifecycleMilestones?.[0]).toMatchObject({
      milestone: "eol",
      date: new Date("2027-04-01T00:00:00.000Z"),
    });
  });

  it("resolves a previously-open patch finding that is now clean", async () => {
    const db = new FakeDb(EVIDENCE, [{ findingKey: "patch:stale", status: "open" }]);
    const summary = await runEstatePatchAssessment(db, provider, { now: NOW });
    expect(summary.resolved).toBe(1);
    expect(db.findings.get("patch:stale")!.status).toBe("resolved");
  });
});
