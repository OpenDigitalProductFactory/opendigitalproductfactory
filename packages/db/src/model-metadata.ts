// packages/db/src/model-metadata.ts
//
// EP-A33A5C61 slice 4 (BI-D9F158AF) — governance metadata declared ONCE, on
// the model, in the Prisma schema, and carried in the Postgres catalog.
//
// THE COLLAPSE THIS PERFORMS
// Four code homes described the same 626 models and never read each other:
// packages/db/src/table-classification.ts (sensitivity), the apps/web
// govern/data asset registry (lifecycle class, categories, owner, steward),
// apps/web/lib/operate/retention/policies.ts (purge windows / retained
// datasets, hand typed) and scripts/stewardship-exemptions.txt (the third
// disposition). A fifth file decided enrolment by table-NAME suffix. Founder
// direction 2026-09-08: put the metadata where the data is, not in another
// registry beside the schema.
//
// THE SHAPE
//   /// @dpf lifecycle=telemetry-bounded retention=365d sensitivity=internal categories=telemetry,security-audit owner=platform-architecture steward=data-steward timeAxis=createdAt
//   model ToolExecution { ... }
//
// One or more `/// @dpf` lines directly above a `model` block (other `///`
// prose lines may sit between them). Keys are a CLOSED set; values are closed
// vocabularies except owner/steward (role slugs) and timeAxis (a column of the
// model). The parser is textual on purpose: it runs under plain node in CI
// guards, under tsx at portal boot, and inside the web app, without Prisma.
//
// THE CARRIER
// `toCatalogComment` renders the same declaration as `dpf:{json}` for
// `COMMENT ON TABLE`; `parseCatalogComment` reads it back. Postgres keeps the
// comment versioned with the table (drop the table, the metadata goes) and
// every catalog crawler on the market reads obj_description natively.
// scripts/apply-model-metadata-comments.ts converges the catalog to the schema
// on every portal boot; readers (retention sweep, growth detector, ERD mirror,
// sanitized clone) query pg_catalog, never a TypeScript registry.

export const MODEL_METADATA_TAG = "@dpf";
export const MODEL_METADATA_COMMENT_PREFIX = "dpf:";

export const LIFECYCLE_CLASSES = [
  "operational",
  "telemetry-bounded",
  "business-record",
  "regulated-record",
  "security-audit",
  "legal-evidence",
  "ephemeral",
] as const;
export type LifecycleClass = (typeof LIFECYCLE_CLASSES)[number];

export const SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const DATA_CATEGORIES = [
  "identity",
  "contact",
  "personal-attribute",
  "financial",
  "credential-secret",
  "authorization",
  "content",
  "operational",
  "configuration",
  "telemetry",
  "security-audit",
  "derived-analytic",
] as const;
export type DataCategoryTag = (typeof DATA_CATEGORIES)[number];

export const REGULATED_SCOPES = ["none", "pci-cardholder", "phi-health"] as const;
export type RegulatedScopeTag = (typeof REGULATED_SCOPES)[number];

/**
 * Retention disposition — exactly one per model, mirroring the four
 * dispositions the stewardship gate already distinguishes:
 *   <N>d        auto-purge past N days (telemetry, logs, chat) — the sweep acts
 *   retained    regulated record with a statutory minimum — the sweep never acts
 *   domain      rows live and die with their own domain lifecycle (leases,
 *               episodes) — a time sweep would race the owner
 *   reference   lookup / catalogue data superseded by replacement, never aged
 *   config      per-install or per-org configuration; lifetime = the install's
 *   projection  derived copy rebuilt from a source of truth (graphs, embeddings,
 *               mirrors) — reconciled, not aged
 */
export type RetentionDisposition =
  | { kind: "purge"; days: number }
  | { kind: "retained" }
  | { kind: "domain" }
  | { kind: "reference" }
  | { kind: "config" }
  | { kind: "projection" };

export const RETENTION_KEYWORDS = ["retained", "domain", "reference", "config", "projection"] as const;

export type ModelMetadata = {
  lifecycle: LifecycleClass;
  retention: RetentionDisposition;
  sensitivity?: Sensitivity;
  categories?: DataCategoryTag[];
  scope?: RegulatedScopeTag;
  owner?: string;
  steward?: string;
  /** Column the retention window applies to (required when retention is a purge window). */
  timeAxis?: string;
  /** Statutory / regulatory basis for a retained record (cited, not invented). */
  basis?: string;
  /** Minimum years a retained record must be kept; "permanent" never ages out. */
  minYears?: number | "permanent";
};

