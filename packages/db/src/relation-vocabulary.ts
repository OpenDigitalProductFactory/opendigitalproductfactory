// packages/db/src/relation-vocabulary.ts
// The governed vocabulary of graph_edge.rel_type (EP-5F6369AB, BI-85389A35).
// Design: docs/superpowers/specs/2026-10-27-typed-relation-vocabulary-design.md.
//
// Every relation written to the graph mirror names what it means: a registered
// key with a meaning, a direction, endpoint kinds, an inverse label and a class.
// A generic catch-all ("associated with", "related to", "linked to", a bare
// "references") is refused. The entries live in relation-vocabulary-entries.ts;
// this module holds the shape and the checks every writer runs.

import { RELATION_TYPE_ENTRIES } from "./relation-vocabulary-entries";

/** How an analysis should read an edge. */
export type RelationClass = "semantic" | "structural" | "navigational" | "provenance";

/** `deprecated` stays writable while its owning item retypes its writer; `retired` is refused. */
export type RelationStatus = "active" | "deprecated" | "retired";

export type RelationStandard = {
  vocabulary: "archimate-3.2" | "bpmn-2.0" | "sysml-v2" | "skos" | "prov-o" | "schema.org" | "sql" | "rfc-8288" | "csdm";
  term: string;
};

export type RelationTypeDef = {
  /** UPPER_SNAKE key stored in graph_edge.rel_type. */
  key: string;
  /** Read source → target: "depends on". */
  label: string;
  /** Read target → source: "is depended on by". A label, never a second stored edge. */
  inverseLabel: string;
  /** One testable sentence. */
  meaning: string;
  relationClass: RelationClass;
  symmetric?: boolean;
  /** graph_node labels allowed at the source / target end. */
  domain: readonly string[];
  range: readonly string[];
  standard?: RelationStandard;
  /** Props every edge of this type must carry. */
  requiredProps?: readonly string[];
  /** A weak standard relation kept only with a qualifier naming its specific meaning. */
  quarantine?: { requiredQualifier: string; allowed?: readonly string[] };
  status: RelationStatus;
  /** For deprecated / retired: the key that replaces it and the item that retypes its writers. */
  replacedBy?: string;
  ownerItem?: string;
};

export const RELATION_TYPES: readonly RelationTypeDef[] = RELATION_TYPE_ENTRIES;

export type RelationType = (typeof RELATION_TYPE_ENTRIES)[number]["key"];

const BY_KEY: ReadonlyMap<string, RelationTypeDef> = new Map(RELATION_TYPES.map((d) => [d.key, d]));

export function getRelationType(key: string): RelationTypeDef | undefined {
  return BY_KEY.get(key);
}

export const RELATION_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Names that say two things are connected but not how. A new key matching one
 * is refused; the legacy keys that match are registered `deprecated` or
 * `retired` with the item that removes them.
 */
const GENERIC_RELATION_NAME =
  /^(ASSOCIATED(_WITH)?|ASSOCIATION|ASSOCIATES(_WITH)?|RELATES?(_TO)?|RELATED(_TO)?|RELATION(SHIP)?|LINKED(_TO)?|LINK|CONNECTED(_TO)?|REFERENCES|REFERS_TO|REFERENCE|MISC|OTHER|GENERIC|HAS|IS)$/;

export function isGenericRelationName(key: string): boolean {
  return GENERIC_RELATION_NAME.test(key.toUpperCase());
}

export class RelationTypeError extends Error {
  constructor(
    message: string,
    readonly code: "unregistered" | "retired" | "missing-prop" | "missing-qualifier",
  ) {
    super(message);
    this.name = "RelationTypeError";
  }
}

/**
 * The write-time check every graph_edge writer runs. Throws when the type is
 * unregistered or retired, or when a required prop or quarantine qualifier is
 * missing. Returns the definition so callers can log a deprecated write.
 */
export function assertRelationWrite(
  relType: string,
  props: Record<string, unknown> = {},
  registry: ReadonlyMap<string, RelationTypeDef> = BY_KEY,
): RelationTypeDef {
  const def = registry.get(relType);
  if (!def) {
    throw new RelationTypeError(
      `graph_edge rel_type "${relType}" is not in the relation vocabulary (packages/db/src/relation-vocabulary-entries.ts). ` +
        "Register it with a meaning, direction, domain/range and inverse label; generic names are refused.",
      "unregistered",
    );
  }
  if (def.status === "retired") {
    throw new RelationTypeError(
      `graph_edge rel_type "${relType}" is retired${def.replacedBy ? `; write ${def.replacedBy}` : ""}.`,
      "retired",
    );
  }
  for (const prop of def.requiredProps ?? []) {
    if (props[prop] === undefined || props[prop] === null || props[prop] === "") {
      throw new RelationTypeError(`graph_edge rel_type "${relType}" requires prop "${prop}".`, "missing-prop");
    }
  }
  if (def.quarantine) {
    const value = props[def.quarantine.requiredQualifier];
    const allowed = def.quarantine.allowed;
    if (typeof value !== "string" || value.trim() === "" || (allowed && !allowed.includes(value))) {
      throw new RelationTypeError(
        `graph_edge rel_type "${relType}" is a weak relation and requires qualifier "${def.quarantine.requiredQualifier}"` +
          (allowed ? ` (one of ${allowed.join(", ")})` : "") +
          " naming its specific meaning.",
        "missing-qualifier",
      );
    }
  }
  return def;
}

/** Narrow a dynamic string (an EA neoType, an inventory relationship type) to a registered key. */
export function toRelationType(raw: string): RelationType {
  const def = BY_KEY.get(raw);
  if (!def) throw new RelationTypeError(`"${raw}" is not a registered graph_edge rel_type.`, "unregistered");
  if (def.status === "retired") throw new RelationTypeError(`"${raw}" is a retired graph_edge rel_type.`, "retired");
  return raw as RelationType;
}

/** Registry problems: bad keys, duplicates, generic active names, dangling replacements. Empty when sound. */
export function lintRelationVocabulary(entries: readonly RelationTypeDef[] = RELATION_TYPES): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const keys = new Set(entries.map((e) => e.key));
  for (const e of entries) {
    if (!RELATION_KEY_PATTERN.test(e.key)) problems.push(`${e.key}: key must be UPPER_SNAKE`);
    if (seen.has(e.key)) problems.push(`${e.key}: duplicate key`);
    seen.add(e.key);
    if (e.status === "active" && isGenericRelationName(e.key)) problems.push(`${e.key}: generic relation name`);
    if (!e.label.trim() || !e.inverseLabel.trim() || !e.meaning.trim()) problems.push(`${e.key}: label, inverse label and meaning are required`);
    if (e.domain.length === 0 || e.range.length === 0) problems.push(`${e.key}: domain and range are required`);
    if (e.status !== "active") {
      if (!e.ownerItem) problems.push(`${e.key}: a ${e.status} type names the item that removes it`);
      if (e.replacedBy && !keys.has(e.replacedBy)) problems.push(`${e.key}: replacedBy ${e.replacedBy} is not registered`);
    }
  }
  return problems;
}
