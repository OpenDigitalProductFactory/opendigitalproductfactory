// `task.submitted` on the federation A2A ingress (BI-B45BBD8A).
//
// A peer asks this installation to take on work against one of its projected
// coworker offers. The work goes through the same A2A task service the offer
// route uses (createCoworkerA2aTask → CoworkerEngagement), never a parallel
// path. The receiver owns the task: its id is minted here, deterministically from
// the link and requestId, so a crash-and-retry can never create a second one.
//
// The peer is a same-organization installation, so the offer must be published
// at least at the partner scope; an internal-only offer is not reachable from a
// peer. The sender's GAIDs are provenance until the estate namespace exists
// (BI-7E73D523); the authenticated link is what authorizes.

import { createHash } from "node:crypto";

import type { A2aRequestV1 } from "@dpf/db/federated-a2a-contract";

import { createCoworkerA2aTask, readCoworkerA2aTask } from "@/lib/coworker-service-catalog/a2a-tasks";
import { projectCoworkerOfferAgentCard } from "@/lib/coworker-service-catalog/agent-card";
import { loadCoworkerCatalog } from "@/lib/coworker-service-catalog/catalog";
import { createCoworkerEngagement } from "@/lib/coworker-service-catalog/engagements";

import type { A2aOperationHandler } from "./a2a-ingress";

const PEER_ACCESS_PROFILE = "partner-a2a" as const;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The receiver's task id for one peer request: stable across retries of that request. */
export function peerEngagementId(linkId: string, requestId: string): string {
  return `CE-A2A-${createHash("sha256").update(`${linkId}\u0000${requestId}`).digest("hex").slice(0, 24).toUpperCase()}`;
}

export interface TaskSubmittedDeps {
  loadCatalog?: typeof loadCoworkerCatalog;
  createTask?: typeof createCoworkerA2aTask;
  createEngagement?: typeof createCoworkerEngagement;
  readTask?: typeof readCoworkerA2aTask;
}

export function taskSubmittedHandler(deps: TaskSubmittedDeps = {}): A2aOperationHandler {
  return {
    async start(request: A2aRequestV1, { linkId, tx }) {
      const payload = request.payload;
      const offerId = str(payload.offerId);
      const requestedOutcome = str(payload.requestedOutcome);
      if (!offerId || !requestedOutcome) return { started: false, reason: "malformed" };
      const actingAgentGaid = request.provenance.actingAgentGaid;
      if (!actingAgentGaid) return { started: false, reason: "not-authorized" };
      const contractContext = rec(payload.contractContext);
      if (!str(contractContext?.termsRef) || !str(contractContext?.dataBoundaryRef)) return { started: false, reason: "malformed" };

      const catalog = await (deps.loadCatalog ?? loadCoworkerCatalog)();
      const offer = catalog.offers.find((candidate) => candidate.offerId === offerId);
      if (!offer) return { started: false, reason: "target-unavailable" };
      const projection = projectCoworkerOfferAgentCard(offer, { accessProfile: PEER_ACCESS_PROFILE });
      if (!projection.ok) return { started: false, reason: "target-unavailable" };

      const engagementId = peerEngagementId(linkId, request.requestId);
      const createEngagement = deps.createEngagement ?? createCoworkerEngagement;
      const task = await (deps.createTask ?? createCoworkerA2aTask)({
        offerId,
        serviceId: projection.card.serviceId,
        requestedOutcome,
        inputPayload: payload.inputPayload ?? {},
        fundingContext: {},
        contractContext: contractContext as never,
        contextId: request.contextId ?? undefined,
        accessProfile: PEER_ACCESS_PROFILE,
        actingAgentGaid,
        delegatingAgentGaid: request.provenance.delegatingAgentGaid ?? actingAgentGaid,
        delegatedAgentId: projection.card.agentId,
        delegatedAgentGaid: projection.card.identity.gaid,
        authorityBoundary: projection.card.authorityBoundary,
        riskTier: projection.card.riskTier,
        requiredGrants: projection.card.security.requiredGrants,
        submittingFederationLinkId: linkId,
        peer: { requestId: request.requestId, senderTaskId: request.senderTaskId, sourceInstallationDid: request.sourceInstallationDid },
      }, {
        createEngagement: (input) => createEngagement(input, { db: tx as never, idFactory: () => engagementId }),
      });
      return { started: true, receiverTaskId: task.id, state: task.status.state };
    },
    async readState(receiverTaskId) {
      const task = await (deps.readTask ?? readCoworkerA2aTask)(receiverTaskId);
      return task?.status.state ?? null;
    },
  };
}
