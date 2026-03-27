"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function requireManageBusinessModels(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_business_models")) {
    throw new Error("Unauthorized");
  }
}

async function requireViewPortfolio(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_portfolio")) {
    throw new Error("Unauthorized");
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type RoleAssignmentSlot = {
  id: string;
  roleId: string;
  name: string;
  authorityDomain: string | null;
  it4itAlignment: string | null;
  hitlTierDefault: number;
  escalatesTo: string | null;
  isBuiltIn: boolean;
  status: string;
  assignments: {
    id: string;
    userId: string;
    productId: string;
    assignedAt: Date;
    revokedAt: Date | null;
    user: { id: string; email: string };
  }[];
};

export type ProductBusinessModelResult = {
  id: string;
  assignedAt: Date;
  businessModel: {
    id: string;
    modelId: string;
    name: string;
    description: string | null;
    isBuiltIn: boolean;
    status: string;
    roles: RoleAssignmentSlot[];
  };
};

// ─── BI-BIZ-ROLES-004: Business model ↔ product assignment ───────────────────

/** Assign a business model to a digital product. */
export async function assignBusinessModelToProduct(
  productId: string,
  businessModelId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const [model, existing] = await Promise.all([
    prisma.businessModel.findUnique({ where: { id: businessModelId }, select: { id: true, status: true } }),
    prisma.productBusinessModel.findUnique({ where: { productId_businessModelId: { productId, businessModelId } } }),
  ]);

  if (!model) return { ok: false, error: "Business model not found" };
  if (model.status !== "active") return { ok: false, error: "Business model is not active" };
  if (existing) return { ok: false, error: "Business model already assigned to this product" };

  await prisma.productBusinessModel.create({
    data: { productId, businessModelId },
  });

  revalidatePath("/portfolio");
  revalidatePath(`/inventory`);
  return { ok: true };
}

/** Remove a business model assignment from a product (cascades role assignments). */
export async function removeBusinessModelFromProduct(
  productId: string,
  businessModelId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const existing = await prisma.productBusinessModel.findUnique({
    where: { productId_businessModelId: { productId, businessModelId } },
  });
  if (!existing) return { ok: false, error: "Business model not assigned to this product" };

  await prisma.productBusinessModel.delete({
    where: { productId_businessModelId: { productId, businessModelId } },
  });

  revalidatePath("/portfolio");
  revalidatePath(`/inventory`);
  return { ok: true };
}

/** Get all business models assigned to a product, with roles and current assignments. */
export async function getProductBusinessModels(
  productId: string,
): Promise<ProductBusinessModelResult[]> {
  await requireViewPortfolio();

  const rows = await prisma.productBusinessModel.findMany({
    where: { productId },
    include: {
      businessModel: {
        include: {
          roles: {
            where: { status: "active" },
            include: {
              assignments: {
                where: { productId, revokedAt: null },
                include: { user: { select: { id: true, email: true } } },
              },
            },
            orderBy: { roleId: "asc" },
          },
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });

  return rows as ProductBusinessModelResult[];
}

/** List all active business models (for selector dropdowns). */
export async function listBusinessModels(): Promise<{
  id: string;
  modelId: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  status: string;
  _count: { roles: number };
}[]> {
  return prisma.businessModel.findMany({
    where: { status: "active" },
    include: { _count: { select: { roles: true } } },
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  });
}

// ─── BI-BIZ-ROLES-005: User ↔ business model role assignment ─────────────────

/** Assign a user to a business model role on a product. */
export async function assignUserToBusinessModelRole(
  userId: string,
  businessModelRoleId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  // Verify the role's business model is assigned to this product
  const role = await prisma.businessModelRole.findUnique({
    where: { id: businessModelRoleId },
    select: { id: true, status: true, businessModelId: true },
  });
  if (!role) return { ok: false, error: "Business model role not found" };
  if (role.status !== "active") return { ok: false, error: "Business model role is not active" };

  const linked = await prisma.productBusinessModel.findUnique({
    where: { productId_businessModelId: { productId, businessModelId: role.businessModelId } },
  });
  if (!linked) return { ok: false, error: "Business model is not assigned to this product" };

  const existing = await prisma.businessModelRoleAssignment.findFirst({
    where: { userId, businessModelRoleId, productId, revokedAt: null },
  });
  if (existing) return { ok: false, error: "User is already assigned to this role" };

  await prisma.businessModelRoleAssignment.create({
    data: { userId, businessModelRoleId, productId },
  });

  revalidatePath("/portfolio");
  return { ok: true };
}

/** Soft-revoke a user's business model role assignment (sets revokedAt). */
export async function revokeUserFromBusinessModelRole(
  userId: string,
  businessModelRoleId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const existing = await prisma.businessModelRoleAssignment.findFirst({
    where: { userId, businessModelRoleId, productId, revokedAt: null },
  });
  if (!existing) return { ok: false, error: "No active assignment found for this user and role" };

  await prisma.businessModelRoleAssignment.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  revalidatePath("/portfolio");
  return { ok: true };
}

/** All role assignments for a product (grouped by business model). */
export async function getProductRoleAssignments(productId: string): Promise<{
  businessModelId: string;
  businessModelName: string;
  assignments: {
    id: string;
    userId: string;
    userEmail: string;
    roleId: string;
    roleName: string;
    assignedAt: Date;
    revokedAt: Date | null;
  }[];
}[]> {
  await requireViewPortfolio();

  const rows = await prisma.businessModelRoleAssignment.findMany({
    where: { productId },
    include: {
      user: { select: { id: true, email: true } },
      businessModelRole: {
        select: { roleId: true, name: true, businessModelId: true, businessModel: { select: { id: true, name: true } } },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  // Group by business model
  const grouped = new Map<string, (typeof rows[number])[]>();
  for (const row of rows) {
    const bmId = row.businessModelRole.businessModelId;
    if (!grouped.has(bmId)) grouped.set(bmId, []);
    grouped.get(bmId)!.push(row);
  }

  return Array.from(grouped.entries()).map(([bmId, assignments]) => ({
    businessModelId: bmId,
    businessModelName: assignments[0]!.businessModelRole.businessModel.name,
    assignments: assignments.map((a) => ({
      id: a.id,
      userId: a.userId,
      userEmail: a.user.email,
      roleId: a.businessModelRole.roleId,
      roleName: a.businessModelRole.name,
      assignedAt: a.assignedAt,
      revokedAt: a.revokedAt,
    })),
  }));
}

/** All business model role assignments for a user across products. */
export async function getUserBusinessModelRoles(userId: string): Promise<{
  id: string;
  productId: string;
  roleId: string;
  roleName: string;
  businessModelName: string;
  assignedAt: Date;
  revokedAt: Date | null;
}[]> {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");

  const rows = await prisma.businessModelRoleAssignment.findMany({
    where: { userId },
    include: {
      businessModelRole: {
        select: { roleId: true, name: true, businessModel: { select: { name: true } } },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    roleId: r.businessModelRole.roleId,
    roleName: r.businessModelRole.name,
    businessModelName: r.businessModelRole.businessModel.name,
    assignedAt: r.assignedAt,
    revokedAt: r.revokedAt,
  }));
}

// ─── BI-BIZ-ROLES-006: Custom business model CRUD ────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Create a custom business model (isBuiltIn: false). */
export async function createCustomBusinessModel(
  name: string,
  description: string | null,
  roles: { name: string; authorityDomain?: string; escalatesTo?: string; hitlTierDefault?: number }[],
): Promise<{ ok: boolean; error?: string; id?: string; modelId?: string }> {
  await requireManageBusinessModels();

  if (!name.trim()) return { ok: false, error: "Name is required" };
  if (roles.length === 0) return { ok: false, error: "At least one role is required" };
  if (roles.length > 20) return { ok: false, error: "Maximum 20 roles per business model" };

  const modelId = `bm-custom-${slugify(name.trim())}`;

  // Check for duplicate modelId
  const existing = await prisma.businessModel.findUnique({ where: { modelId } });
  if (existing) return { ok: false, error: `A business model with this name already exists (${modelId})` };

  const model = await prisma.businessModel.create({
    data: {
      modelId,
      name: name.trim(),
      description: description?.trim() ?? null,
      isBuiltIn: false,
      status: "active",
      roles: {
        create: roles.map((r, i) => ({
          roleId: `BMR-CUST-${String(i + 1).padStart(3, "0")}-${Date.now()}`,
          name: r.name.trim(),
          authorityDomain: r.authorityDomain?.trim() ?? null,
          escalatesTo: r.escalatesTo ?? "HR-200",
          hitlTierDefault: r.hitlTierDefault ?? 2,
          isBuiltIn: false,
          status: "active",
        })),
      },
    },
    select: { id: true, modelId: true },
  });

  revalidatePath("/admin/business-models");
  return { ok: true, id: model.id, modelId: model.modelId };
}

/** Update name/description of a custom (non-built-in) business model. */
export async function updateCustomBusinessModel(
  modelId: string,
  name: string,
  description: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const model = await prisma.businessModel.findUnique({ where: { modelId }, select: { id: true, isBuiltIn: true } });
  if (!model) return { ok: false, error: "Business model not found" };
  if (model.isBuiltIn) return { ok: false, error: "Built-in business models cannot be edited" };

  await prisma.businessModel.update({
    where: { modelId },
    data: { name: name.trim(), description: description?.trim() ?? null },
  });

  revalidatePath("/admin/business-models");
  return { ok: true };
}

/** Add a role to an existing custom business model. */
export async function addRoleToBusinessModel(
  businessModelId: string,
  name: string,
  authorityDomain: string | null,
  escalatesTo: string,
  hitlTierDefault = 2,
): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const model = await prisma.businessModel.findUnique({
    where: { id: businessModelId },
    select: { id: true, isBuiltIn: true },
  });
  if (!model) return { ok: false, error: "Business model not found" };
  if (model.isBuiltIn) return { ok: false, error: "Cannot add roles to built-in business models" };

  const roleCount = await prisma.businessModelRole.count({ where: { businessModelId } });
  if (roleCount >= 20) return { ok: false, error: "Maximum 20 roles per business model" };

  await prisma.businessModelRole.create({
    data: {
      roleId: `BMR-CUST-${Date.now()}`,
      name: name.trim(),
      authorityDomain: authorityDomain?.trim() ?? null,
      escalatesTo,
      hitlTierDefault,
      isBuiltIn: false,
      status: "active",
      businessModelId,
    },
  });

  revalidatePath("/admin/business-models");
  return { ok: true };
}

/** Remove a role from a custom business model (blocked if active assignments exist). */
export async function removeRoleFromBusinessModel(roleId: string): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const role = await prisma.businessModelRole.findUnique({
    where: { roleId },
    select: { id: true, isBuiltIn: true },
  });
  if (!role) return { ok: false, error: "Role not found" };
  if (role.isBuiltIn) return { ok: false, error: "Cannot remove built-in roles" };

  const activeCount = await prisma.businessModelRoleAssignment.count({
    where: { businessModelRoleId: role.id, revokedAt: null },
  });
  if (activeCount > 0) return { ok: false, error: `Cannot remove a role with active assignment(s)` };

  await prisma.businessModelRole.delete({ where: { roleId } });

  revalidatePath("/admin/business-models");
  return { ok: true };
}

/** Clone a business model (built-in or custom) into a new custom variant. */
export async function cloneBusinessModel(
  sourceModelId: string,
  newName: string,
): Promise<{ ok: boolean; error?: string; id?: string; modelId?: string }> {
  await requireManageBusinessModels();

  const source = await prisma.businessModel.findUnique({
    where: { modelId: sourceModelId },
    include: { roles: { where: { status: "active" } } },
  });
  if (!source) return { ok: false, error: "Source business model not found" };

  const newModelId = `bm-custom-${slugify(newName.trim())}`;
  const existing = await prisma.businessModel.findUnique({ where: { modelId: newModelId } });
  if (existing) return { ok: false, error: `A business model with this name already exists (${newModelId})` };

  const cloned = await prisma.businessModel.create({
    data: {
      modelId: newModelId,
      name: newName.trim(),
      description: source.description,
      isBuiltIn: false,
      status: "active",
      roles: {
        create: source.roles.map((r, i) => ({
          roleId: `BMR-CUST-${String(i + 1).padStart(3, "0")}-${Date.now()}`,
          name: r.name,
          authorityDomain: r.authorityDomain,
          it4itAlignment: r.it4itAlignment,
          escalatesTo: r.escalatesTo,
          hitlTierDefault: r.hitlTierDefault,
          isBuiltIn: false,
          status: "active",
        })),
      },
    },
    select: { id: true, modelId: true },
  });

  revalidatePath("/admin/business-models");
  return { ok: true, id: cloned.id, modelId: cloned.modelId };
}

/** Deprecate a business model (no new assignments; existing remain valid). */
export async function deprecateBusinessModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const model = await prisma.businessModel.findUnique({ where: { modelId }, select: { id: true, isBuiltIn: true } });
  if (!model) return { ok: false, error: "Business model not found" };
  if (model.isBuiltIn) return { ok: false, error: "Built-in business models cannot be deprecated" };

  await prisma.businessModel.update({ where: { modelId }, data: { status: "deprecated" } });

  revalidatePath("/admin/business-models");
  return { ok: true };
}

/** Retire a business model (only allowed when no active assignments remain). */
export async function retireBusinessModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
  await requireManageBusinessModels();

  const model = await prisma.businessModel.findUnique({
    where: { modelId },
    select: { id: true, isBuiltIn: true },
  });
  if (!model) return { ok: false, error: "Business model not found" };
  if (model.isBuiltIn) return { ok: false, error: "Built-in business models cannot be retired" };

  const activeAssignments = await prisma.businessModelRoleAssignment.count({
    where: { businessModelRole: { businessModelId: model.id }, revokedAt: null },
  });
  if (activeAssignments > 0) return { ok: false, error: `Cannot retire: ${activeAssignments} active assignment(s) exist` };

  await prisma.businessModel.update({ where: { modelId }, data: { status: "retired" } });

  revalidatePath("/admin/business-models");
  return { ok: true };
}
