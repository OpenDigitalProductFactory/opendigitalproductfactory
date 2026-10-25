import { createHash } from "node:crypto";
import { parseOperatingIntent } from "@dpf/db/installation-operating-intent";
import { resolveInstallationPairing } from "@dpf/db/installation-peer-pairing";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";
import { bodyCriteriaVersion } from "@/lib/backlog/initiative-readiness/body-baseline-version";
import { deliveryObject, readDeliveryAgreement, retainDeliveryAgreement, type DeliveryContext } from "@/lib/work-management/delivery-agreement";

export type DeliveryAgreementCaptureDb = {
  platformConfig?: { findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null> };
  backlogItem?: { findFirst(args: unknown): Promise<{ body: string | null } | null> };
  federatedRecordMirror?: { findFirst(args: unknown): Promise<{ mirrorId: string; version: bigint;
    peerRecordRef: string | null; lastSyncedAt: Date | null; syncStatus: string } | null> };
  federationLink?: { findMany(args: unknown): Promise<Array<{ linkId: string; role: string; linkState: string;
    peerOrganizationRef: string | null; revokedAt: Date | null; quarantinedAt: Date | null }>> };
};
type CaptureInput = {
  objective: string; source: string; backlogItemId?: string | null; acceptanceBody?: string | null;
  workspaceState?: unknown; activityKind?: string | null; now?: Date;
};

async function inspectDeliveryContext(db: DeliveryAgreementCaptureDb, now: Date, input: CaptureInput,
  environmentClass?: () => Promise<string>): Promise<DeliveryContext> {
  const base = { checkedAt: now.toISOString(), peerRef: null, sourceRefs: [] as string[] };
  const unavailable = (reason: string): DeliveryContext => ({ ...base, state: "unavailable", guidanceState: "unavailable", reason });
  if (!db.platformConfig) return unavailable("Installation context is unavailable; the deliverable owner must check its sources.");
  try {
    const readConfig = async (key: string) => (await db.platformConfig!.findUnique({ where: { key } }))?.value;
    const environment = environmentClass ? await environmentClass() : (await loadEnvironmentClassResolution({ readConfig })).environmentClass;
    if (environment !== "development" && environment !== "test") return { ...base, state: "not-required", guidanceState: "not-required",
      reason: "DEV paired-context inspection does not apply to this installation.", sourceRefs: ["installation:environment-class"] };
    const intent = parseOperatingIntent(await readConfig("installation.operating-intent.v1"));
    if (!intent) return unavailable("The installation purpose is unresolved; the deliverable owner must resolve its context.");
    if (!db.federationLink) return unavailable("The paired-link reader is unavailable; the deliverable owner must check guidance.");
    const rows = await db.federationLink.findMany({
      where: { role: "same-org-peer", linkState: "trusted", revokedAt: null, quarantinedAt: null },
      orderBy: { linkId: "asc" }, take: 11,
      select: { linkId: true, role: true, linkState: true, peerOrganizationRef: true, revokedAt: true, quarantinedAt: true },
    });
    if (rows.length > 10) return unavailable("Paired-context inspection exceeded its bounded link set; narrow the peer before checking guidance.");
    const pairing = resolveInstallationPairing({ declaredRef: intent.pairedProductionInstallationRef,
      links: rows.map(row => ({ ...row, relationshipPreset: row.role === "same-org-peer" ? "same-organization" : row.role,
        peerLabel: row.peerOrganizationRef })) });
    if (pairing.source !== "federation-link") return { ...base, state: "unavailable", guidanceState: "unavailable", peerRef: pairing.ref,
      reason: "No trusted paired installation is available; the deliverable owner must check the applicable guidance.",
      sourceRefs: ["platform-config:installation.operating-intent.v1"] };
    if (pairing.declaredButUnconfirmed) return { ...base, state: "unavailable", peerRef: pairing.ref, guidanceState: "unavailable",
      reason: "The declared paired installation does not match the trusted link. The delivery owner must resolve the source before using guidance.",
      sourceRefs: ["platform-config:installation.operating-intent.v1", `federation-link:${pairing.linkId}`] };
    // Read the scoped, share-safe snapshot already imported by the federation contract.
    // No peer network request, credentials or foreign authority enter this transaction.
    if (input.backlogItemId && input.acceptanceBody && db.federatedRecordMirror) {
      const mirror = await db.federatedRecordMirror.findFirst({
        where: { federationLinkId: pairing.linkId, recordType: "backlog-item", localRecordRef: input.backlogItemId,
          canonicalSide: "peer", syncStatus: "synced" },
        select: { mirrorId: true, version: true, peerRecordRef: true, lastSyncedAt: true, syncStatus: true },
      });
      if (mirror?.lastSyncedAt && mirror.peerRecordRef && mirror.syncStatus === "synced") return {
        ...base, state: "checked", peerRef: pairing.ref, guidanceState: "checked",
        reason: `Read the linked deliverable snapshot as of ${mirror.lastSyncedAt.toISOString()}. It applies to ${input.backlogItemId}; local requirements and authority still govern.`,
        sourceRefs: [`federation-link:${pairing.linkId}`, `federated-record-mirror:${mirror.mirrorId}@${mirror.version}`,
          `peer-record:${mirror.peerRecordRef}`, `applies-to:${input.backlogItemId}`,
          `sha256:${createHash("sha256").update(input.acceptanceBody).digest("hex")}`],
      };
    }
    return { ...base, state: "checked", peerRef: pairing.ref, guidanceState: "unavailable",
      reason: "The trusted pairing was checked. Scope-specific peer guidance was not read; the deliverable owner must retrieve its permitted source before using it.",
      sourceRefs: ["platform-config:installation.operating-intent.v1", `federation-link:${pairing.linkId}`] };
  } catch {
    return unavailable("The context read failed; no peer guidance or local authority was inferred.");
  }
}

/** One bounded context inspection when a finite delivery is born; replay does no IO. */
export async function captureFiniteDeliveryState(db: DeliveryAgreementCaptureDb, input: CaptureInput,
  deps: { environmentClass?: () => Promise<string> } = {}): Promise<Record<string, unknown>> {
  const state = deliveryObject(input.workspaceState);
  if (Object.hasOwn(state, "deliveryAgreement")) {
    const original = readDeliveryAgreement(state);
    if (!original) throw new Error("The stored delivery agreement requires repair.");
    return retainDeliveryAgreement(state, original);
  }
  if (!["external-adoption", "build-studio", "backlog"].includes(input.source) && input.activityKind !== "delivery") return { ...state };
  const now = input.now ?? new Date();
  const acceptanceBody = input.acceptanceBody ?? (input.backlogItemId && db.backlogItem
    ? (await db.backlogItem.findFirst({ where: { itemId: input.backlogItemId }, select: { body: true } }))?.body : null);
  const version = bodyCriteriaVersion(acceptanceBody);
  const acceptance = version ? { digest: version.criteriaDigest, criteria: version.criteria } : null;
  return retainDeliveryAgreement(state, { objective: input.objective, backlogItemId: input.backlogItemId ?? null,
    capturedAt: now.toISOString(), basis: "created", acceptance, context: await inspectDeliveryContext(db, now, { ...input, acceptanceBody }, deps.environmentClass) });
}
