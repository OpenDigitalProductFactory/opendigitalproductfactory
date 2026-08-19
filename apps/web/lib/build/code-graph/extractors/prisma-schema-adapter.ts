// Prisma schema adapter — EP-DATA-ARCH Phase 1 (BI-8579FB2D).
//
// Parses a Prisma schema into a rich, typed fact structure: models with
// fields, types, mapped names, indexes, and relations carrying derived
// cardinality + FK-index coverage. This is the structured source consumed by
// (a) the code-graph Prisma extractor (graph nodes/edges) and (b) the EA
// data-model mirror (EP-DATA-ARCH Phase 2).
//
// Design note (spec docs/superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md §4/§6.1):
// This is a self-contained parser, NOT a dependency on `@prisma/internals`.
// The repo pins Prisma 7.8.0 and does not ship `@prisma/internals`; `getDMMF`
// is not a stable public schema API under Prisma 7. The adapter exposes a
// stable interface (`parsePrismaSchema`) so the implementation can be swapped
// for a DMMF/manifest-backed one later without touching consumers.

export type PrismaFieldKind = "scalar" | "enum" | "relation" | "unsupported";

export type RelationCardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

const PRISMA_SCALAR_TYPES = new Set([
  "String",
  "Boolean",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "DateTime",
  "Json",
  "Bytes",
]);

export type PrismaRelationAttribute = {
  name: string | null;
  fields: string[];
  references: string[];
  onDelete: string | null;
  onUpdate: string | null;
};

export type PrismaFieldFact = {
  name: string;
  /** Column name from `@map(...)`, else null. */
  mappedColumn: string | null;
  /** Declared type with `[]`/`?` stripped, e.g. `User`, `String`. */
  rawType: string;
  kind: PrismaFieldKind;
  isList: boolean;
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  isUpdatedAt: boolean;
  isIgnored: boolean;
  /** Present when kind === "relation". */
  relation: PrismaRelationAttribute | null;
  line: number;
};

export type PrismaBlockIndexKind = "index" | "unique" | "id";

export type PrismaBlockIndex = {
  kind: PrismaBlockIndexKind;
  fields: string[];
  line: number;
};

export type PrismaModelFact = {
  name: string;
  /** Table name from `@@map(...)`, else null. */
  mappedTable: string | null;
  isIgnored: boolean;
  startLine: number;
  endLine: number;
  fields: PrismaFieldFact[];
  blockIndexes: PrismaBlockIndex[];
};

export type PrismaEnumFact = {
  name: string;
  values: string[];
  line: number;
};

export type PrismaRelationFact = {
  /** Model that declares the relation field. */
  fromModel: string;
  /** Referenced model (the relation field's type). */
  toModel: string;
  fieldName: string;
  relationName: string | null;
  /** Cardinality as seen from fromModel -> toModel. */
  cardinality: RelationCardinality;
  /** Local scalar FK fields (only on the owning side; may be empty). */
  fkFields: string[];
  references: string[];
  /** True when fkFields are covered by an index/unique/id (FK-without-index check). */
  isFkIndexed: boolean;
  line: number;
};

export type PrismaSchemaFacts = {
  models: PrismaModelFact[];
  enums: PrismaEnumFact[];
  relations: PrismaRelationFact[];
};

type RawBlock = {
  blockType: "model" | "enum" | "type";
  name: string;
  startLine: number;
  endLine: number;
  body: Array<{ text: string; line: number }>;
};

/** Strip line/doc comments outside of quoted strings. */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    if (!inString && ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

function tokenizeBlocks(sourceText: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const lines = sourceText.split("\n");
  const blockHead = /^\s*(model|enum|type)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;

  let current: RawBlock | null = null;
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const lineNumber = index + 1;
    const line = stripComment(rawLine);

    if (!current) {
      const head = blockHead.exec(line);
      if (head) {
        current = {
          blockType: head[1] as RawBlock["blockType"],
          name: head[2],
          startLine: lineNumber,
          endLine: lineNumber,
          body: [],
        };
      }
      continue;
    }

    if (/^\s*\}\s*$/.test(line)) {
      current.endLine = lineNumber;
      blocks.push(current);
      current = null;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length > 0) {
      current.body.push({ text: trimmed, line: lineNumber });
    }
  }

  return blocks;
}

