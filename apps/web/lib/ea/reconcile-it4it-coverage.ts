// apps/web/lib/ea/reconcile-it4it-coverage.ts
//
// Steward shell for the IT4IT coverage projection (Parity Engine). Runtime-safe: reads the
// seeded IT4IT reference model + live evidence (agents, business capabilities), calls the
// pure builder, and upserts an evidence-derived coverage baseline into EaReferenceAssessment
// on a platform scope. Re-derives every run, so the baseline cannot drift. Verified
// operator/coworker rows are preserved (no-clobber). db injected for tests.
//
// Activates the previously dormant scoring path: EaReferenceAssessment had no create path in
// the codebase (only a manual .update), so the table was empty in production. This is the
// create/upsert path. No schema change — provenance uses the confidence + rationale-prefix
// convention from the pure builder (spec section 1).
//
// Spec: docs/superpowers/specs/2026-06-24-it4it-conformance-coverage-heatmap-design.md (sections 1, 4).

import { prisma, type Prisma } from "@dpf/db";
import type { SysmlSeedResult } from "./sysml-model-seed";
import {
  buildIt4itCoverageModel,
  type It4itCoverageFacts,
  type It4itElementFact,
} from "./it4it-coverage-extract";

const IT4IT_MODEL_SLUG = "it4it_v3_0_1";
const PLATFORM_SCOPE_TYPE = "platform";
const PLATFORM_SCOPE_REF = "dpf";
const GAP_ISSUE_TYPE = "it4it-coverage-gap";
const HYGIENE_ISSUE_TYPE = "it4it-evidence-hygiene";

// Trace-link target types that count as built/operational evidence (vs a planned backlog item).
const BUILT_TARGET_TYPES = new Set(["digitalProduct", "eaElement"]);

type Db = typeof prisma;

