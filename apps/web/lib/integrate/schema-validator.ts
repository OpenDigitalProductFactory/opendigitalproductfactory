/**
 * Prisma Schema Validator — Data Architect Agent
 *
 * Validates schema changes for common issues that cause migration failures:
 * - Missing inverse relations (the #1 Prisma error)
 * - Enums referenced but not defined
 * - Models referenced but not defined
 * - Foreign key fields without indexes
 *
 * This runs inside the sandbox on the schema file, catching issues
 * BEFORE prisma migrate is attempted.
 */

export interface SchemaIssue {
  severity: "error" | "warning";
  line: number;
  message: string;
  fix: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaIssue[];
  summary: string;
}

/**
 * Validate a Prisma schema string for common issues.
 */
export function validatePrismaSchema(schemaContent: string): SchemaValidationResult {
  const lines = schemaContent.split("\n");
  const issues: SchemaIssue[] = [];

  // Parse all defined models, enums, and relations
  const definedModels = new Set<string>();
  const definedEnums = new Set<string>();
  const relations: Array<{
    sourceModel: string;
    targetModel: string;
    relationName: string | null;
    line: number;
    isArray: boolean;
  }> = [];

  let currentModel: string | null = null;
  const fkFields: Array<{ model: string; field: string; line: number }> = [];
  const indexedFields = new Set<string>(); // "Model.field"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track model definitions
    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      definedModels.add(currentModel);
      continue;
    }

    // Track enum definitions
    const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      definedEnums.add(enumMatch[1]);
      currentModel = null;
      continue;
    }

    // Track closing braces
    if (trimmed === "}") {
      currentModel = null;
      continue;
    }

    if (!currentModel) continue;

    // Track relations: fieldName ModelName @relation(...)
    // Also catches: fieldName ModelName[] @relation(...)
    // And: fieldName ModelName? @relation(...)
    const relationMatch = trimmed.match(
      /^\w+\s+(\w+)(\[\])?\??\s+@relation\((?:"([^"]+)"|'([^']+)')/
    );
    if (relationMatch) {
      relations.push({
        sourceModel: currentModel,
        targetModel: relationMatch[1],
        relationName: relationMatch[3] ?? relationMatch[4] ?? null,
        line: i + 1,
        isArray: !!relationMatch[2],
      });
      continue;
    }

    // Also catch implicit relations (no @relation decorator but type is a model)
    const implicitRelationMatch = trimmed.match(
      /^(\w+)\s+(\w+)(\[\])?\??\s*$/
    );
    if (implicitRelationMatch) {
      const fieldType = implicitRelationMatch[2];
      // Only count if it looks like a model reference (PascalCase, not a scalar type)
      if (
        fieldType[0] === fieldType[0].toUpperCase() &&
        !["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"].includes(fieldType)
      ) {
        relations.push({
          sourceModel: currentModel,
          targetModel: fieldType,
          relationName: null,
          line: i + 1,
          isArray: !!implicitRelationMatch[3],
        });
      }
    }

    // Track foreign key fields (fields ending in Id with @relation on previous line)
    const fkMatch = trimmed.match(/^(\w+Id)\s+String/);
    if (fkMatch) {
      fkFields.push({ model: currentModel, field: fkMatch[1], line: i + 1 });
    }

    // Track indexed fields from @@index
    const indexMatch = trimmed.match(/@@index\(\[(.+)\]\)/);
    if (indexMatch) {
      const fields = indexMatch[1].split(",").map((f) => f.trim().replace(/"/g, ""));
      for (const f of fields) {
        indexedFields.add(`${currentModel}.${f}`);
      }
    }

    // Track unique fields
    const uniqueMatch = trimmed.match(/@@unique\(\[(.+)\]\)/);
    if (uniqueMatch) {
      const fields = uniqueMatch[1].split(",").map((f) => f.trim().replace(/"/g, ""));
      for (const f of fields) {
        indexedFields.add(`${currentModel}.${f}`);
      }
    }

    // Track @unique on individual fields
    if (trimmed.includes("@unique")) {
      const fieldName = trimmed.split(/\s+/)[0];
      if (fieldName) indexedFields.add(`${currentModel}.${fieldName}`);
    }

    // Track @id fields (implicitly indexed)
    if (trimmed.includes("@id")) {
      const fieldName = trimmed.split(/\s+/)[0];
      if (fieldName) indexedFields.add(`${currentModel}.${fieldName}`);
    }

    // Check for enum usage — field Type @default(ENUM_VALUE)
    const enumUsageMatch = trimmed.match(/^\w+\s+(\w+)\s+@default\((\w+)\)/);
    if (enumUsageMatch) {
      const typeName = enumUsageMatch[1];
      if (
        typeName[0] === typeName[0].toUpperCase() &&
        !["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"].includes(typeName)
      ) {
        if (!definedEnums.has(typeName) && !definedModels.has(typeName)) {
          // Will check at the end after all parsing is done
        }
      }
    }
  }

  // Check 1: Missing inverse relations
  // For each named relation, there should be a matching relation on the target model
  const relationPairs = new Map<string, { sources: typeof relations; targets: typeof relations }>();

  for (const rel of relations) {
    if (!rel.relationName) continue;
    const key = rel.relationName;
    if (!relationPairs.has(key)) {
      relationPairs.set(key, { sources: [], targets: [] });
    }
    relationPairs.get(key)!.sources.push(rel);
  }

  for (const [name, pair] of relationPairs) {
    if (pair.sources.length === 1) {
      // Only one side of the relation is defined
      const rel = pair.sources[0];
      // Check if the target model has ANY relation back to the source
      const hasInverse = relations.some(
        (r) =>
          r.sourceModel === rel.targetModel &&
          r.targetModel === rel.sourceModel &&
          r.relationName === rel.relationName
      );
      if (!hasInverse) {
        issues.push({
          severity: "error",
          line: rel.line,
          message: `Missing inverse relation: ${rel.sourceModel}.@relation("${name}") references ${rel.targetModel}, but ${rel.targetModel} has no matching @relation("${name}") field pointing back to ${rel.sourceModel}.`,
          fix: `Add to model ${rel.targetModel}: ${rel.sourceModel.toLowerCase()}s ${rel.sourceModel}[] @relation("${name}")`,
        });
      }
    }
  }

  // Check 2: Referenced types that aren't defined
  const allReferencedTypes = new Set<string>();
  for (const rel of relations) {
    allReferencedTypes.add(rel.targetModel);
  }
  for (const typeName of allReferencedTypes) {
    if (!definedModels.has(typeName) && !definedEnums.has(typeName)) {
      const refs = relations.filter((r) => r.targetModel === typeName);
      issues.push({
        severity: "error",
        line: refs[0]?.line ?? 0,
        message: `Undefined type: "${typeName}" is referenced but never defined as a model or enum.`,
        fix: `Add "model ${typeName} { ... }" or "enum ${typeName} { ... }" to the schema.`,
      });
    }
  }

  // Check 3: Foreign key fields without indexes (warning)
  for (const fk of fkFields) {
    if (!indexedFields.has(`${fk.model}.${fk.field}`)) {
      issues.push({
        severity: "warning",
        line: fk.line,
        message: `Foreign key "${fk.field}" in ${fk.model} has no index. Queries filtering by this field will be slow.`,
        fix: `Add @@index([${fk.field}]) to model ${fk.model}.`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const valid = errorCount === 0;

  let summary: string;
  if (valid && warningCount === 0) {
    summary = "Schema validation passed. No issues found.";
  } else if (valid) {
    summary = `Schema validation passed with ${warningCount} warning(s).`;
  } else {
    summary = `Schema validation FAILED: ${errorCount} error(s), ${warningCount} warning(s). Fix errors before running migrations.`;
  }

  return { valid, issues, summary };
}

/**
 * Format validation result for display in AI Coworker chat.
 */
export function formatSchemaValidation(result: SchemaValidationResult): string {
  if (result.valid && result.issues.length === 0) {
    return "Schema validation passed.";
  }

  const lines = [result.summary, ""];

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "ERROR" : "WARNING";
    lines.push(`[${icon}] Line ${issue.line}: ${issue.message}`);
    lines.push(`  Fix: ${issue.fix}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Model Description (Data Architect) ─────────────────────────────────────

export interface ModelField {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  isRelation: boolean;
  attributes: string[];
}

export interface ModelDescription {
  name: string;
  fields: ModelField[];
  indexes: string[];
  startLine: number;
  endLine: number;
}

/**
 * Extract a specific model's full description from a Prisma schema.
 * Returns all fields with types, optionality, relations, and attributes.
 * Used by the data architect to answer "what fields does X have?"
 */
export function describeModel(schemaContent: string, modelName: string): ModelDescription | null {
  const lines = schemaContent.split("\n");
  let inModel = false;
  let startLine = 0;
  let braceDepth = 0;
  const fields: ModelField[] = [];
  const indexes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!inModel) {
      const match = trimmed.match(new RegExp(`^model\\s+${modelName}\\s*\\{`));
      if (match) {
        inModel = true;
        startLine = i + 1;
        braceDepth = 1;
        continue;
      }
      continue;
    }

    // Track braces
    if (trimmed.includes("{")) braceDepth++;
    if (trimmed.includes("}")) braceDepth--;
    if (braceDepth === 0) {
      return { name: modelName, fields, indexes, startLine, endLine: i + 1 };
    }

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("//")) continue;

    // Index directives
    if (trimmed.startsWith("@@index") || trimmed.startsWith("@@unique") || trimmed.startsWith("@@id")) {
      indexes.push(trimmed);
      continue;
    }

    // Field: name Type? @attributes
    const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)/);
    if (fieldMatch) {
      const [, name, type, isArray, isOptional, rest] = fieldMatch;
      const isScalar = ["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"].includes(type);
      const attributes = rest ? rest.split(/\s+/).filter((a: string) => a.startsWith("@")) : [];

      fields.push({
        name: name,
        type: type + (isArray ?? "") + (isOptional ?? ""),
        isOptional: !!isOptional,
        isArray: !!isArray,
        isRelation: !isScalar,
        attributes,
      });
    }
  }

  return null; // Model not found
}

/**
 * Format model description for AI consumption — concise, actionable.
 */
export function formatModelDescription(desc: ModelDescription): string {
  const lines = [`model ${desc.name} (lines ${desc.startLine}-${desc.endLine})`, ""];

  const scalarFields = desc.fields.filter((f) => !f.isRelation);
  const relationFields = desc.fields.filter((f) => f.isRelation);

  if (scalarFields.length > 0) {
    lines.push("Fields:");
    for (const f of scalarFields) {
      lines.push(`  ${f.name}: ${f.type}${f.attributes.length > 0 ? " " + f.attributes.join(" ") : ""}`);
    }
  }

  if (relationFields.length > 0) {
    lines.push("", "Relations:");
    for (const f of relationFields) {
      lines.push(`  ${f.name}: ${f.type}${f.attributes.length > 0 ? " " + f.attributes.join(" ") : ""}`);
    }
  }

  if (desc.indexes.length > 0) {
    lines.push("", "Indexes:");
    for (const idx of desc.indexes) {
      lines.push(`  ${idx}`);
    }
  }

  return lines.join("\n");
}
