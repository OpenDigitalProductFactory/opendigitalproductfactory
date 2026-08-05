// Policy lifecycle tool pack (BI-3CDEC5F0).
// Coworker-facing create/update of governed Policy rows as DRAFT for human review.
// Publish remains a human lifecycle action on /compliance/policies.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  generatePolicyId,
  POLICY_CATEGORIES,
  isValidTransition,
  validatePolicyInput,
} from "@/lib/govern/policy-types";

const definitions: ToolDefinition[] = [
  {
    name: "list_policies",
    description:
      "List company/compliance policies (draft through published). Use before creating a duplicate. Filter by category (e.g. hr) or lifecycleStatus.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: `Optional category: ${POLICY_CATEGORIES.join(", ")}.`,
        },
        lifecycleStatus: {
          type: "string",
          description: "Optional: draft | in-review | approved | published | retired.",
        },
        limit: { type: "number", description: "Max rows (default 30, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_policy",
    description:
      "Get one policy by human policyId (POL-…) or internal id, including body and lifecycle status.",
    inputSchema: {
      type: "object",
      properties: {
        policyId: {
          type: "string",
          description: "Policy id: POL-… or internal cuid.",
        },
      },
      required: ["policyId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "create_policy",
    description:
      // Provenance (BI-3CDEC5F0 P1: structured audience scoping) stays in this
      // comment — the model-facing description carries no backlog ids.
      "Create a company Policy as DRAFT for human review on /compliance/policies. Never publishes. Use category 'hr' for HR policies. After create, tell the operator the draft is ready for review/edit/publish in the Policies UI. For audience-limited publish (e.g. US employees only), note the intended audience in notes until structured audience fields ship.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Policy title." },
        category: {
          type: "string",
          description: `One of: ${POLICY_CATEGORIES.join(", ")}.`,
        },
        body: { type: "string", description: "Full policy markdown/text body." },
        description: { type: "string", description: "Short summary." },
        notes: {
          type: "string",
          description:
            "Internal notes, e.g. intended audience: US-based employees only.",
        },
        reviewFrequency: {
          type: "string",
          description: "annual | biennial | quarterly.",
        },
      },
      required: ["title", "category"],
    },
    requiredCapability: "manage_compliance",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "update_policy",
    description:
      "Update a draft or in-review policy body/title/metadata. Refuses published or retired policies (human must revise via lifecycle).",
    inputSchema: {
      type: "object",
      properties: {
        policyId: { type: "string", description: "POL-… or internal id." },
        title: { type: "string" },
        body: { type: "string" },
        description: { type: "string" },
        notes: { type: "string" },
        category: { type: "string" },
        reviewFrequency: { type: "string" },
      },
      required: ["policyId"],
    },
    requiredCapability: "manage_compliance",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "request_policy_review",
    description:
      "Move a draft policy to in-review so a human can approve and publish. Does not publish.",
    inputSchema: {
      type: "object",
      properties: {
        policyId: { type: "string", description: "POL-… or internal id." },
      },
      required: ["policyId"],
    },
    requiredCapability: "manage_compliance",
    executionMode: "immediate",
    sideEffect: true,
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
];

async function resolvePolicy(policyKey: string) {
  const { prisma } = await import("@dpf/db");
  const key = policyKey.trim();
  if (!key) return null;
  return prisma.policy.findFirst({
    where: {
      status: "active",
      OR: [{ policyId: key }, { id: key }],
    },
  });
}

async function listPoliciesHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const limit =
    typeof params["limit"] === "number"
      ? Math.min(100, Math.max(1, Math.floor(params["limit"])))
      : 30;
  const category =
    typeof params["category"] === "string" ? params["category"].trim() : undefined;
  const lifecycleStatus =
    typeof params["lifecycleStatus"] === "string"
      ? params["lifecycleStatus"].trim()
      : undefined;

  const rows = await prisma.policy.findMany({
    where: {
      status: "active",
      ...(category ? { category } : {}),
      ...(lifecycleStatus ? { lifecycleStatus } : {}),
    },
    select: {
      id: true,
      policyId: true,
      title: true,
      category: true,
      lifecycleStatus: true,
      version: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) {
    return {
      success: true,
      message: "No policies match.",
      data: { policies: [] },
    };
  }

  const summary = rows
    .map(
      (p) =>
        `${p.policyId} [${p.lifecycleStatus}] ${p.category}: ${p.title} (v${p.version})`,
    )
    .join("\n");

  return {
    success: true,
    message: `${rows.length} policy(ies):\n${summary}`,
    data: { policies: rows },
  };
}

async function getPolicyHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const policyId = String(params["policyId"] ?? "").trim();
  if (!policyId) {
    return {
      success: false,
      error: "invalid_params",
      message: "policyId is required.",
    };
  }
  const row = await resolvePolicy(policyId);
  if (!row) {
    return {
      success: false,
      error: "not_found",
      message: `No policy found for ${policyId}.`,
    };
  }
  return {
    success: true,
    entityId: row.policyId,
    message: `${row.policyId} [${row.lifecycleStatus}] ${row.title}`,
    data: {
      id: row.id,
      policyId: row.policyId,
      title: row.title,
      category: row.category,
      lifecycleStatus: row.lifecycleStatus,
      version: row.version,
      description: row.description,
      body: row.body,
      notes: row.notes,
      reviewFrequency: row.reviewFrequency,
      agentId: row.agentId,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      reviewUrl: `/compliance/policies/${row.id}`,
    },
  };
}

