"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  IT4IT_VALUE_STREAM_SET,
  TRACE_RELATIONSHIP_SET,
  TRACE_TARGET_TYPE_SET,
  type TraceTargetType,
} from "@/lib/business-capabilities/types";

async function requireManageEaModel() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_ea_model")) {
    throw new Error("Unauthorized");
  }
}

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function readOptionalString(formData: FormData, key: string): string | null {
  const value = readString(formData, key);
  return value.length > 0 ? value : null;
}

function readNumber(formData: FormData, key: string, fallback: number): number {
  const value = Number(readString(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function assertMaturity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Maturity must be 1 through 5");
  }
  return value;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function nextCapabilityId(): string {
  return `BC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function readValueStreams(formData: FormData): string[] {
  const streams = formData
    .getAll("it4itValueStreams")
    .map((value) => String(value).trim())
    .filter(Boolean);

  for (const stream of streams) {
    if (!IT4IT_VALUE_STREAM_SET.has(stream)) {
      throw new Error(`Invalid IT4IT value stream: ${stream}`);
    }
  }

  return [...new Set(streams)];
}

export async function createBusinessCapabilityFromForm(formData: FormData) {
  await requireManageEaModel();

  const name = readString(formData, "name");
  if (!name) throw new Error("Capability name is required");

  const level = readNumber(formData, "level", 1);
  if (![1, 2, 3].includes(level)) throw new Error("Capability level must be 1, 2, or 3");

  const parentId = readOptionalString(formData, "parentId");
  if (level > 1 && !parentId) throw new Error("L2 and L3 capabilities require a parent");
  if (level === 1 && parentId) throw new Error("L1 capabilities cannot have a parent");

  if (parentId) {
    const parent = await prisma.businessCapability.findUnique({
      where: { id: parentId },
      select: { level: true },
    });
    if (!parent) throw new Error("Parent capability not found");
    if (parent.level !== level - 1) {
      throw new Error("Capability parent must be exactly one level above the new capability");
    }
  }

  const currentMaturity = assertMaturity(readNumber(formData, "currentMaturity", 1));
  const targetMaturity = assertMaturity(readNumber(formData, "targetMaturity", 3));

  await prisma.businessCapability.create({
    data: {
      capabilityId: nextCapabilityId(),
      name,
      slug: slugify(name),
      description: readOptionalString(formData, "description"),
      level,
      parentId,
      sortOrder: readNumber(formData, "sortOrder", 0),
      currentMaturity,
      targetMaturity,
      maturityRationale: readOptionalString(formData, "maturityRationale"),
      it4itValueStreams: readValueStreams(formData),
    },
  });

  revalidatePath("/portfolio/architecture");
}

export async function updateBusinessCapabilityMaturityFromForm(formData: FormData) {
  await requireManageEaModel();

  const id = readString(formData, "capabilityRowId");
  if (!id) throw new Error("Capability is required");

  await prisma.businessCapability.update({
    where: { id },
    data: {
      currentMaturity: assertMaturity(readNumber(formData, "currentMaturity", 1)),
      targetMaturity: assertMaturity(readNumber(formData, "targetMaturity", 3)),
      maturityRationale: readOptionalString(formData, "maturityRationale"),
    },
  });

  revalidatePath("/portfolio/architecture");
}

async function resolveTraceTarget(targetType: TraceTargetType, targetId: string) {
  if (targetType === "taxonomy_node") {
    const target = await prisma.taxonomyNode.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new Error("Taxonomy node not found");
    return { taxonomyNodeId: target.id };
  }

  if (targetType === "digital_product") {
    const target = await prisma.digitalProduct.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new Error("Digital product not found");
    return { digitalProductId: target.id };
  }

  if (targetType === "backlog_item") {
    const target = await prisma.backlogItem.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new Error("Backlog item not found");
    return { backlogItemId: target.id };
  }

  const target = await prisma.eaElement.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw new Error("Architecture element not found");
  return { eaElementId: target.id };
}

export async function createBusinessCapabilityTraceLinkFromForm(formData: FormData) {
  await requireManageEaModel();

  const capabilityId = readString(formData, "capabilityRowId");
  const targetRef = readString(formData, "targetRef");
  const relationship = readString(formData, "relationship") || "supports";

  if (!capabilityId) throw new Error("Capability is required");
  if (!targetRef.includes(":")) throw new Error("Trace target is required");
  if (!TRACE_RELATIONSHIP_SET.has(relationship)) throw new Error("Invalid trace relationship");

  const [targetTypeRaw, targetId] = targetRef.split(":", 2);
  const targetType = targetTypeRaw as TraceTargetType;
  if (!TRACE_TARGET_TYPE_SET.has(targetType) || !targetId) {
    throw new Error("Invalid trace target");
  }

  const targetFields = await resolveTraceTarget(targetType, targetId);

  await prisma.businessCapabilityTraceLink.upsert({
    where: {
      capabilityId_targetType_targetId_relationship: {
        capabilityId,
        targetType,
        targetId,
        relationship,
      },
    },
    update: {
      note: readOptionalString(formData, "note"),
      ...targetFields,
    },
    create: {
      capabilityId,
      targetType,
      targetId,
      relationship,
      note: readOptionalString(formData, "note"),
      ...targetFields,
    },
  });

  revalidatePath("/portfolio/architecture");
}
