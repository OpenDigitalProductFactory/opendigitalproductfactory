// packages/db/src/ea-validation.ts
// Validation functions for EA model writes.
// All functions read from Postgres meta-model; never write.

import { prisma } from "./client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export type DqViolation = {
  ruleId: string;
  name: string;
  description: string | null;
  severity: "error" | "warn";
};

// ─── Level 1: Relationship validity ──────────────────────────────────────────

/** Check that (fromElementType, toElementType, relationshipType) is a permitted combination
 *  per EaRelationshipRule. Called before createEaRelationship. */
export async function validateEaRelationship(
  fromElementId: string,
  toElementId: string,
  relationshipTypeId: string,
): Promise<ValidationResult> {
  const [from, to] = await Promise.all([
    prisma.eaElement.findUnique({ where: { id: fromElementId }, select: { elementTypeId: true } }),
    prisma.eaElement.findUnique({ where: { id: toElementId },   select: { elementTypeId: true } }),
  ]);

  if (!from) return { valid: false, reason: `Source element "${fromElementId}" not found` };
  if (!to)   return { valid: false, reason: `Target element "${toElementId}" not found` };

  const rule = await prisma.eaRelationshipRule.findFirst({
    where: {
      fromElementTypeId:  from.elementTypeId,
      toElementTypeId:    to.elementTypeId,
      relationshipTypeId,
    },
  });

  if (!rule) {
    return { valid: false, reason: "Relationship type not permitted between these element types by the notation rules" };
  }
  return { valid: true };
}

// ─── Level 2: Lifecycle validity ─────────────────────────────────────────────

/** Check that lifecycleStage and lifecycleStatus are in the element type's valid sets.
 *  Called before createEaElement and updateEaElement when stage/status changes. */
export async function validateEaLifecycle(
  elementTypeId: string,
  lifecycleStage: string,
  lifecycleStatus: string,
): Promise<ValidationResult> {
  const et = await prisma.eaElementType.findUnique({
    where: { id: elementTypeId },
    select: { name: true, validLifecycleStages: true, validLifecycleStatuses: true },
  });

  if (!et) return { valid: false, reason: `Element type "${elementTypeId}" not found` };

  if (!et.validLifecycleStages.includes(lifecycleStage)) {
    return { valid: false, reason: `Stage "${lifecycleStage}" is not valid for element type "${et.name}". Valid stages: ${et.validLifecycleStages.join(", ")}` };
  }
  if (!et.validLifecycleStatuses.includes(lifecycleStatus)) {
    return { valid: false, reason: `Status "${lifecycleStatus}" is not valid for element type "${et.name}". Valid statuses: ${et.validLifecycleStatuses.join(", ")}` };
  }
  return { valid: true };
}

// ─── Level 3: DQ rule check ──────────────────────────────────────────────────

/** Evaluate all DQ rules for the given element advancing to targetStage.
 *  Returns a list of violations — callers decide whether to block (errors) or warn. */
export async function checkEaDqRules(
  elementId: string,
  targetStage: string,
): Promise<DqViolation[]> {
  const element = await prisma.eaElement.findUnique({
    where: { id: elementId },
    select: {
      id: true,
      elementTypeId: true,
      lifecycleStage: true,
      digitalProductId: true,
      elementType: { select: { notationId: true } },
    },
  });
  if (!element) return [];

  const rules = await prisma.eaDqRule.findMany({
    where: {
      notationId:    element.elementType.notationId,
      lifecycleStage: targetStage,
      OR: [
        { elementTypeId: null },
        { elementTypeId: element.elementTypeId },
      ],
    },
  });

  const violations: DqViolation[] = [];
  for (const rule of rules) {
    const satisfied = await evaluateDqRule(element, rule.rule as Record<string, unknown>);
    if (!satisfied) {
      violations.push({
        ruleId:      rule.id,
        name:        rule.name,
        description: rule.description,
        severity:    rule.severity === "warn" ? "warn" : "error",
      });
    }
  }
  return violations;
}

// ─── DSL evaluator ────────────────────────────────────────────────────────────

type ElementContext = {
  id: string;
  elementTypeId: string;
  lifecycleStage: string;
  digitalProductId: string | null;
  elementType: { notationId: string };
};

async function evaluateDqRule(
  element: ElementContext,
  rule: Record<string, unknown>,
): Promise<boolean> {
  // { requires: { bridge: "digitalProductId" } }
  if ("requires" in rule && typeof rule["requires"] === "object" && rule["requires"] !== null) {
    const req = rule["requires"] as Record<string, unknown>;

    if (typeof req["bridge"] === "string") {
      if (req["bridge"] === "digitalProductId") return element.digitalProductId != null;
      return true; // unknown bridge field — pass by default (conservative, consistent with unknown-shape fallthrough)
    }

    // { requires: { relationshipType: "realizes", toElementType: "application_component", minCount: 1 } }
    if (typeof req["relationshipType"] === "string" && typeof req["toElementType"] === "string") {
      const minCount = typeof req["minCount"] === "number" ? req["minCount"] : 1;

      // Find the relationship type and element type by slug + notation
      const [relType, toElemType] = await Promise.all([
        prisma.eaRelationshipType.findFirst({
          where: { slug: req["relationshipType"] as string, notationId: element.elementType.notationId },
          select: { id: true },
        }),
        prisma.eaElementType.findFirst({
          where: { slug: req["toElementType"] as string, notationId: element.elementType.notationId },
          select: { id: true },
        }),
      ]);
      if (!relType || !toElemType) return false;

      const count = await prisma.eaRelationship.count({
        where: {
          fromElementId:      element.id,
          relationshipTypeId: relType.id,
          toElement: { elementTypeId: toElemType.id },
        },
      });
      return count >= minCount;
    }
  }

  // { warns: { duplicateBridge: { lifecycleStage: "design", maxCount: 1 } } }
  if ("warns" in rule && typeof rule["warns"] === "object" && rule["warns"] !== null) {
    const warn = rule["warns"] as Record<string, unknown>;

    if ("duplicateBridge" in warn && typeof warn["duplicateBridge"] === "object" && warn["duplicateBridge"] !== null) {
      const db = warn["duplicateBridge"] as Record<string, unknown>;
      const stage    = typeof db["lifecycleStage"] === "string" ? db["lifecycleStage"] : null;
      const maxCount = typeof db["maxCount"] === "number" ? db["maxCount"] : 1;
      if (!stage || element.digitalProductId == null) return true; // no bridge = no collision possible

      const count = await prisma.eaElement.count({
        where: {
          digitalProductId: element.digitalProductId,
          lifecycleStage:   stage,
          id: { not: element.id },
        },
      });
      return count < maxCount; // satisfied = no collision; violated = collision found
    }
  }

  return true; // unknown rule shape — pass by default (conservative)
}