async function createPolicyHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const title = String(params["title"] ?? "").trim();
  const category = String(params["category"] ?? "").trim();
  const body =
    typeof params["body"] === "string" ? params["body"] : null;
  const description =
    typeof params["description"] === "string" ? params["description"] : null;
  const notes = typeof params["notes"] === "string" ? params["notes"] : null;
  const reviewFrequency =
    typeof params["reviewFrequency"] === "string"
      ? params["reviewFrequency"]
      : null;

  const err = validatePolicyInput({ title, category });
  if (err) {
    return { success: false, error: "invalid_params", message: err };
  }

  const policyId = generatePolicyId();
  const record = await prisma.policy.create({
    data: {
      policyId,
      title,
      category,
      body,
      description,
      notes,
      reviewFrequency,
      lifecycleStatus: "draft",
      agentId: context?.agentId ?? null,
    },
  });

  return {
    success: true,
    entityId: record.policyId,
    message:
      `Created draft policy ${record.policyId}: "${record.title}" (category=${record.category}). ` +
      `Human review/edit/publish: /compliance/policies/${record.id}. ` +
      `This is a DRAFT — not published. ` +
      (notes?.toLowerCase().includes("us")
        ? "Intended US audience is noted in notes; structured audience scoping is P1 (BI-3CDEC5F0)."
        : "Add intended audience in notes if not global (e.g. US-based employees only)."),
    data: {
      id: record.id,
      policyId: record.policyId,
      lifecycleStatus: record.lifecycleStatus,
      reviewUrl: `/compliance/policies/${record.id}`,
      createdByUserId: userId,
      agentId: context?.agentId ?? null,
    },
  };
}

async function updatePolicyHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const policyKey = String(params["policyId"] ?? "").trim();
  if (!policyKey) {
    return {
      success: false,
      error: "invalid_params",
      message: "policyId is required.",
    };
  }
  const existing = await resolvePolicy(policyKey);
  if (!existing) {
    return {
      success: false,
      error: "not_found",
      message: `No policy found for ${policyKey}.`,
    };
  }
  if (
    existing.lifecycleStatus !== "draft" &&
    existing.lifecycleStatus !== "in-review"
  ) {
    return {
      success: false,
      error: "invalid_state",
      message: `Cannot update policy in lifecycleStatus=${existing.lifecycleStatus}. Only draft or in-review may be edited by coworkers; published policies need human revision.`,
    };
  }

  if (params["category"] !== undefined) {
    const cat = String(params["category"]).trim();
    const err = validatePolicyInput({
      title: existing.title,
      category: cat,
    });
    if (err) {
      return { success: false, error: "invalid_params", message: err };
    }
  }

  const updated = await prisma.policy.update({
    where: { id: existing.id },
    data: {
      ...(params["title"] !== undefined && {
        title: String(params["title"]).trim(),
      }),
      ...(params["body"] !== undefined && { body: String(params["body"]) }),
      ...(params["description"] !== undefined && {
        description: String(params["description"]),
      }),
      ...(params["notes"] !== undefined && { notes: String(params["notes"]) }),
      ...(params["category"] !== undefined && {
        category: String(params["category"]).trim(),
      }),
      ...(params["reviewFrequency"] !== undefined && {
        reviewFrequency: String(params["reviewFrequency"]),
      }),
      ...(context?.agentId && !existing.agentId
        ? { agentId: context.agentId }
        : {}),
    },
  });

  return {
    success: true,
    entityId: updated.policyId,
    message: `Updated ${updated.policyId} [${updated.lifecycleStatus}]. Review: /compliance/policies/${updated.id}`,
    data: {
      id: updated.id,
      policyId: updated.policyId,
      lifecycleStatus: updated.lifecycleStatus,
      reviewUrl: `/compliance/policies/${updated.id}`,
    },
  };
}

async function requestPolicyReviewHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const policyKey = String(params["policyId"] ?? "").trim();
  if (!policyKey) {
    return {
      success: false,
      error: "invalid_params",
      message: "policyId is required.",
    };
  }
  const existing = await resolvePolicy(policyKey);
  if (!existing) {
    return {
      success: false,
      error: "not_found",
      message: `No policy found for ${policyKey}.`,
    };
  }
  if (!isValidTransition(existing.lifecycleStatus, "in-review")) {
    return {
      success: false,
      error: "invalid_state",
      message: `Cannot move ${existing.policyId} from ${existing.lifecycleStatus} to in-review.`,
    };
  }

  const updated = await prisma.policy.update({
    where: { id: existing.id },
    data: { lifecycleStatus: "in-review" },
  });

  return {
    success: true,
    entityId: updated.policyId,
    message:
      `${updated.policyId} is now in-review. A human can approve and publish at ` +
      `/compliance/policies/${updated.id}. Coworkers cannot publish.`,
    data: {
      id: updated.id,
      policyId: updated.policyId,
      lifecycleStatus: updated.lifecycleStatus,
      reviewUrl: `/compliance/policies/${updated.id}`,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_policies: (params) => listPoliciesHandler(params),
  get_policy: (params) => getPolicyHandler(params),
  create_policy: (params, userId, ctx) =>
    createPolicyHandler(params, userId, ctx),
  update_policy: (params, userId, ctx) =>
    updatePolicyHandler(params, userId, ctx),
  request_policy_review: (params) => requestPolicyReviewHandler(params),
};

export const policyPack: ToolPack = {
  packId: "policy",
  definitions,
  handlers,
  grants: {
    list_policies: ["policy_read"],
    get_policy: ["policy_read"],
    create_policy: ["policy_write"],
    update_policy: ["policy_write"],
    request_policy_review: ["policy_write"],
  },
};
