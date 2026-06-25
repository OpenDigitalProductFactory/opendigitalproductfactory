// EP-MSP-FEDERATION · B2 + WS-0c — scoped estate projection serialization
// (BI-4F8F50FD). The egress gate that makes sovereign-peer federation safe:
// only contract-allow-listed slices/fields cross a FederationLink, and a hard
// forbidden-field guard drops PHI / privilege / financial / secret / raw-content
// fields even if a contract mistakenly allow-lists them (belt-and-suspenders for
// the HIPAA minimum-necessary + legal-privilege guarantee). Pure + exhaustively
// testable so the "client data never crosses the link" claim is provable with
// negative-egress assertions.

export type RetentionClass = "ephemeral" | "short" | "standard" | "compliance-hold";

export interface ProjectionContractSpec {
  /** Top-level slices allowed to cross (e.g. "health", "inventory", "incidents", "slo"). */
  includeSlices: string[];
  /** Slices explicitly forbidden — defense in depth on top of the allow-list. */
  excludeSlices: string[];
  /**
   * Per-slice field allow-list. A slice in includeSlices but absent here emits
   * all of its non-forbidden fields; a slice listed here emits ONLY these fields.
   */
  fieldAllowList?: Record<string, string[]>;
  retentionClass?: RetentionClass;
}

// Field-name classes that must NEVER egress regardless of contract. Matched on
// any key anywhere in the payload tree. This is the last line of defense behind
// the contract allow-list.
const FORBIDDEN_FIELD_PATTERNS: RegExp[] = [
  /(ssn|dob|patient|phi|diagnosis|medical|prescription)/i,
  /(matter|privilege|attorney|legalhold|casefile)/i,
  /(accountnumber|routingnumber|cardnumber|iban|salary|payroll|taxid)/i,
  /(password|secret|apikey|privatekey|credential|bearer)/i,
  /(documentbody|filecontents|rawlog|attachment|emailbody)/i,
];

function normalizeKey(key: string): string {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

/** True when a field key matches a forbidden class (never allowed to egress). */
export function isForbiddenField(key: string): boolean {
  const norm = normalizeKey(key);
  return FORBIDDEN_FIELD_PATTERNS.some((re) => re.test(norm));
}

export interface ProjectionResult {
  projected: Record<string, unknown>;
  excluded: {
    slices: string[];
    fields: string[];
    forbidden: string[];
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively strip forbidden-named fields anywhere in a subtree. */
function stripForbidden(value: unknown, path: string, forbidden: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => stripForbidden(v, `${path}[${i}]`, forbidden));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isForbiddenField(k)) {
        forbidden.push(path ? `${path}.${k}` : k);
        continue;
      }
      out[k] = stripForbidden(v, path ? `${path}.${k}` : k, forbidden);
    }
    return out;
  }
  return value;
}

/**
 * Produce the minimized, allow-listed, forbidden-stripped projection of a raw
 * estate payload, plus a proof of everything that was withheld. The output is
 * what crosses the link; nothing else does.
 */
export function projectEstatePayload(
  contract: ProjectionContractSpec,
  payload: Record<string, unknown>,
): ProjectionResult {
  const projected: Record<string, unknown> = {};
  const excluded = { slices: [] as string[], fields: [] as string[], forbidden: [] as string[] };
  const include = new Set(contract.includeSlices);
  const exclude = new Set(contract.excludeSlices);

  for (const [slice, value] of Object.entries(payload)) {
    if (exclude.has(slice) || !include.has(slice)) {
      excluded.slices.push(slice);
      continue;
    }
    let sliceValue = value;
    const allow = contract.fieldAllowList?.[slice];
    if (allow && isPlainObject(value)) {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (allow.includes(k)) filtered[k] = v;
        else excluded.fields.push(`${slice}.${k}`);
      }
      sliceValue = filtered;
    }
    projected[slice] = stripForbidden(sliceValue, slice, excluded.forbidden);
  }

  return { projected, excluded };
}

/**
 * Negative-egress proof: returns the list of violations if a projected payload
 * still contains an excluded slice or a forbidden field. An empty array means
 * the projection is provably minimum-necessary. Tests assert this is empty.
 */
export function assertNoExcludedEgress(
  contract: ProjectionContractSpec,
  projected: Record<string, unknown>,
): string[] {
  const violations: string[] = [];
  const exclude = new Set(contract.excludeSlices);
  const include = new Set(contract.includeSlices);

  for (const slice of Object.keys(projected)) {
    if (exclude.has(slice)) violations.push(`excluded-slice:${slice}`);
    if (!include.has(slice)) violations.push(`non-included-slice:${slice}`);
  }

  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        if (isForbiddenField(k)) violations.push(`forbidden-field:${path ? `${path}.` : ""}${k}`);
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(projected, "");

  return violations;
}

// ── CloudEvents-compatible outer envelope (spec §4.1 / §11.2) ─────────────────
// DPF keeps its internal PD-CEF edge envelope; this is only the cross-domain
// wrapper a federated projection rides in, so a non-DPF adapter could consume it.

export interface CloudEventEnvelope {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: "application/json";
  /** Federation link the projection crossed, for audit on both sides. */
  dpflinkid?: string;
  data: unknown;
}

export function toCloudEvent(input: {
  id: string;
  source: string;
  type: string;
  time: string;
  linkId?: string;
  data: unknown;
}): CloudEventEnvelope {
  return {
    specversion: "1.0",
    id: input.id,
    source: input.source,
    type: input.type,
    time: input.time,
    datacontenttype: "application/json",
    ...(input.linkId ? { dpflinkid: input.linkId } : {}),
    data: input.data,
  };
}