export const MODEL_METADATA_KEYS = [
  "lifecycle",
  "retention",
  "sensitivity",
  "categories",
  "scope",
  "owner",
  "steward",
  "timeAxis",
  "basis",
  "minYears",
] as const;
type MetadataKey = (typeof MODEL_METADATA_KEYS)[number];

export type ModelMetadataEntry = {
  model: string;
  /** Physical table name: `@@map` when present, else the model name. */
  table: string;
  file: string;
  line: number;
  metadata: ModelMetadata;
};

export type ModelMetadataIssue = { file: string; line: number; model: string | null; message: string };

export type ParsedModelMetadata = {
  entries: ModelMetadataEntry[];
  /** Persistent models (not `@@ignore`d, not views) that carry no @dpf tag. */
  untagged: { model: string; table: string; file: string; line: number }[];
  issues: ModelMetadataIssue[];
};

const ROLE_RE = /^[a-z][a-z0-9-]*$/;
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PURGE_RE = /^(\d{1,5})d$/;

export function parseRetentionValue(value: string): RetentionDisposition | null {
  const purge = PURGE_RE.exec(value);
  if (purge) {
    const days = Number(purge[1]);
    return days > 0 ? { kind: "purge", days } : null;
  }
  return (RETENTION_KEYWORDS as readonly string[]).includes(value)
    ? ({ kind: value } as RetentionDisposition)
    : null;
}

export function formatRetentionValue(r: RetentionDisposition): string {
  return r.kind === "purge" ? `${r.days}d` : r.kind;
}

/** Tokenise one `/// @dpf k=v k=v` line. Values never contain whitespace; `basis` may use `_` for spaces. */
function tokenizeTagLine(body: string): Array<[string, string]> {
  return body
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const eq = tok.indexOf("=");
      return eq === -1 ? [tok, ""] : [tok.slice(0, eq), tok.slice(eq + 1)];
    });
}

/** Validate a key/value bag into ModelMetadata, collecting every problem. */
export function validateModelMetadata(
  pairs: ReadonlyArray<readonly [string, string]>,
  ctx: { file: string; line: number; model: string },
): { metadata: ModelMetadata | null; issues: ModelMetadataIssue[] } {
  const issues: ModelMetadataIssue[] = [];
  const bag = new Map<string, string>();
  const push = (message: string) => issues.push({ ...ctx, message });
  for (const [k, v] of pairs) {
    if (!(MODEL_METADATA_KEYS as readonly string[]).includes(k)) {
      push(`unknown @dpf key "${k}" (allowed: ${MODEL_METADATA_KEYS.join(", ")})`);
      continue;
    }
    if (bag.has(k)) push(`duplicate @dpf key "${k}"`);
    if (!v) push(`@dpf key "${k}" has no value`);
    bag.set(k, v);
  }
  const lifecycle = bag.get("lifecycle");
  if (!lifecycle) push(`@dpf tag needs lifecycle=<${LIFECYCLE_CLASSES.join("|")}>`);
  else if (!(LIFECYCLE_CLASSES as readonly string[]).includes(lifecycle))
    push(`lifecycle "${lifecycle}" is not one of ${LIFECYCLE_CLASSES.join("|")}`);
  const retentionRaw = bag.get("retention");
  const retention = retentionRaw ? parseRetentionValue(retentionRaw) : null;
  if (!retentionRaw) push(`@dpf tag needs retention=<Nd|${RETENTION_KEYWORDS.join("|")}>`);
  else if (!retention) push(`retention "${retentionRaw}" is not <Nd> or one of ${RETENTION_KEYWORDS.join("|")}`);
  const sensitivity = bag.get("sensitivity");
  if (sensitivity && !(SENSITIVITIES as readonly string[]).includes(sensitivity))
    push(`sensitivity "${sensitivity}" is not one of ${SENSITIVITIES.join("|")}`);
  const categoriesRaw = bag.get("categories");
  const categories = categoriesRaw ? categoriesRaw.split(",").filter(Boolean) : undefined;
  for (const c of categories ?? []) {
    if (!(DATA_CATEGORIES as readonly string[]).includes(c)) push(`category "${c}" is not one of ${DATA_CATEGORIES.join("|")}`);
  }
  const scope = bag.get("scope");
  if (scope && !(REGULATED_SCOPES as readonly string[]).includes(scope))
    push(`scope "${scope}" is not one of ${REGULATED_SCOPES.join("|")}`);
  for (const role of ["owner", "steward"] as const) {
    const v = bag.get(role);
    if (v && !ROLE_RE.test(v)) push(`${role} "${v}" must be a lowercase role slug`);
  }
  const timeAxis = bag.get("timeAxis");
  if (timeAxis && !COLUMN_RE.test(timeAxis)) push(`timeAxis "${timeAxis}" is not a column identifier`);
  if (retention?.kind === "purge" && !timeAxis) push(`retention=${retentionRaw} needs timeAxis=<column>`);
  if (retention?.kind === "retained" && !bag.get("basis")) push(`retention=retained needs basis=<statutory_basis>`);
  const minYearsRaw = bag.get("minYears");
  let minYears: number | "permanent" | undefined;
  if (minYearsRaw) {
    if (retention?.kind !== "retained") push(`minYears only applies to retention=retained`);
    if (minYearsRaw === "permanent") minYears = "permanent";
    else if (/^\d{1,3}$/.test(minYearsRaw) && Number(minYearsRaw) > 0) minYears = Number(minYearsRaw);
    else push(`minYears "${minYearsRaw}" must be a positive integer or "permanent"`);
  }
  // Consistency between the class and the disposition: a class the lifecycle
  // algebra marks non-purgeable can never carry a purge window.
  if (retention?.kind === "purge" && lifecycle && !["telemetry-bounded", "ephemeral", "operational"].includes(lifecycle))
    push(`lifecycle=${lifecycle} cannot carry a purge window (only telemetry-bounded, ephemeral, operational may)`);
  if (issues.length > 0 || !lifecycle || !retention) return { metadata: null, issues };
  const metadata: ModelMetadata = { lifecycle: lifecycle as LifecycleClass, retention };
  if (sensitivity) metadata.sensitivity = sensitivity as Sensitivity;
  if (categories?.length) metadata.categories = categories as DataCategoryTag[];
  if (scope) metadata.scope = scope as RegulatedScopeTag;
  if (bag.get("owner")) metadata.owner = bag.get("owner");
  if (bag.get("steward")) metadata.steward = bag.get("steward");
  if (timeAxis) metadata.timeAxis = timeAxis;
  if (bag.get("basis")) metadata.basis = bag.get("basis")!.replace(/_/g, " ");
  if (minYears !== undefined) metadata.minYears = minYears;
  return { metadata, issues };
}

