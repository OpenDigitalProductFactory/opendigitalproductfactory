import { describe, expect, it, vi } from "vitest";

import { GUIDANCE_SNAPSHOT_LIFETIME_MS, type GuidanceWwwdV1 } from "@dpf/db/guidance-snapshot-contract";

vi.mock("./delivery-queue", () => ({ scheduleFederationDeliveryJob: vi.fn(async () => undefined) }));

import {
  decodeGuidanceSnapshotOutboxPayload,
  handleIncomingGuidanceSnapshot,
  queueGuidanceSnapshot,
  readHeldGuidanceSnapshot,
} from "./guidance-snapshot-exchange";
import { issueGuidanceSnapshot } from "./guidance-snapshot";
import { deriveDeviceId, generateInstanceSigningKeypair } from "./instance-identity";

const keys = generateInstanceSigningKeypair();
const authority = {
  installationId: `inst_${"a".repeat(32)}`,
  deviceId: deriveDeviceId(keys.signingPublicKey),
  projectionSecret: "test-projection-secret",
  ...keys,
};
const companionDid = deriveDeviceId(generateInstanceSigningKeypair().signingPublicKey);
const now = new Date("2026-11-11T00:00:00.000Z");

function wwwd(summary = "Prefer reliability."): GuidanceWwwdV1 {
  return {
    profile: { profileId: "wwwd-org-1", name: "Operator organization", fallbackProfileId: null, autonomyPolicy: null, defaultResolver: null },
    materials: [{
      materialId: "PM-1", sourceType: "organization-stance", sourceRef: {}, summary,
      domainClass: "plan-readiness", direction: "support", domains: [], freshness: "current",
      evidenceGrade: "A", confidenceWeight: 0.9, lastValidatedAt: null,
    }],
  };
}