export async function reconcileIt4itCoverage(opts: { db?: Db } = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;

  const model = await db.eaReferenceModel.findUnique({
    where: { slug: IT4IT_MODEL_SLUG },
    select: { id: true },
  });
  if (!model) {
    console.warn(`[it4it-coverage] IT4IT reference model "${IT4IT_MODEL_SLUG}" not seeded - skipping`);
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  // Ensure the platform assessment scope exists (the four portfolio scopes are seeded
  // separately; platform is the headline "is the platform conformant" reading).
  const scope = await db.eaAssessmentScope.upsert({
    where: { scopeType_scopeRef: { scopeType: PLATFORM_SCOPE_TYPE, scopeRef: PLATFORM_SCOPE_REF } },
    create: {
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeRef: PLATFORM_SCOPE_REF,
      name: "DPF Platform",
      description: "Platform-wide IT4IT coverage baseline (evidence-derived).",
    },
    update: {},
    select: { id: true },
  });

  const [elements, agents, capabilities, existing] = await Promise.all([
    db.eaReferenceModelElement.findMany({
      where: { modelId: model.id },
      select: {
        id: true,
        kind: true,
        slug: true,
        name: true,
        parentId: true,
        normativeClass: true,
        sourceReference: true,
      },
    }),
    db.agent.findMany({
      where: { archived: false },
      select: { valueStream: true, it4itSections: true },
    }),
    db.businessCapability.findMany({
      select: { it4itValueStreams: true, traceLinks: { select: { targetType: true } } },
    }),
    db.eaReferenceAssessment.findMany({
      where: { scopeId: scope.id, modelId: model.id },
      select: { modelElementId: true, coverageStatus: true, confidence: true, rationale: true },
    }),
  ]);

  const facts: It4itCoverageFacts = {
    elements: elements as It4itElementFact[],
    agents: agents.map((a) => ({ valueStream: a.valueStream, it4itSections: a.it4itSections })),
    capabilities: capabilities.map((c) => ({
      it4itValueStreams: c.it4itValueStreams,
      hasBuiltTraceLink: c.traceLinks.some((t) => BUILT_TARGET_TYPES.has(t.targetType)),
    })),
    existingAssessments: existing.map((e) => ({
      modelElementId: e.modelElementId,
      coverageStatus: e.coverageStatus,
      confidence: e.confidence,
      rationale: e.rationale,
    })),
  };

  const coverage = buildIt4itCoverageModel(facts);

  const existingIds = new Set(existing.map((e) => e.modelElementId));
  let created = 0;
  let updated = 0;
  for (const row of coverage.writePlan) {
    await db.eaReferenceAssessment.upsert({
      where: { scopeId_modelElementId: { scopeId: scope.id, modelElementId: row.modelElementId } },
      create: {
        scopeId: scope.id,
        modelId: model.id,
        modelElementId: row.modelElementId,
        coverageStatus: row.coverageStatus,
        confidence: row.confidence,
        rationale: row.rationale,
        evidenceSummary: row.evidenceSummary,
        mvpIncluded: true,
      },
      update: {
        coverageStatus: row.coverageStatus,
        confidence: row.confidence,
        rationale: row.rationale,
        evidenceSummary: row.evidenceSummary,
      },
    });
    if (existingIds.has(row.modelElementId)) updated += 1;
    else created += 1;
  }

  await reconcileConformanceIssues(db, coverage.gaps, coverage.hygiene);

  const status: SysmlSeedResult["status"] = created + updated > 0 ? "applied" : "noop";
  console.info(
    `[it4it-coverage] reconcile ${status}: created=${created} updated=${updated} preserved=${coverage.preservedVerified} ` +
      `platformScore=${coverage.platformScore}% componentsWithEvidence=${coverage.summary.componentsWithEvidence}/${coverage.summary.componentsTotal} gaps=${coverage.gaps.length}`,
  );
  return { status, created, updated, removed: 0 };
}

// Idempotently reconcile the it4it coverage-gap + evidence-hygiene conformance findings.
// EaConformanceIssue has no unique key and cannot FK to a reference-model element, so we
// match on a stable detailsJson.key and resolve issues that no longer apply.
async function reconcileConformanceIssues(
  db: Db,
  gaps: ReturnType<typeof buildIt4itCoverageModel>["gaps"],
  hygiene: ReturnType<typeof buildIt4itCoverageModel>["hygiene"],
): Promise<void> {
  type Desired = {
    key: string;
    issueType: string;
    severity: string;
    message: string;
    detailsJson: Record<string, unknown>;
  };

  const desired: Desired[] = gaps.map((g) => ({
    key: `gap:${g.componentSlug}`,
    issueType: GAP_ISSUE_TYPE,
    severity: "warn",
    message: `IT4IT coverage gap: no evidence for functional component "${g.componentName}" (${g.capabilityGroup ?? "n/a"}); ${g.requiredCriteriaCount} required criteria uncovered.`,
    detailsJson: {
      key: `gap:${g.componentSlug}`,
      componentSlug: g.componentSlug,
      componentName: g.componentName,
      capabilityGroup: g.capabilityGroup,
      requiredCriteriaCount: g.requiredCriteriaCount,
    },
  }));

  const hygieneTotal = hygiene.unknownStreamAgents + hygiene.nullStreamAgents + hygiene.legacyStreamAgents;
  if (hygieneTotal > 0) {
    desired.push({
      key: "hygiene:agent-value-stream",
      issueType: HYGIENE_ISSUE_TYPE,
      severity: "info",
      message: `IT4IT evidence hygiene: ${hygiene.legacyStreamAgents} legacy, ${hygiene.unknownStreamAgents} unknown, and ${hygiene.nullStreamAgents} unset agent value-stream labels weaken coverage attribution.`,
      detailsJson: { key: "hygiene:agent-value-stream", ...hygiene },
    });
  }

  const open = await db.eaConformanceIssue.findMany({
    where: { issueType: { in: [GAP_ISSUE_TYPE, HYGIENE_ISSUE_TYPE] }, status: "open" },
    select: { id: true, detailsJson: true },
  });
  const openByKey = new Map<string, string>();
  for (const issue of open) {
    const key = (issue.detailsJson as { key?: string } | null)?.key;
    if (key) openByKey.set(key, issue.id);
  }

  const desiredKeys = new Set(desired.map((d) => d.key));

  for (const d of desired) {
    const existingId = openByKey.get(d.key);
    if (existingId) {
      await db.eaConformanceIssue.update({
        where: { id: existingId },
        data: { severity: d.severity, message: d.message, detailsJson: d.detailsJson as Prisma.InputJsonObject },
      });
    } else {
      await db.eaConformanceIssue.create({
        data: {
          issueType: d.issueType,
          severity: d.severity,
          message: d.message,
          status: "open",
          detailsJson: d.detailsJson as Prisma.InputJsonObject,
        },
      });
    }
  }

  // Resolve issues that are open but no longer desired (gap closed / hygiene cleared).
  for (const [key, id] of openByKey) {
    if (!desiredKeys.has(key)) {
      await db.eaConformanceIssue.update({ where: { id }, data: { status: "resolved" } });
    }
  }
}
