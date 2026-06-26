// Read model for estate patch posture: a projection over the patch findings the sweep
// writes to the Assurance Ledger (findingKey `patch:*`). Powers the MCP tool and the
// operator surface. db is an injected port so it is unit-testable without Prisma.

const PATCH_FINDING_KEY_PREFIX = "patch:";
const OPEN_STATUSES = ["open", "planned", "blocked"];
const DEFAULT_LIMIT = 500;

export interface PatchPostureFinding {
  findingKey: string;
  findingKind: string; // vulnerability | missing-patch | unsupported-component
  policySeverity: string; // critical | high | medium | low | info
  status: string;
  title: string;
  affectedId: string; // the host (InventoryEntity id)
  vendorIdentifier: string; // CVE/GHSA or synthetic pm:pkg id
  cisaKev: boolean;
  targetVersion: string | null;
  installedVersion: string | null;
  lastSeenAt: Date | string;
}

export interface PatchPosture {
  totals: {
    findings: number;
    bySeverity: Record<string, number>;
    byKind: Record<string, number>;
    kev: number;
    hosts: number;
  };
  /** True when more findings exist than were returned (list capped). */
  capped: boolean;
  findings: PatchPostureFinding[];
}

interface AssuranceFindingRow {
  findingKey: string;
  findingKind: string;
  policySeverity: string;
  status: string;
  title: string;
  affectedId: string;
  vendorIdentifier: string;
  evidence: unknown;
  remediationHint: unknown;
  lastSeenAt: Date | string;
}

export interface PatchPostureDb {
  assuranceFinding: { findMany(args: unknown): Promise<unknown[]> };
}

function readBool(obj: unknown, key: string): boolean {
  return Boolean(obj && typeof obj === "object" && (obj as Record<string, unknown>)[key] === true);
}

function readStr(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : null;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Fetch and summarize the current patch posture. Defaults to open findings; pass
 * `status: "all"` to include resolved/accepted. List is capped (default 500) but totals
 * reflect the fetched set — the daily sweep keeps the open set bounded by estate size.
 */
export async function getPatchPosture(
  db: PatchPostureDb,
  options: { status?: "open" | "all"; limit?: number } = {},
): Promise<PatchPosture> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const statusFilter = options.status === "all" ? undefined : { status: { in: OPEN_STATUSES } };

  const rows = (await db.assuranceFinding.findMany({
    where: { findingKey: { startsWith: PATCH_FINDING_KEY_PREFIX }, ...statusFilter },
    select: {
      findingKey: true,
      findingKind: true,
      policySeverity: true,
      status: true,
      title: true,
      affectedId: true,
      vendorIdentifier: true,
      evidence: true,
      remediationHint: true,
      lastSeenAt: true,
    },
    take: limit + 1,
  })) as AssuranceFindingRow[];

  const capped = rows.length > limit;
  const visible = capped ? rows.slice(0, limit) : rows;

  const findings: PatchPostureFinding[] = visible.map((row) => ({
    findingKey: row.findingKey,
    findingKind: row.findingKind,
    policySeverity: row.policySeverity,
    status: row.status,
    title: row.title,
    affectedId: row.affectedId,
    vendorIdentifier: row.vendorIdentifier,
    cisaKev: readBool(row.evidence, "cisaKev"),
    targetVersion: readStr(row.remediationHint, "targetVersion"),
    installedVersion: readStr(row.evidence, "installedVersion"),
    lastSeenAt: row.lastSeenAt,
  }));

  findings.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.policySeverity] ?? 9) - (SEVERITY_ORDER[b.policySeverity] ?? 9) ||
      Number(b.cisaKev) - Number(a.cisaKev),
  );

  const bySeverity: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const hosts = new Set<string>();
  let kev = 0;
  for (const f of findings) {
    bySeverity[f.policySeverity] = (bySeverity[f.policySeverity] ?? 0) + 1;
    byKind[f.findingKind] = (byKind[f.findingKind] ?? 0) + 1;
    if (f.affectedId) hosts.add(f.affectedId);
    if (f.cisaKev) kev += 1;
  }

  return {
    totals: { findings: findings.length, bySeverity, byKind, kev, hosts: hosts.size },
    capped,
    findings,
  };
}