/** One in-memory mirror table keyed the way Prisma's compound uniques are. */
function memoryDb(link: Record<string, unknown> = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (where: Record<string, Record<string, string>>) => {
    const compound = where.federationLinkId_recordType_localRecordRef ?? where.federationLinkId_recordType_peerRecordRef;
    if (compound) return Object.values(compound).join("|");
    return [...rows.entries()].find(([, row]) => row.mirrorId === (where as unknown as { mirrorId: string }).mirrorId)?.[0];
  };
  const keyOfRow = (row: Record<string, unknown>) =>
    [row.federationLinkId, row.recordType, row.localRecordRef ?? row.peerRecordRef].join("|");
  return {
    rows,
    federationLink: {
      findUnique: async () => ({
        linkId: "link_1", role: "same-org-peer", linkState: "trusted", revokedAt: null,
        peerDeviceId: authority.deviceId, peerEnvironmentClass: "production", ...link,
      }),
      findMany: async () => [],
    },
    federatedRecordMirror: {
      findUnique: async ({ where }: { where: Record<string, Record<string, string>> }) => {
        const key = keyOf(where);
        const row = key ? rows.get(key) : undefined;
        return row ? { ...row, version: BigInt(row.version as number) } as never : null;
      },
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => { rows.set(keyOfRow(data), { ...data }); },
      update: async ({ where, data }: { where: { mirrorId: string }; data: Record<string, unknown> }) => {
        const key = [...rows.entries()].find(([, row]) => row.mirrorId === where.mirrorId)![0];
        rows.set(key, { ...rows.get(key)!, ...data });
      },
      upsert: async ({ where, create, update }: { where: Record<string, Record<string, string>>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = keyOf(where)!;
        rows.set(key, rows.has(key) ? { ...rows.get(key)!, ...update } : { ...create });
      },
    },
    federationDeliveryJob: {},
  };
}

const link = { linkId: "link_1", peerAuthorityUrl: "https://companion.test", peerTokenEnc: "enc" };

describe("queueGuidanceSnapshot (authority)", () => {
  it("queues a signed snapshot for the companion, then nothing while the guidance is unchanged", async () => {
    const db = memoryDb();
    const first = await queueGuidanceSnapshot(db as never, { link, authority, companionInstallationDid: companionDid, wwwd: wwwd(), now });
    expect(first.action).toBe("queued");
    const payload = decodeGuidanceSnapshotOutboxPayload([...db.rows.values()][0]!.payload);
    expect(payload?.record.meta.companionInstallationDid).toBe(companionDid);

    const again = await queueGuidanceSnapshot(db as never, {
      link, authority, companionInstallationDid: companionDid, wwwd: wwwd(), now: new Date(now.getTime() + 60_000),
    });
    expect(again.action).toBe("noop");
  });

  it("re-issues a newer version when the guidance changes or half the lifetime has passed", async () => {
    const db = memoryDb();
    const first = await queueGuidanceSnapshot(db as never, { link, authority, companionInstallationDid: companionDid, wwwd: wwwd(), now });
    const changed = await queueGuidanceSnapshot(db as never, {
      link, authority, companionInstallationDid: companionDid, wwwd: wwwd("Changed."), now,
    });
    expect(changed).toMatchObject({ action: "queued" });
    expect(changed.version).toBeGreaterThan(first.version);

    const aged = await queueGuidanceSnapshot(db as never, {
      link, authority, companionInstallationDid: companionDid, wwwd: wwwd("Changed."),
      now: new Date(now.getTime() + GUIDANCE_SNAPSHOT_LIFETIME_MS / 2),
    });
    expect(aged.action).toBe("queued");
  });
});

describe("handleIncomingGuidanceSnapshot (companion)", () => {
  const context = { selfInstallationDid: companionDid, now };
  const issue = (version: number, summary?: string) =>
    issueGuidanceSnapshot({ authority, companionInstallationDid: companionDid, wwwd: wwwd(summary), version, now });

  it("holds a valid snapshot and acknowledges an exact replay", async () => {
    const db = memoryDb();
    const snapshot = issue(10);
    expect(await handleIncomingGuidanceSnapshot(db as never, "link_1", snapshot, context)).toEqual({ action: "created", originVersion: 10 });
    expect(await handleIncomingGuidanceSnapshot(db as never, "link_1", snapshot, context)).toEqual({ action: "noop", originVersion: 10 });
    expect((await readHeldGuidanceSnapshot(db as never, { linkId: "link_1", selfInstallationDid: companionDid }))?.meta.version).toBe(10);
  });

  it("AC-PAC-02: an older version is refused and the held snapshot stays in force", async () => {
    const db = memoryDb();
    await handleIncomingGuidanceSnapshot(db as never, "link_1", issue(10), context);
    expect(await handleIncomingGuidanceSnapshot(db as never, "link_1", issue(9, "Older."), context))
      .toEqual({ action: "conflict", reason: "version-not-advancing", originVersion: 10 });
    const held = await readHeldGuidanceSnapshot(db as never, { linkId: "link_1", selfInstallationDid: companionDid });
    expect(held?.wwwd.materials[0]?.summary).toBe("Prefer reliability.");
  });

  it("AC-PAC-02: a bad signature is rejected and the held snapshot stays in force", async () => {
    const db = memoryDb();
    await handleIncomingGuidanceSnapshot(db as never, "link_1", issue(10), context);
    const forged = issue(11, "Forged.");
    forged.signature = `${forged.signature.split(".").slice(0, 2).join(".")}.${Buffer.alloc(64).toString("base64url")}`;
    expect(await handleIncomingGuidanceSnapshot(db as never, "link_1", forged, context))
      .toMatchObject({ action: "rejected", reason: "bad-signature" });
    expect((await readHeldGuidanceSnapshot(db as never, { linkId: "link_1", selfInstallationDid: companionDid }))?.meta.version).toBe(10);
  });

  it("refuses a snapshot over a link whose peer is not attested production", async () => {
    for (const override of [{ peerEnvironmentClass: null }, { peerEnvironmentClass: "development" }, { role: "managed-by" }]) {
      const db = memoryDb(override);
      expect(await handleIncomingGuidanceSnapshot(db as never, "link_1", issue(10), context))
        .toEqual({ action: "refused", reason: "link-not-authority" });
    }
  });

  it("never returns a held row that was altered at rest", async () => {
    const db = memoryDb();
    await handleIncomingGuidanceSnapshot(db as never, "link_1", issue(10), context);
    const row = [...db.rows.values()][0]!;
    (row.payload as { wwwd: GuidanceWwwdV1 }).wwwd.materials[0]!.direction = "oppose";
    expect(await readHeldGuidanceSnapshot(db as never, { linkId: "link_1", selfInstallationDid: companionDid })).toBeNull();
  });

  it("still returns an expired held snapshot so the companion can report it", async () => {
    const db = memoryDb();
    await handleIncomingGuidanceSnapshot(db as never, "link_1", issue(10), context);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now.getTime() + GUIDANCE_SNAPSHOT_LIFETIME_MS + 1));
    try {
      expect((await readHeldGuidanceSnapshot(db as never, { linkId: "link_1", selfInstallationDid: companionDid }))?.meta.version).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });
});
