import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getAuthorityBinding } from "@/lib/authority/bindings";
import { createAuthorityBinding } from "@/lib/authority/binding-editor";
import {
  buildDraftAuthorityBindingFromWarning,
  type BootstrapAuthorityBindingWarning,
} from "@/lib/authority/bootstrap-bindings";
import { createAuthorizationDecisionLog } from "@/lib/governance-data";
import { can } from "@/lib/permissions";

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

function isBootstrapWarning(value: unknown): value is BootstrapAuthorityBindingWarning {
  return !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).resourceRef === "string" &&
    (typeof (value as Record<string, unknown>).agentId === "string" || (value as Record<string, unknown>).agentId === null) &&
    (value as Record<string, unknown>).reason !== undefined;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireEditor();
  if (denied) {
    return denied;
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isBootstrapWarning(payload.draftFromWarning)) {
    return NextResponse.json({ error: "Unsupported authority binding create payload" }, { status: 400 });
  }

  try {
    const draft = await buildDraftAuthorityBindingFromWarning(payload.draftFromWarning);
    const existing = await getAuthorityBinding(draft.bindingId);
    if (existing) {
      return NextResponse.json({ bindingId: draft.bindingId, created: false });
    }

    await createAuthorityBinding(draft);
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: session.user.id ?? session.user.email ?? "unknown",
      humanContextRef: session.user.id ?? null,
      authorityBindingRef: draft.bindingId,
      actionKey: "authority_binding.create",
      objectRef: draft.bindingId,
      routeContext: draft.resourceRef,
      decision: "allow",
      rationale: {
        code: "binding_draft_created_from_bootstrap_warning",
        reason: payload.draftFromWarning.reason,
      },
    });

    return NextResponse.json({ bindingId: draft.bindingId, created: true });
  } catch (error) {
    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: session.user.id ?? session.user.email ?? "unknown",
      humanContextRef: session.user.id ?? null,
      actionKey: "authority_binding.create",
      objectRef:
        typeof payload.draftFromWarning === "object" && payload.draftFromWarning && "resourceRef" in payload.draftFromWarning
          ? String((payload.draftFromWarning as Record<string, unknown>).resourceRef)
          : "bootstrap-warning",
      decision: "deny",
      rationale: {
        code: "binding_draft_create_rejected",
        error: error instanceof Error ? error.message : "unknown",
      },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create authority binding draft" },
      { status: 400 },
    );
  }
}
