import { join } from "path";
import { readFile, utils } from "xlsx";
import { prisma } from "./client.js";
import type { Prisma } from "../generated/client/client";
import {
  normalizePriorityClass,
  slugifyReferenceModelName,
} from "./reference-model-import.js";
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

function requireSheet(
  sheets: Record<string, unknown>,
  name: string,
): unknown {
  const sheet = sheets[name];
  if (!sheet) throw new Error(`Missing worksheet: ${name}`);
  return sheet;
}

function loadIt4itWorkbook() {
  const workbook = readFile(IT4IT_WORKBOOK_PATH);

  const functionalRows = utils.sheet_to_json(
    requireSheet(workbook.Sheets, "IT4IT Functional Criteria") as Parameters<typeof utils.sheet_to_json>[0]
  ) as Array<Record<string, unknown>>;
  const valueStreamRows = utils.sheet_to_json(
    requireSheet(workbook.Sheets, "Value Stream Activities") as Parameters<typeof utils.sheet_to_json>[0]
  ) as Array<Record<string, unknown>>;
  const participationRows = utils.sheet_to_json(
    requireSheet(workbook.Sheets, "FC Participation Matrix") as Parameters<typeof utils.sheet_to_json>[0]
  ) as Array<Record<string, unknown>>;

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
    { path: "docs/Reference/IT4IT v3.0.1.pdf", kind: "pdf", authority: "authoritative" },
    { path: "docs/Reference/IT4IT v3.0.1.docx", kind: "docx", authority: "authoritative" },
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

  const { functionalRows, valueStreamRows, participationRows } = loadIt4itWorkbook();

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
}