/** Render metadata back to the canonical single-line tag (stable key order). */
export function formatModelMetadataTag(m: ModelMetadata): string {
  const parts = [`lifecycle=${m.lifecycle}`, `retention=${formatRetentionValue(m.retention)}`];
  if (m.sensitivity) parts.push(`sensitivity=${m.sensitivity}`);
  if (m.categories?.length) parts.push(`categories=${m.categories.join(",")}`);
  if (m.scope) parts.push(`scope=${m.scope}`);
  if (m.owner) parts.push(`owner=${m.owner}`);
  if (m.steward) parts.push(`steward=${m.steward}`);
  if (m.timeAxis) parts.push(`timeAxis=${m.timeAxis}`);
  if (m.basis) parts.push(`basis=${m.basis.replace(/\s+/g, "_")}`);
  if (m.minYears !== undefined) parts.push(`minYears=${m.minYears}`);
  return `/// ${MODEL_METADATA_TAG} ${parts.join(" ")}`;
}

const MODEL_OPEN_RE = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
const MAP_RE = /^\s*@@map\(\s*"([^"]+)"\s*\)/;
const DOC_RE = /^\s*\/\/\/(.*)$/;

/**
 * Parse one schema file. Pure. Handles the split-schema layout (26 files) by
 * being called once per file; the caller concatenates entries.
 */
