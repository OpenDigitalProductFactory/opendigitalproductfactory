import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAuthorityBinding, getAuthorityBindingEvidence } from "@/lib/authority/bindings";
import { updateAuthorityBinding } from "@/lib/authority/binding-editor";
import { createAuthorizationDecisionLog } from "@/lib/governance-data";
import { can } from "@/lib/permissions";

type RouteContext = {
  params: Promise<{
    bindingId: string;
  }>;
};

async function requireEditor() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  const denied = await requireEditor();
  if (denied) {
    return denied;
  }

  const { bindingId } = await context.params;
  const [binding, evidence] = await Promise.all([
    getAuthorityBinding(bindingId),
    getAuthorityBindingEvidence(bindingId),
  ]);

  if (!binding) {
    return NextResponse.json({ error: "Binding not found" }, { status: 404 });
  }

  return NextResponse.json({ binding, evidence });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireEditor();
  if (denied) {
    return denied;
  }

  const { bindingId } = await context.params;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await updateAuthorityBinding(bindingId, {
      name: typeof payload.name === "string" ? payload.name : undefined,
      scopeType: typeof payload.scopeType === "string" ? payload.scopeType : undefined,
      status: typeof payload.status === "string" ? payload.status : undefined,
      resourceType: typeof payload.resourceType === "string" ? payload.resourceType : undefined,
      resourceRef: typeof payload.resourceRef === "string" ? payload.resourceRef : undefined,
      approvalMode: typeof payload.approvalMode === "string" ? payload.approvalMode : undefined,
      sensitivityCeiling:
        typeof payload.sensitivityCeiling === "string" || payload.sensitivityCeiling === null
          ? (payload.sensitivityCeiling as string | null)
          : undefined,
      appliedAgentId:
        typeof payload.appliedAgentId === "string" || payload.appliedAgentId === null
          ? (payload.appliedAgentId as string | null)
          : undefined,
      subjects: Array.isArray(payload.subjects)
        ? payload.subjects
            .filter((subject): subject is Record<string, unknown> => !!subject && typeof subject === "object")
            .map((subject) => ({
              subjectType: String(subject.subjectType ?? ""),
              subjectRef: String(subject.subjectRef ?? ""),
              relation: String(subject.relation ?? ""),
            }))
        : undefined,
      grants: Array.isArray(payload.grants)
        ? payload.grants
            .filter((grant): grant is Record<string, unknown> => !!grant && typeof grant === "object")
            .map((grant) => ({
              grantKey: String(grant.grantKey ?? ""),
              mode: String(grant.mode ?? ""),
              rationale: typeof grant.rationale === "string" ? grant.rationale : null,
            }))
        : undefined,
    });
  } catch (error) {
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: session.user.id ?? session.user.email ?? "unknown",
      humanContextRef: session.user.id ?? null,
      authorityBindingRef: bindingId,
      actionKey: "authority_binding.update",
      objectRef: bindingId,
      decision: "deny",
      rationale: {
        code: "binding_update_rejected",
        error: error instanceof Error ? error.message : "unknown",
      },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update authority binding" },
      { status: 400 },
    );
  }

  const binding = await getAuthorityBinding(bindingId);

  if (!binding) {
    return NextResponse.json({ error: "Binding not found" }, { status: 404 });
  }

  await createAuthorizationDecisionLog({
    actorType: "user",
    actorRef: session.user.id ?? session.user.email ?? "unknown",
    humanContextRef: session.user.id ?? null,
    authorityBindingRef: bindingId,
    actionKey: "authority_binding.update",
    objectRef: bindingId,
    routeContext: binding.resourceRef,
    decision: "allow",
    rationale: {
      code: "binding_updated",
      approvalMode: binding.approvalMode,
      status: binding.status,
    },
  });

  const evidence = await getAuthorityBindingEvidence(bindingId);

  return NextResponse.json({ binding, evidence });
}
