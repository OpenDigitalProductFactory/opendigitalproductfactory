import { join } from "path";
import { readFileSync } from "fs";
import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";
import {
  normalizePriorityClass,
  slugifyReferenceModelName,
} from "./reference-model-import.js";
import { readWorkbook, requireSheetData, sheetDataToObjects } from "./excel-sheet-reader.js";
import type {
  FunctionalCriteriaRow,
  ParticipationMatrixRow,
  ValueStreamActivityRow,
} from "./reference-model-types.js";

// __dirname is packages/db/src at runtime (tsx) — three levels up is repo root (/app in container).
// The prior four-level climb landed at / and made the IT4IT workbook unfindable on every install.
const REPO_ROOT = process.env.DPF_DATA_ROOT ?? join(__dirname, "..", "..", "..");
const REFERENCE_ROOT = join(REPO_ROOT, "docs", "Reference");
const IT4IT_WORKBOOK_PATH = join(REFERENCE_ROOT, "IT4IT_Functional_Criteria_Taxonomy.xlsx");

function slugifyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildElementSlug(kind: string, ...parts: string[]): string {
  return [kind, ...parts.map(slugifyPart)].filter(Boolean).join("__");
}

async function loadIt4itWorkbook() {
  const workbook = await readWorkbook(IT4IT_WORKBOOK_PATH);

  const functionalRows = sheetDataToObjects(requireSheetData(workbook, "IT4IT Functional Criteria"));
  const valueStreamRows = sheetDataToObjects(requireSheetData(workbook, "Value Stream Activities"));
  const participationRows = sheetDataToObjects(requireSheetData(workbook, "FC Participation Matrix"));

  return {
    functionalRows: functionalRows.map<FunctionalCriteriaRow>((row) => ({
      capabilityGroup: String(row["Level 1: Capability Group"] ?? "").trim(),
      functionName: String(row["Level 2: Function"] ?? "").trim(),
      componentName: String(row["Level 3: Functional Component"] ?? "").trim(),
      criteria: String(row["Functional Criteria"] ?? "").trim(),
      referenceSection: row["Reference Section"] == null ? null : String(row["Reference Section"]).trim(),
    })),
    valueStreamRows: valueStreamRows.map<ValueStreamActivityRow>((row) => ({
      valueStream: String(row["Value Stream"] ?? "").trim(),
      valueStreamStage: String(row["Value Stream Stage"] ?? "").trim(),
      criteria: String(row["Activity Criteria"] ?? "").trim(),
      referenceSection: row["Reference Section"] == null ? null : String(row["Reference Section"]).trim(),
    })),
    participationRows: participationRows.map<ParticipationMatrixRow>((row) => {
      const participationByColumn: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "Value Stream" || key === "Value Stream Stage" || key === "Ref") continue;
        participationByColumn[key] = value == null ? null : String(value).trim();
      }

      return {
        valueStream: String(row["Value Stream"] ?? "").trim(),
        valueStreamStage: String(row["Value Stream Stage"] ?? "").trim(),
        reference: row["Ref"] == null ? null : String(row["Ref"]).trim(),
        participationByColumn,
      };
    }),
  };
}