function parseBracketList(source: string, key: string): string[] {
  // Matches `key: [a, b]` capturing the inner list.
  const pattern = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`);
  const match = pattern.exec(source);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseNamedArg(source: string, key: string): string | null {
  const pattern = new RegExp(`${key}\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)`);
  const match = pattern.exec(source);
  return match ? match[1] : null;
}

function parseRelationAttribute(fieldText: string): PrismaRelationAttribute | null {
  const relationStart = fieldText.indexOf("@relation");
  if (relationStart === -1) return null;
  // Extract the parenthesised argument list (handles nested brackets simply).
  const open = fieldText.indexOf("(", relationStart);
  if (open === -1) {
    return { name: null, fields: [], references: [], onDelete: null, onUpdate: null };
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < fieldText.length; i++) {
    if (fieldText[i] === "(") depth++;
    else if (fieldText[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const args = close === -1 ? fieldText.slice(open + 1) : fieldText.slice(open + 1, close);

  const quotedName = /^\s*"([^"]*)"/.exec(args);
  const namedName = /name\s*:\s*"([^"]*)"/.exec(args);
  const name = namedName?.[1] ?? quotedName?.[1] ?? null;

  return {
    name,
    fields: parseBracketList(args, "fields"),
    references: parseBracketList(args, "references"),
    onDelete: parseNamedArg(args, "onDelete"),
    onUpdate: parseNamedArg(args, "onUpdate"),
  };
}

function parseMapValue(fieldText: string): string | null {
  const match = /@map\s*\(\s*"([^"]*)"\s*\)/.exec(fieldText);
  return match ? match[1] : null;
}

function classifyType(
  rawType: string,
  enumNames: Set<string>,
  modelNames: Set<string>,
): PrismaFieldKind {
  if (PRISMA_SCALAR_TYPES.has(rawType)) return "scalar";
  if (enumNames.has(rawType)) return "enum";
  if (modelNames.has(rawType)) return "relation";
  return "unsupported";
}

function parseFieldLine(
  text: string,
  line: number,
  enumNames: Set<string>,
  modelNames: Set<string>,
): PrismaFieldFact | null {
  // A field line: `name Type<modifiers> @attr...`. Skip block attributes.
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_."()]*(?:\[\])?\??)/.exec(text);
  if (!match) return null;

  const name = match[1];
  let typeToken = match[2];
  const isList = typeToken.endsWith("[]");
  if (isList) typeToken = typeToken.slice(0, -2);
  const isOptional = typeToken.endsWith("?");
  if (isOptional) typeToken = typeToken.slice(0, -1);
  const rawType = typeToken;

  const kind = classifyType(rawType, enumNames, modelNames);
  const relation = kind === "relation" ? parseRelationAttribute(text) : null;

  return {
    name,
    mappedColumn: parseMapValue(text),
    rawType,
    kind,
    isList,
    isRequired: !isOptional && !isList,
    isId: /@id\b/.test(text),
    isUnique: /@unique\b/.test(text),
    hasDefault: /@default\s*\(/.test(text),
    isUpdatedAt: /@updatedAt\b/.test(text),
    isIgnored: /@ignore\b/.test(text),
    relation,
    line,
  };
}

function parseBlockIndex(text: string, line: number): PrismaBlockIndex | null {
  const head = /^@@(id|unique|index)\b/.exec(text);
  if (!head) return null;
  const kind = head[1] as PrismaBlockIndexKind;
  // Fields can be `[a, b]` or a single `field`. `@@id([a])` / `@@index([a, b])`.
  const listMatch = /\[([^\]]*)\]/.exec(text);
  const fields = listMatch
    ? listMatch[1]
        .split(",")
        .map((entry) => entry.trim().replace(/\(.*$/, "").trim())
        .filter((entry) => entry.length > 0)
    : [];
  return { kind, fields, line };
}

function parseModelBlock(
  block: RawBlock,
  enumNames: Set<string>,
  modelNames: Set<string>,
): PrismaModelFact {
  const fields: PrismaFieldFact[] = [];
  const blockIndexes: PrismaBlockIndex[] = [];
  let mappedTable: string | null = null;
  let isIgnored = false;

  for (const { text, line } of block.body) {
    if (text.startsWith("@@")) {
      const mapMatch = /^@@map\s*\(\s*"([^"]*)"\s*\)/.exec(text);
      if (mapMatch) {
        mappedTable = mapMatch[1];
        continue;
      }
      if (/^@@ignore\b/.test(text)) {
        isIgnored = true;
        continue;
      }
      const blockIndex = parseBlockIndex(text, line);
      if (blockIndex) blockIndexes.push(blockIndex);
      continue;
    }
    const field = parseFieldLine(text, line, enumNames, modelNames);
    if (field) fields.push(field);
  }

  return {
    name: block.name,
    mappedTable,
    isIgnored,
    startLine: block.startLine,
    endLine: block.endLine,
    fields,
    blockIndexes,
  };
}

function fieldsCoveredByIndex(fkFields: string[], model: PrismaModelFact): boolean {
  if (fkFields.length === 0) return false;
  // Single FK field is covered if it is @id/@unique on the field itself.
  if (fkFields.length === 1) {
    const owning = model.fields.find((field) => field.name === fkFields[0]);
    if (owning && (owning.isId || owning.isUnique)) return true;
  }
  // Covered if a block index's leading fields match the FK fields (prefix match).
  return model.blockIndexes.some((index) => {
    if (index.fields.length < fkFields.length) return false;
    return fkFields.every((field, position) => index.fields[position] === field);
  });
}

function deriveCardinality(thisIsList: boolean, inverseIsList: boolean): RelationCardinality {
  if (thisIsList && inverseIsList) return "many-to-many";
  if (thisIsList && !inverseIsList) return "one-to-many";
  if (!thisIsList && inverseIsList) return "many-to-one";
  return "one-to-one";
}

function deriveRelations(models: PrismaModelFact[]): PrismaRelationFact[] {
  const modelByName = new Map(models.map((model) => [model.name, model]));
  const relations: PrismaRelationFact[] = [];

  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "relation") continue;
      const target = modelByName.get(field.rawType);
      if (!target) continue;

      // Find the inverse relation field on the target model.
      const inverse = target.fields.find((candidate) => {
        if (candidate.kind !== "relation" || candidate.rawType !== model.name) return false;
        const thisName = field.relation?.name ?? null;
        const candidateName = candidate.relation?.name ?? null;
        if (thisName || candidateName) return thisName === candidateName;
        return true;
      });

      const inverseIsList = inverse?.isList ?? false;
      const fkFields = field.relation?.fields ?? [];

      relations.push({
        fromModel: model.name,
        toModel: target.name,
        fieldName: field.name,
        relationName: field.relation?.name ?? null,
        cardinality: deriveCardinality(field.isList, inverseIsList),
        fkFields,
        references: field.relation?.references ?? [],
        isFkIndexed: fieldsCoveredByIndex(fkFields, model),
        line: field.line,
      });
    }
  }

  return relations;
}

/**
 * Parse a Prisma schema source into rich, typed facts.
 * Pure and deterministic — safe to call at build time and in tests.
 */
export function parsePrismaSchema(sourceText: string): PrismaSchemaFacts {
  const blocks = tokenizeBlocks(sourceText);
  const modelNames = new Set(
    blocks.filter((block) => block.blockType === "model").map((block) => block.name),
  );
  const enumBlocks = blocks.filter((block) => block.blockType === "enum");
  const enumNames = new Set(enumBlocks.map((block) => block.name));

  const enums: PrismaEnumFact[] = enumBlocks.map((block) => ({
    name: block.name,
    values: block.body
      .map((entry) => entry.text)
      .filter((text) => !text.startsWith("@@"))
      .map((text) => text.split(/\s+/)[0])
      .filter((value) => value.length > 0),
    line: block.startLine,
  }));

  const models = blocks
    .filter((block) => block.blockType === "model")
    .map((block) => parseModelBlock(block, enumNames, modelNames));

  const relations = deriveRelations(models);

  return { models, enums, relations };
}

/** Adapter version — bump when the parsing contract changes. */
export const PRISMA_SCHEMA_ADAPTER_VERSION = "prisma-schema-adapter-v1";
