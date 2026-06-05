import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { redactFingerprintEvidence } from "./discovery-fingerprint-redaction";
import {
  evaluateFingerprintRule,
  type FingerprintMatchExpression,
  type FingerprintRuleInput,
  type FingerprintRuleObservation,
} from "./discovery-fingerprint-rules";
import type { RedactionStatus } from "./discovery-fingerprint-types";

type CatalogManifest = {
  catalogKey: string;
  version: string;
  schemaVersion: string;
  rules: string[];
};

type CatalogFixture = FingerprintRuleObservation & {
  name?: string;
  expectedRedactionStatus?: RedactionStatus;
};

/** A fixture may be referenced by path or inlined directly in the rule file. */
type FixtureRef = string | CatalogFixture;

type CatalogRuleFile = FingerprintRuleInput & {
  status?: string;
  scope?: string;
  resolvedIdentity?: unknown;
  taxonomy?: {
    path?: string;
    deprecated?: boolean;
  };
  /** Placement target: the semantic taxonomy nodeId string (resolved to a cuid at load). */
  taxonomyNodeId?: string;
  identityConfidence?: number;
  taxonomyConfidence?: number;
  positiveFixtures?: FixtureRef[];
  negativeFixtures?: FixtureRef[];
};

/** A rule file holds either one rule object or an array of rules. */
type CatalogRuleFileContent = CatalogRuleFile | CatalogRuleFile[];

export type FingerprintCatalogValidationResult = {
  valid: boolean;
  errors: string[];
};

export async function validateFingerprintCatalog(catalogPath: string): Promise<FingerprintCatalogValidationResult> {
  const errors: string[] = [];
  const resolvedCatalogPath = await resolveInputPath(catalogPath);
  const manifest = await readJson<CatalogManifest>(resolvedCatalogPath);
  const catalogDir = path.dirname(resolvedCatalogPath);
  const seenRuleKeys = new Set<string>();

  if (!manifest.catalogKey || !manifest.version || !manifest.schemaVersion) {
    errors.push("catalog_manifest_missing_required_fields");
  }

  for (const ruleRef of manifest.rules ?? []) {
    const rulePath = path.join(catalogDir, ruleRef);
    const content = await readJson<CatalogRuleFileContent>(rulePath);
    const rules = Array.isArray(content) ? content : [content];

    for (const rule of rules) {
      if (seenRuleKeys.has(rule.ruleKey)) {
        errors.push(`duplicate_rule_key:${rule.ruleKey}`);
        continue;
      }
      seenRuleKeys.add(rule.ruleKey);

      validateRuleShape(rule, ruleRef, errors);
      await validateRuleFixtures(rule, catalogDir, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateRuleShape(rule: CatalogRuleFile, ruleRef: string, errors: string[]): void {
  if (!rule.ruleKey) {
    errors.push(`rule_missing_key:${ruleRef}`);
  }
  if (!Array.isArray(rule.requiredEvidenceFamilies) || rule.requiredEvidenceFamilies.length === 0) {
    errors.push(`rule_missing_required_evidence:${rule.ruleKey}`);
  }
  if (!isMatchExpression(rule.matchExpression)) {
    errors.push(`rule_invalid_match_expression:${rule.ruleKey}`);
  }
  if (!rule.resolvedIdentity) {
    errors.push(`rule_missing_resolved_identity:${rule.ruleKey}`);
  }
  if (rule.taxonomy?.deprecated) {
    errors.push(`deprecated_taxonomy_reference:${rule.ruleKey}`);
  }
}

async function validateRuleFixtures(rule: CatalogRuleFile, catalogDir: string, errors: string[]): Promise<void> {
  const positiveFixtures = rule.positiveFixtures ?? [];
  const negativeFixtures = rule.negativeFixtures ?? [];

  if (positiveFixtures.length === 0) {
    errors.push(`rule_missing_positive_fixture:${rule.ruleKey}`);
  }

  for (const fixtureRef of positiveFixtures) {
    const fixture = await readFixture(catalogDir, fixtureRef);
    const label = fixtureLabel(fixtureRef, fixture);
    const redaction = redactFingerprintEvidence(fixture.normalizedEvidence);
    if (redaction.status === "blocked_sensitive") {
      errors.push(`positive_fixture_blocked_sensitive:${rule.ruleKey}:${label}`);
    }

    const result = evaluateFingerprintRule(rule, fixture);
    if (!result.matched) {
      errors.push(`positive_fixture_not_matched:${rule.ruleKey}:${label}`);
    }
  }

  for (const fixtureRef of negativeFixtures) {
    const fixture = await readFixture(catalogDir, fixtureRef);
    const label = fixtureLabel(fixtureRef, fixture);
    const result = evaluateFingerprintRule(rule, fixture);
    if (result.matched) {
      errors.push(`negative_fixture_matched:${rule.ruleKey}:${label}`);
    }

    const redaction = redactFingerprintEvidence(fixture.normalizedEvidence);
    if (fixture.expectedRedactionStatus && redaction.status !== fixture.expectedRedactionStatus) {
      errors.push(`negative_fixture_redaction_mismatch:${rule.ruleKey}:${label}`);
    }
  }
}

function fixtureLabel(fixtureRef: FixtureRef, fixture: CatalogFixture): string {
  return typeof fixtureRef === "string" ? fixtureRef : fixture.name ?? "inline-fixture";
}

async function readFixture(catalogDir: string, fixtureRef: FixtureRef): Promise<CatalogFixture> {
  if (typeof fixtureRef === "string") {
    return readJson<CatalogFixture>(path.join(catalogDir, fixtureRef));
  }
  // Inline fixture — used directly.
  return fixtureRef;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function resolveInputPath(inputPath: string): Promise<string> {
  const candidates = [
    path.resolve(inputPath),
    path.resolve(process.cwd(), inputPath),
    path.resolve(process.cwd(), "..", "..", inputPath),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep looking through package-root and repo-root candidates.
    }
  }

  return candidates[0];
}

function isMatchExpression(value: unknown): value is FingerprintMatchExpression {
  if (!value || typeof value !== "object") {
    return false;
  }

  const expression = value as Partial<Record<"all" | "any", unknown>>;
  return Array.isArray(expression.all) || Array.isArray(expression.any);
}
