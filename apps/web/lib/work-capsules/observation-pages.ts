import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canonicalJson } from "@/lib/shared/canonical-json";
import { signCursor, equalSignature } from "@/lib/shared/signed-cursor";
import { summarizeCapsuleLiveness, type CapsuleLivenessSummary } from "./liveness-inventory";

type Row = Record<string, unknown>;
type Identity = { principal: string; authority: string; filters: Record<string, unknown> };
type Snapshot = { rows: Row[]; identity: string; owner: string; observedAt: number; bytes: number; limit: number; maxChars: number; environment?: Pick<CapsuleLivenessSummary, "heavyLane" | "progressSlo"> };
export const WORKROOM_OBSERVATION_LIMIT = 10_000;
const TTL = 300_000;
const MAX_BYTES = 8 * 1024 * 1024;
const TOTAL_BYTES = 32 * 1024 * 1024;
const identityHash = (identity: Identity) => createHash("sha256").update(canonicalJson(identity)).digest("hex");

function compact(row: Row): Row {
  const shortenedFields: string[] = [];
  const bounded = (key: string, value: unknown, max = 120) => {
    const text = typeof value === "string" ? value : "";
    if (text.length <= max) return text;
    shortenedFields.push(key);
    return text.slice(0, max);
  };
  const recovery = row.recovery as Row | undefined;
  return {
    capsuleId: row.capsuleId, title: bounded("title", row.title), status: row.status,
    liveness: row.liveness, isLive: row.isLive, isReapable: row.isReapable,
    backlogItemId: row.backlogItemId ?? null,
    decisionScope: row.decisionScope ?? null, portfolioRole: row.portfolioRole ?? null,
    recovery: { state: bounded("recovery.state", recovery?.state, 64) },
    detail: { toolName: "get_workroom", arguments: { capsuleId: row.capsuleId } },
    ...(shortenedFields.length ? { shortenedFields } : {}),
  };
}

/** Process-local observations: restart/eviction is explicit, never a different population. */
export class WorkroomObservations {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly secret = randomBytes(32).toString("hex");
  private readonly now: () => number;
  constructor(options: { now?: () => number } = {}) { this.now = options.now ?? Date.now; }

  capture(rows: Row[], identity: Identity, options: { limit?: number; maxChars?: number; observedAt?: number; summary?: CapsuleLivenessSummary } = {}) {
    if (!identity.principal || rows.length > WORKROOM_OBSERVATION_LIMIT) throw new Error("snapshot_capacity_exceeded");
    const snapshot: Snapshot = {
      rows: rows.map(compact), identity: identityHash(identity), owner: identity.principal,
      observedAt: options.observedAt ?? this.now(), bytes: 0, limit: Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.trunc(options.limit!))) : 5,
      maxChars: Math.min(4000, options.maxChars ?? 4000),
      environment: options.summary ? { heavyLane: options.summary.heavyLane, progressSlo: options.summary.progressSlo } : undefined,
    };
    snapshot.bytes = Buffer.byteLength(JSON.stringify(snapshot.rows));
    if (snapshot.bytes > MAX_BYTES) throw new Error("snapshot_capacity_exceeded");
    const id = randomUUID();
    // Verify even the minimum record fits before retaining an observation.
    const page = this.page(id, snapshot, 0);
    if (this.now() - snapshot.observedAt > 5000) throw new Error("snapshot_capacity_exceeded");
    for (const [key, value] of this.snapshots) if (this.now() - value.observedAt >= TTL) this.snapshots.delete(key);
    const own = [...this.snapshots].filter(([, s]) => s.owner === snapshot.owner);
    while (own.length >= 2) this.snapshots.delete(own.shift()![0]);
    let bytes = [...this.snapshots.values()].reduce((sum, s) => sum + s.bytes, 0);
    while (bytes + snapshot.bytes > TOTAL_BYTES && this.snapshots.size) {
      const [key, value] = this.snapshots.entries().next().value!;
      bytes -= value.bytes;
      this.snapshots.delete(key);
    }
    // Bound empty observations too: byte limits alone do not bound map overhead.
    if (this.snapshots.size >= 256) this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(id, snapshot);
    return page;
  }

  resume(cursor: string, identity: Identity) {
    if (cursor.length > 1024) throw new Error("invalid_cursor");
    const [encoded, signature, extra] = cursor.split(".");
    if (!encoded || !signature || extra || !equalSignature(signCursor(encoded, this.secret), signature)) throw new Error("invalid_cursor");
    let packet: { v: number; id: string; offset: number };
    try { packet = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
    catch { throw new Error("invalid_cursor"); }
    if (packet.v !== 1 || typeof packet.id !== "string" || !Number.isSafeInteger(packet.offset) || packet.offset < 0) throw new Error("invalid_cursor");
    const snapshot = this.snapshots.get(packet.id);
    if (!snapshot) throw new Error("snapshot_unavailable");
    if (snapshot.identity !== identityHash(identity)) throw new Error("cursor_authority_mismatch");
    if (this.now() - snapshot.observedAt >= TTL) { this.snapshots.delete(packet.id); throw new Error("snapshot_expired"); }
    if (packet.offset >= snapshot.rows.length) throw new Error("invalid_cursor");
    return this.page(packet.id, snapshot, packet.offset);
  }

  private cursor(id: string, offset: number) {
    const encoded = Buffer.from(canonicalJson({ v: 1, id, offset })).toString("base64url");
    return `${encoded}.${signCursor(encoded, this.secret)}`;
  }

  private page(id: string, snapshot: Snapshot, offset: number) {
    const envelope = (capsules: Row[]) => {
      const next = offset + capsules.length;
      return { success: true, message: "Workroom observation page.", data: {
        capsules,
        livenessSummary: { ...summarizeCapsuleLiveness(capsules), ...snapshot.environment },
        page: { version: 1, observationId: id, observedAt: new Date(snapshot.observedAt).toISOString(),
          expiresAt: new Date(snapshot.observedAt + TTL).toISOString(), pageCount: capsules.length,
          populationCount: snapshot.rows.length, summaryScope: "page", environmentSummaryScope: "installation-at-observation", nextCursor: next < snapshot.rows.length ? this.cursor(id, next) : null,
          disposition: next < snapshot.rows.length ? "more" : "complete" },
      } };
    };
    const fits = (rows: Row[]) => {
      const serialized = JSON.stringify(envelope(rows), null, 2);
      return serialized.length <= snapshot.maxChars && Buffer.byteLength(serialized) <= snapshot.maxChars;
    };
    const selected: Row[] = [];
    for (const row of snapshot.rows.slice(offset, offset + snapshot.limit)) {
      if (fits([...selected, row])) { selected.push(row); continue; }
      if (selected.length) break;
      const minimal = { capsuleId: row.capsuleId, detail: row.detail, liveness: row.liveness, isLive: row.isLive, isReapable: row.isReapable, shortenedFields: ["summary"] };
      if (!fits([minimal])) throw new Error("page_budget_too_small");
      selected.push(minimal);
      break;
    }
    if (!fits(selected)) throw new Error("page_budget_too_small");
    return structuredClone(envelope(selected));
  }
}
