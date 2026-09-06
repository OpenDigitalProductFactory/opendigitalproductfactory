import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";
import type { DemandDispositionNoticeV1, DemandEnvelopeV1, DemandResponseV1 } from "@dpf/db/federated-demand-contract";
import {
  OPERATIONAL_POSTURE_ACTIVITIES,
  type OperationalPostureV1,
} from "@dpf/db/federated-operational-posture-contract";

import { resolveFederationLinkAuth } from "@/lib/auth/federation-link-token";
import { validateFederationCloudEvent } from "@/lib/federation/cloud-event-guard";
import { resolveFederationIdentity, type FederationIdentityDb } from "@/lib/federation/demand-identity";
import {
  handleIncomingDemand,
  type DemandExchangeDb,
  type InboundDemandActivity,
} from "@/lib/federation/demand-exchange";
import {
  handleIncomingDemandResponse,
  type DemandResponseDb,
} from "@/lib/federation/demand-response";
import { handleIncomingDemandDisposition } from "@/lib/federation/demand-disposition";
import { ok } from "@/lib/shared/action-result";
import {
  handleIncomingOperationalPosture,
  type OperationalPostureExchangeDb,
} from "@/lib/federation/operational-posture-exchange";

const ERROR_STATUS: Record<string, number> = {
  missing_authorization: 401,
  invalid_scheme: 401,
  invalid_token_format: 401,
  token_not_found: 401,
  link_not_trusted: 403,
};

const INBOUND_ACTIVITIES = new Set<InboundDemandActivity>([
  "dpf.demand.proposed",
  "dpf.demand.updated",
  "dpf.demand.withdrawn",
]);
const RESPONSE_ACTIVITIES = new Set([
  "dpf.demand.interest-recorded",
  "dpf.demand.help-offered",
]);
const DISPOSITION_ACTIVITIES = new Set(["dpf.demand.dispositioned", "dpf.release.applicability-published"]);
const POSTURE_ACTIVITIES = new Set<string>(OPERATIONAL_POSTURE_ACTIVITIES);

/** An accepted exchange outcome: 200 for an idempotent replay, 202 once persisted. */
function accepted(outcome: { action: string }): NextResponse {
  return NextResponse.json({ ...ok(), ...outcome }, { status: outcome.action === "noop" ? 200 : 202 });
}

function isInboundActivity(value: unknown): value is InboundDemandActivity {
  return typeof value === "string" && INBOUND_ACTIVITIES.has(value as InboundDemandActivity);
}

export async function POST(request: NextRequest): Promise<NextResponse> {

  const authz = await resolveFederationLinkAuth(request.headers.get("authorization"));
  if (!authz.ok) {
    return NextResponse.json(
      { ok: false, error: authz.error, message: authz.message },
      { status: ERROR_STATUS[authz.error] ?? 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }

  const eventViolations = validateFederationCloudEvent(body, { linkId: authz.linkId });
  if (eventViolations.length > 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_cloud_event", violations: eventViolations },
      { status: 422 },
    );
  }

  const event = body as { type?: unknown; data?: unknown };
  if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }

  if (typeof event.type === "string" && RESPONSE_ACTIVITIES.has(event.type)) {
    const response = await handleIncomingDemandResponse(
      prisma as unknown as DemandResponseDb,
      authz.linkId,
      event.data as DemandResponseV1,
    );
    if (response.action === "rejected") {
      return NextResponse.json({ ok: false, error: "invalid_demand_response", violations: response.violations }, { status: 422 });
    }
    return accepted(response);
  }

  if (typeof event.type === "string" && DISPOSITION_ACTIVITIES.has(event.type)) {
    const disposition = await handleIncomingDemandDisposition(
      prisma as never,
      authz.linkId,
      event.data as DemandDispositionNoticeV1,
    );
    if (disposition.action === "rejected") {
      return NextResponse.json({ ok: false, error: "invalid_demand_disposition", violations: disposition.violations }, { status: 422 });
    }
    return accepted(disposition);
  }

  if (typeof event.type === "string" && POSTURE_ACTIVITIES.has(event.type)) {
    // Operational posture is a same-organization capability (BI-648F01A0): a
    // service-provider, channel or community peer has no standing to report one.
    if (authz.role !== "same-org-peer") {
      return NextResponse.json({ ok: false, error: "link_not_same_organization" }, { status: 403 });
    }
    const posture = await handleIncomingOperationalPosture(
      prisma as unknown as OperationalPostureExchangeDb,
      authz.linkId,
      event.data as OperationalPostureV1,
    );
    if (posture.action === "rejected") {
      return NextResponse.json({ ok: false, error: "invalid_operational_posture", violations: posture.violations }, { status: 422 });
    }
    if (posture.action === "conflict") {
      return NextResponse.json({ ok: false, ...posture }, { status: 409 });
    }
    return accepted(posture);
  }

  if (!isInboundActivity(event.type)) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 422 });
  }

  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  const result = await handleIncomingDemand(
    prisma as unknown as DemandExchangeDb,
    authz.linkId,
    event.type,
    event.data as DemandEnvelopeV1,
    { receivingInstallationId: identity.installationId },
  );

  if (result.action === "rejected") {
    return NextResponse.json(
      { ok: false, error: "invalid_demand_envelope", violations: result.violations },
      { status: 422 },
    );
  }
  if (result.action === "conflict") {
    return NextResponse.json({ ok: false, ...result }, { status: 409 });
  }

  return accepted(result);
}
