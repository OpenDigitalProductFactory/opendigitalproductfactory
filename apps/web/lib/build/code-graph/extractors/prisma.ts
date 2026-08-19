import type {
  CodeGraphAttributes,
  CodeGraphExtraction,
  CodeGraphExtractor,
  CodeGraphExtractorInput,
} from "../types";
import {
  parsePrismaSchema,
  PRISMA_SCHEMA_ADAPTER_VERSION,
  type PrismaModelFact,
} from "./prisma-schema-adapter";

const EXTRACTOR = "prisma-dmmf-v2";

function modelKey(graphKey: string, modelName: string): string {
  return `${graphKey}:prisma-model:${modelName}`;
}

function fieldKey(graphKey: string, modelName: string, fieldName: string): string {
  return `${graphKey}:prisma-field:${modelName}.${fieldName}`;
}

function modelAttributes(model: PrismaModelFact): CodeGraphAttributes {
  const attributes: CodeGraphAttributes = {
    fieldCount: model.fields.length,
    isIgnored: model.isIgnored,
  };
  if (model.mappedTable) attributes.mappedTable = model.mappedTable;
  return attributes;
}

export function extractPrismaFacts(input: CodeGraphExtractorInput): CodeGraphExtraction {
  const nodes: CodeGraphExtraction["nodes"] = [];
  const edges: CodeGraphExtraction["edges"] = [];

  const facts = parsePrismaSchema(input.sourceText);

  for (const model of facts.models) {
    const key = modelKey(input.graphKey, model.name);
    nodes.push({
      graphKey: input.graphKey,
      kind: "PrismaModel",
      key,
      name: model.name,
      filePath: input.filePath,
      startLine: model.startLine,
      endLine: model.endLine,
      extractor: EXTRACTOR,
      attributes: modelAttributes(model),
    });
    edges.push({
      graphKey: input.graphKey,
      kind: "DEFINES",
      fromKey: `${input.graphKey}:${input.filePath}`,
      toKey: key,
      filePath: input.filePath,
      startLine: model.startLine,
      endLine: model.startLine,
      confidence: "exact",
      extractor: EXTRACTOR,
    });

    for (const field of model.fields) {
      const fKey = fieldKey(input.graphKey, model.name, field.name);
      const fieldAttributes: CodeGraphAttributes = {
        model: model.name,
        fieldKind: field.kind,
        rawType: field.rawType,
        isList: field.isList,
        isRequired: field.isRequired,
        isId: field.isId,
        isUnique: field.isUnique,
        hasDefault: field.hasDefault,
        isUpdatedAt: field.isUpdatedAt,
        isIgnored: field.isIgnored,
      };
      if (field.mappedColumn) fieldAttributes.mappedColumn = field.mappedColumn;

      nodes.push({
        graphKey: input.graphKey,
        kind: "PrismaField",
        key: fKey,
        name: field.name,
        filePath: input.filePath,
        startLine: field.line,
        endLine: field.line,
        extractor: EXTRACTOR,
        attributes: fieldAttributes,
      });
      edges.push({
        graphKey: input.graphKey,
        kind: "HAS_FIELD",
        fromKey: key,
        toKey: fKey,
        filePath: input.filePath,
        startLine: field.line,
        endLine: field.line,
        confidence: "exact",
        extractor: EXTRACTOR,
      });
    }
  }

  for (const relation of facts.relations) {
    const relationAttributes: CodeGraphAttributes = {
      cardinality: relation.cardinality,
      fieldName: relation.fieldName,
      isFkIndexed: relation.isFkIndexed,
    };
    if (relation.relationName) relationAttributes.relationName = relation.relationName;
    if (relation.fkFields.length > 0) relationAttributes.fkFields = relation.fkFields.join(",");
    if (relation.references.length > 0) relationAttributes.references = relation.references.join(",");

    edges.push({
      graphKey: input.graphKey,
      kind: "RELATES_TO",
      fromKey: modelKey(input.graphKey, relation.fromModel),
      toKey: modelKey(input.graphKey, relation.toModel),
      filePath: input.filePath,
      startLine: relation.line,
      endLine: relation.line,
      confidence: "exact",
      extractor: EXTRACTOR,
      attributes: relationAttributes,
    });
  }

  return { nodes, edges };
}

export const prismaExtractor: CodeGraphExtractor = {
  name: "prisma",
  version: PRISMA_SCHEMA_ADAPTER_VERSION,
  matches(filePath) {
    return filePath.replace(/\\/g, "/").endsWith(".prisma");
  },
  extract: extractPrismaFacts,
};