async function upsertElement(args: {
  modelId: string;
  kind: string;
  slug: string;
  name: string;
  parentId?: string | null;
  code?: string | null;
  description?: string | null;
  normativeClass?: string | null;
  sourceReference?: string | null;
  properties?: Record<string, unknown>;
}): Promise<string> {
  const record = await prisma.eaReferenceModelElement.upsert({
    where: { modelId_slug: { modelId: args.modelId, slug: args.slug } },
    update: {
      parentId: args.parentId ?? null,
      kind: args.kind,
      name: args.name,
      code: args.code ?? null,
      description: args.description ?? null,
      normativeClass: args.normativeClass ?? null,
      sourceReference: args.sourceReference ?? null,
      properties: (args.properties ?? {}) as Prisma.InputJsonValue,
    },
    create: {
      modelId: args.modelId,
      parentId: args.parentId ?? null,
      kind: args.kind,
      slug: args.slug,
      name: args.name,
      code: args.code ?? null,
      description: args.description ?? null,
      normativeClass: args.normativeClass ?? null,
      sourceReference: args.sourceReference ?? null,
      properties: (args.properties ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return record.id;
}

interface BianServiceDomain {
  name: string;
  description?: string;
  semanticApi: boolean;
}

interface BianBusinessDomain {
  name: string;
  description?: string;
  serviceDomains: BianServiceDomain[];
}

interface BianBusinessArea {
  name: string;
  businessDomains: BianBusinessDomain[];
}

interface BianServiceLandscape {
  standard: string;
  version: string;
  businessAreas: BianBusinessArea[];
}

// Maps BIAN Service Domain name (as it appears in bian-v14-service-landscape.json) to the
// DPF capability key from BIAN_BANKING_V14 (business-capability-perspectives.ts). Only
// service domains in the DPF standard banking perspective are listed. Two names diverge
// from the perspective label: "Term Deposit Framework Agreement" vs "Term Deposit", and
// "Customer Case Management" vs "Customer Case" — verified against the JSON hierarchy.
const BIAN_SD_TO_CAPABILITY_KEY: Readonly<Record<string, string>> = {
  "Current Account": "bian-current-account",
  "Savings Account": "bian-savings-account",
  "Term Deposit Framework Agreement": "bian-term-deposit",
  "Consumer Loan": "bian-consumer-loan",
  "Mortgage Loan": "bian-mortgage-loan",
  "Corporate Loan": "bian-corporate-loan",
  "Underwriting": "bian-underwriting",
  "Payment Order Initiation": "bian-payment-order-initiation",
  "Credit Card": "bian-credit-card",
  "Customer Relationship Management": "bian-customer-relationship-management",
  "Customer Credit Rating": "bian-customer-credit-rating",
  "Customer Behavior Insights": "bian-customer-behavior-insights",
  "Customer Case Management": "bian-customer-case",
  "Servicing Order": "bian-servicing-order",
  "Customer Offer": "bian-customer-offer",
  "Lead and Opportunity Management": "bian-lead-opportunity-management",
  "Party Lifecycle Management": "bian-party-lifecycle-management",
  "Party Reference Data Directory": "bian-party-reference-data-directory",
  "Position Keeping": "bian-position-keeping",
  "Customer Position": "bian-customer-position",
  "Account Reconciliation": "bian-account-reconciliation",
  "Regulatory Compliance": "bian-regulatory-compliance",
  "Guideline Compliance": "bian-guideline-compliance",
  "Regulatory Reporting": "bian-regulatory-reporting",
  "Credit Management": "bian-credit-management",
  "Fraud Resolution": "bian-fraud-resolution",
};

/**
 * Which archetypes an industry-specific reference model serves.
 *
 * Entries may be archetype CATEGORY slugs (`banking-financial-services`) or
 * specific archetype ids (`credit-union`), matching either — the same contract
 * `RegulationApplicability.archetypes` already uses, so an operator reads one
 * rule for "is this vertical content mine?", not two.
 *
 * An empty/absent list means universal: IT4IT describes IT management for any
 * organisation that runs IT, which is every install.
 */
const REFERENCE_MODEL_ARCHETYPES: Readonly<Record<string, readonly string[]>> = {
  bian_service_landscape_v14_0_0: ["banking-financial-services"],
};

/** The install's declared archetype, as category slug + specific archetype id. */
interface InstallArchetype {
  category: string | null;
  archetypeId: string | null;
}

/**
 * Read the install's setup-chosen archetype. `StorefrontConfig.archetypeId` is a
 * cuid FK, not a slug, so the join to StorefrontArchetype is required to reach
 * the category/id slugs the applicability lists are written in.
 *
 * Returns nulls when setup has not run yet. That is treated as "not applicable"
 * below rather than "applicable": seeding a banking hierarchy onto an install
 * that has not said it is a bank is the defect being fixed. The seed is
 * idempotent and runs on every boot and upgrade, so an install that later
 * declares banking imports the hierarchy on its next seed.
 */
async function resolveInstallArchetype(): Promise<InstallArchetype> {
  const config = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true },
  });
  if (!config) return { category: null, archetypeId: null };
  const archetype = await prisma.storefrontArchetype.findUnique({
    where: { id: config.archetypeId },
    select: { archetypeId: true, category: true },
  });
  return {
    category: archetype?.category ?? null,
    archetypeId: archetype?.archetypeId ?? null,
  };
}

/**
 * Does this install need the element hierarchy for `modelSlug`?
 *
 * Universal models (no declared archetypes) always apply. An industry model
 * applies only when the install's category or archetype id is in its list.
 */
export function referenceModelAppliesToInstall(
  modelSlug: string,
  install: InstallArchetype,
  archetypesBySlug: Readonly<Record<string, readonly string[]>> = REFERENCE_MODEL_ARCHETYPES,
): boolean {
  const archetypes = archetypesBySlug[modelSlug];
  if (!archetypes || archetypes.length === 0) return true;
  return archetypes.some(
    (a) => a === install.category || a === install.archetypeId,
  );
}

async function seedBianReferenceModel(modelId: string): Promise<void> {
  const BIAN_JSON_PATH = join(REFERENCE_ROOT, "bian", "bian-v14-service-landscape.json");

  let landscape: BianServiceLandscape;
  try {
    landscape = JSON.parse(readFileSync(BIAN_JSON_PATH, "utf-8")) as BianServiceLandscape;
  } catch {
    console.warn("[seed] BIAN JSON not found at", BIAN_JSON_PATH, "— skipping BIAN element hierarchy");
    return;
  }

  for (const area of landscape.businessAreas) {
    const areaId = await upsertElement({
      modelId,
      kind: "business_area",
      slug: buildElementSlug("business_area", area.name),
      name: area.name,
    });

    for (const domain of area.businessDomains) {
      const domainId = await upsertElement({
        modelId,
        parentId: areaId,
        kind: "business_domain",
        slug: buildElementSlug("business_domain", area.name, domain.name),
        name: domain.name,
        description: domain.description ?? null,
      });

      for (const sd of domain.serviceDomains) {
        const dpfCapabilityKey = BIAN_SD_TO_CAPABILITY_KEY[sd.name] ?? null;
        await upsertElement({
          modelId,
          parentId: domainId,
          kind: "service_domain",
          slug: buildElementSlug("service_domain", area.name, domain.name, sd.name),
          name: sd.name,
          description: sd.description ?? null,
          properties: {
            semanticApi: sd.semanticApi,
            ...(dpfCapabilityKey ? { dpfCapabilityKey } : {}),
          },
        });
      }
    }
  }
}

export async function seedEaReferenceModels(): Promise<void> {
  const portfolios = await prisma.portfolio.findMany({
    select: { slug: true, name: true, description: true },
    orderBy: { slug: "asc" },
  });

  for (const portfolio of portfolios) {
    await prisma.eaAssessmentScope.upsert({
      where: {
        scopeType_scopeRef: {
          scopeType: "portfolio",
          scopeRef: portfolio.slug,
        },
      },
      update: {
        name: portfolio.name,
        description: portfolio.description ?? null,
        status: "active",
      },
      create: {
        scopeType: "portfolio",
        scopeRef: portfolio.slug,
        name: portfolio.name,
        description: portfolio.description ?? null,
        status: "active",
      },
    });
  }

  // ── IT4IT v3.0.1 ─────────────────────────────────────────────────────────
  const modelSlug = slugifyReferenceModelName("IT4IT", "3.0.1");
  const model = await prisma.eaReferenceModel.upsert({
    where: { slug: modelSlug },
    update: {
      name: "IT4IT",
      version: "3.0.1",
      authorityType: "standard",
      status: "active",
      description: "The Open Group IT4IT reference model imported from the local criteria workbook and supporting artifacts.",
      sourceSummary: "Functional criteria, value stream activities, and participation matrix from the checked-in IT4IT reference materials.",
    },
    create: {
      slug: modelSlug,
      name: "IT4IT",
      version: "3.0.1",
      authorityType: "standard",
      status: "active",
      description: "The Open Group IT4IT reference model imported from the local criteria workbook and supporting artifacts.",
      sourceSummary: "Functional criteria, value stream activities, and participation matrix from the checked-in IT4IT reference materials.",
    },
    select: { id: true },
  });

  const artifactPaths = [
    { path: "docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx", kind: "xlsx", authority: "authoritative" },
    { path: "docs/Reference/digital_product_portfolio_mgmt.txt", kind: "txt", authority: "supporting" },
    { path: "docs/Reference/shift_to_digital_product.txt", kind: "txt", authority: "supporting" },
  ] as const;

  for (const artifact of artifactPaths) {
    await prisma.eaReferenceModelArtifact.upsert({
      where: { modelId_path: { modelId: model.id, path: artifact.path } },
      update: {
        kind: artifact.kind,
        authority: artifact.authority,
        importedAt: new Date(),
      },
      create: {
        modelId: model.id,
        kind: artifact.kind,
        path: artifact.path,
        authority: artifact.authority,
        importedAt: new Date(),
      },
    });
  }

  const { functionalRows, valueStreamRows, participationRows } = await loadIt4itWorkbook();

  const domainIds = new Map<string, string>();
  const functionIds = new Map<string, string>();
  const componentIds = new Map<string, string>();
  const valueStreamIds = new Map<string, string>();
  const valueStreamStageIds = new Map<string, string>();

  for (const row of functionalRows) {
    if (!row.capabilityGroup || !row.functionName || !row.componentName || !row.criteria) continue;

    const domainKey = row.capabilityGroup;
    let domainId = domainIds.get(domainKey);
    if (!domainId) {
      domainId = await upsertElement({
        modelId: model.id,
        kind: "capability_group",
        slug: buildElementSlug("capability_group", row.capabilityGroup),
        name: row.capabilityGroup,
      });
      domainIds.set(domainKey, domainId);
    }

    const functionKey = `${row.capabilityGroup}::${row.functionName}`;
    let functionId = functionIds.get(functionKey);
    if (!functionId) {
      functionId = await upsertElement({
        modelId: model.id,
        parentId: domainId,
        kind: "function",
        slug: buildElementSlug("function", row.capabilityGroup, row.functionName),
        name: row.functionName,
      });
      functionIds.set(functionKey, functionId);
    }

    const componentKey = `${functionKey}::${row.componentName}`;
    let componentId = componentIds.get(componentKey);
    if (!componentId) {
      componentId = await upsertElement({
        modelId: model.id,
        parentId: functionId,
        kind: "component",
        slug: buildElementSlug("component", row.capabilityGroup, row.functionName, row.componentName),
        name: row.componentName,
      });
      componentIds.set(componentKey, componentId);
    }

    await upsertElement({
      modelId: model.id,
      parentId: componentId,
      kind: "criterion",
      slug: buildElementSlug("criterion", row.capabilityGroup, row.functionName, row.componentName, row.criteria),
      name: row.criteria,
      normativeClass: normalizePriorityClass(row.criteria),
      sourceReference: row.referenceSection,
    });
  }

  for (const row of valueStreamRows) {
    if (!row.valueStream || !row.valueStreamStage || !row.criteria) continue;

    let valueStreamId = valueStreamIds.get(row.valueStream);
    if (!valueStreamId) {
      valueStreamId = await upsertElement({
        modelId: model.id,
        kind: "value_stream",
        slug: buildElementSlug("value_stream", row.valueStream),
        name: row.valueStream,
      });
      valueStreamIds.set(row.valueStream, valueStreamId);
    }

    const stageKey = `${row.valueStream}::${row.valueStreamStage}`;
    let stageId = valueStreamStageIds.get(stageKey);
    if (!stageId) {
      const participation = participationRows.find(
        (entry) => entry.valueStream === row.valueStream && entry.valueStreamStage === row.valueStreamStage
      );

      stageId = await upsertElement({
        modelId: model.id,
        parentId: valueStreamId,
        kind: "value_stream_stage",
        slug: buildElementSlug("value_stream_stage", row.valueStream, row.valueStreamStage),
        name: row.valueStreamStage,
        sourceReference: row.referenceSection,
        properties: participation
          ? {
              participationReference: participation.reference,
              participationByColumn: participation.participationByColumn,
            }
          : {},
      });
      valueStreamStageIds.set(stageKey, stageId);
    }

    await upsertElement({
      modelId: model.id,
      parentId: stageId,
      kind: "criterion",
      slug: buildElementSlug("criterion", row.valueStream, row.valueStreamStage, row.criteria),
      name: row.criteria,
      normativeClass: normalizePriorityClass(row.criteria),
      sourceReference: row.referenceSection,
    });
  }

  // ── BIAN Service Landscape v14.0.0 ────────────────────────────────────────
  const bianSlug = slugifyReferenceModelName("BIAN Service Landscape", "14.0.0");
  const bianModel = await prisma.eaReferenceModel.upsert({
    where: { slug: bianSlug },
    update: {
      name: "BIAN Service Landscape",
      version: "14.0.0",
      authorityType: "standard",
      status: "active",
      primaryIndustry: "banking-financial-services",
      description:
        "Banking Industry Architecture Network (BIAN) Service Landscape v14.0 — 8 Business Areas, 43 Business Domains, 341 Service Domains. Value Chain View (canonical; Matrix layout is deprecated). 258 of 341 Service Domains have published Semantic APIs.",
      sourceSummary:
        "Hierarchy extracted from the BIAN Value Chain View and stored in docs/Reference/bian/bian-v14-service-landscape.json. Source: bian.org/servicelandscape-14-0-0.",
    },
    create: {
      slug: bianSlug,
      name: "BIAN Service Landscape",
      version: "14.0.0",
      authorityType: "standard",
      status: "active",
      primaryIndustry: "banking-financial-services",
      description:
        "Banking Industry Architecture Network (BIAN) Service Landscape v14.0 — 8 Business Areas, 43 Business Domains, 341 Service Domains. Value Chain View (canonical; Matrix layout is deprecated). 258 of 341 Service Domains have published Semantic APIs.",
      sourceSummary:
        "Hierarchy extracted from the BIAN Value Chain View and stored in docs/Reference/bian/bian-v14-service-landscape.json. Source: bian.org/servicelandscape-14-0-0.",
    },
    select: { id: true },
  });

  await prisma.eaReferenceModelArtifact.upsert({
    where: {
      modelId_path: {
        modelId: bianModel.id,
        path: "docs/Reference/bian/bian-v14-service-landscape.json",
      },
    },
    update: { kind: "json", authority: "authoritative", importedAt: new Date() },
    create: {
      modelId: bianModel.id,
      kind: "json",
      path: "docs/Reference/bian/bian-v14-service-landscape.json",
      authority: "authoritative",
      importedAt: new Date(),
    },
  });

  await prisma.eaReferenceModelArtifact.upsert({
    where: {
      modelId_path: {
        modelId: bianModel.id,
        path: "docs/Reference/bian/README.md",
      },
    },
    update: { kind: "md", authority: "supporting", importedAt: new Date() },
    create: {
      modelId: bianModel.id,
      kind: "md",
      path: "docs/Reference/bian/README.md",
      authority: "supporting",
      importedAt: new Date(),
    },
  });

  // The MODEL ROW above is catalogue and is always upserted — it carries
  // primaryIndustry, so a non-banking install can still see that BIAN exists
  // and what it is for. That mirrors seed-banking-compliance.ts, which seeds
  // banking regulations everywhere and scopes them at consumption.
  //
  // The ELEMENT HIERARCHY is different: it is ~390 rows of banking-specific
  // structure that a software-platform, dry-cleaning or field-service install
  // has no use for, and — until now — a zero count for it FAILED the seed on
  // every one of those installs. Import it only where it applies.
  const install = await resolveInstallArchetype();
  const bianApplies = referenceModelAppliesToInstall(bianSlug, install);
  if (bianApplies) {
    await seedBianReferenceModel(bianModel.id);
  }

  // BI-98D19DF2: a workbook/JSON read that silently yields zero rows (e.g. an
  // LFS pointer stub masquerading as the real .xlsx, or a schema change that
  // empties every extracted row) must fail loudly here rather than let the
  // seed report success while a fresh install imports nothing. Row-count
  // assertion, not just absence of a thrown error.
  //
  // BI-DDB48B04 follow-on: assert only over models this install actually
  // needs. The original assertion demanded a non-zero BIAN count from every
  // install, so on any non-banking install the eaReferenceModels step threw
  // and — because seed steps are caught and logged, not fatal (seed.ts
  // `step()`) — failed silently on every boot and every upgrade. That is the
  // same "seed reports success while importing nothing" shape this assertion
  // was written to prevent, inverted: an assertion asserting the wrong thing
  // is as blind as no assertion at all.
  const it4itElementCount = await prisma.eaReferenceModelElement.count({
    where: { modelId: model.id },
  });
  if (it4itElementCount === 0) {
    throw new Error(
      `IT4IT reference model imported zero elements from ${IT4IT_WORKBOOK_PATH} — the workbook read did not throw but produced no rows (check for an LFS pointer stub or an empty/relabelled sheet).`
    );
  }

  if (bianApplies) {
    const bianElementCount = await prisma.eaReferenceModelElement.count({
      where: { modelId: bianModel.id },
    });
    if (bianElementCount === 0) {
      throw new Error(
        "BIAN Service Landscape reference model imported zero elements — the JSON read did not throw but produced no business areas/domains/service domains (check docs/Reference/bian/bian-v14-service-landscape.json)."
      );
    }
  }
}