export function parseModelMetadataSource(source: string, file: string): ParsedModelMetadata {
  const lines = source.split(/\r?\n/);
  const entries: ModelMetadataEntry[] = [];
  const untagged: ParsedModelMetadata["untagged"] = [];
  const issues: ModelMetadataIssue[] = [];
  let pendingPairs: Array<[string, string]> = [];
  let pendingTagLine = 0;
  let sawTagForNext = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const doc = DOC_RE.exec(line);
    if (doc) {
      const body = doc[1].trim();
      if (body.startsWith(MODEL_METADATA_TAG)) {
        if (!sawTagForNext) pendingTagLine = i + 1;
        sawTagForNext = true;
        pendingPairs.push(...tokenizeTagLine(body.slice(MODEL_METADATA_TAG.length)));
      }
      continue;
    }
    const open = MODEL_OPEN_RE.exec(line);
    if (!open) {
      // Any non-doc, non-model line breaks the "directly above" relation.
      if (line.trim() !== "") {
        if (sawTagForNext) issues.push({ file, line: pendingTagLine, model: null, message: `@dpf tag is not directly above a model block` });
        pendingPairs = [];
        sawTagForNext = false;
      }
      continue;
    }
    const model = open[1];
    // Scan the block for @@map / @@ignore and the closing brace.
    let table = model;
    let ignored = false;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const l = lines[j];
      if (/^\s*\}/.test(l)) break;
      const map = MAP_RE.exec(l);
      if (map) table = map[1];
      if (/^\s*@@ignore\b/.test(l)) ignored = true;
    }
    if (!ignored) {
      if (sawTagForNext) {
        const { metadata, issues: v } = validateModelMetadata(pendingPairs, { file, line: pendingTagLine, model });
        issues.push(...v);
        if (metadata) entries.push({ model, table, file, line: pendingTagLine, metadata });
      } else {
        untagged.push({ model, table, file, line: i + 1 });
      }
    }
    pendingPairs = [];
    sawTagForNext = false;
    i = j;
  }
  return { entries, untagged, issues };
}

export function parseModelMetadataSources(sources: ReadonlyArray<{ file: string; source: string }>): ParsedModelMetadata {
  const out: ParsedModelMetadata = { entries: [], untagged: [], issues: [] };
  const seen = new Map<string, string>();
  for (const s of sources) {
    const p = parseModelMetadataSource(s.source, s.file);
    for (const e of p.entries) {
      const prior = seen.get(e.model);
      if (prior) out.issues.push({ file: e.file, line: e.line, model: e.model, message: `model declared twice (${prior}, ${e.file})` });
      seen.set(e.model, e.file);
    }
    out.entries.push(...p.entries);
    out.untagged.push(...p.untagged);
    out.issues.push(...p.issues);
  }
  return out;
}

// ── Catalog carrier ─────────────────────────────────────────────────────────

/** The exact string written by COMMENT ON TABLE. Stable key order → stable diff. */
export function toCatalogComment(m: ModelMetadata, model?: string): string {
  const ordered: Record<string, unknown> = {};
  // The Prisma model name travels with the comment so a catalog reader can
  // address the Prisma delegate without re-parsing the schema.
  if (model) ordered.model = model;
  ordered.lifecycle = m.lifecycle;
  ordered.retention = formatRetentionValue(m.retention);
  if (m.sensitivity) ordered.sensitivity = m.sensitivity;
  if (m.categories?.length) ordered.categories = m.categories;
  if (m.scope) ordered.scope = m.scope;
  if (m.owner) ordered.owner = m.owner;
  if (m.steward) ordered.steward = m.steward;
  if (m.timeAxis) ordered.timeAxis = m.timeAxis;
  if (m.basis) ordered.basis = m.basis;
  if (m.minYears !== undefined) ordered.minYears = m.minYears;
  return `${MODEL_METADATA_COMMENT_PREFIX}${JSON.stringify(ordered)}`;
}

/** Read a catalog comment back. Returns null for a non-DPF or malformed comment. */
export function parseCatalogComment(comment: string | null | undefined): ModelMetadata | null {
  return parseCatalogCommentWithModel(comment)?.metadata ?? null;
}

/** Same as parseCatalogComment but also returns the Prisma model name when the comment carries one. */
export function parseCatalogCommentWithModel(
  comment: string | null | undefined,
): { model: string | null; metadata: ModelMetadata } | null {
  if (!comment || !comment.startsWith(MODEL_METADATA_COMMENT_PREFIX)) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(comment.slice(MODEL_METADATA_COMMENT_PREFIX.length)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pairs: Array<[string, string]> = [];
  const model = typeof raw.model === "string" ? raw.model : null;
  for (const [k, v] of Object.entries(raw)) {
    if (k === "model") continue;
    if (Array.isArray(v)) pairs.push([k, v.join(",")]);
    else if (typeof v === "number") pairs.push([k, String(v)]);
    else if (typeof v === "string") pairs.push([k, k === "basis" ? v.replace(/\s+/g, "_") : v]);
  }
  const { metadata } = validateModelMetadata(pairs, { file: "<catalog>", line: 0, model: model ?? "<catalog>" });
  return metadata ? { model, metadata } : null;
}
