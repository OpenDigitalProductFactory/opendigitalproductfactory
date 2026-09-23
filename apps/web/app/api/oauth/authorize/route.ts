// @exposure public — The authorization endpoint is reached by a browser before any DPF session exists; it establishes one by redirecting to sign-in.
// GET  /api/oauth/authorize — start the authorization code flow.
// POST /api/oauth/authorize — record the human's consent decision.
//
// The GET validates and renders the consent screen; the POST is what that form
// submits. Both re-validate the request from scratch via parseAuthorizeRequest
// — the POST trusts nothing merely because the GET already looked at it.


// Error bodies here are RFC 6749 §5.2 shaped ({ error, error_description }),
// NOT the platform apiErrorResponse shape ({ code, message }). An OAuth client
// parses `error` to decide what to do next — re-authorize, step up, or give up —
// so emitting `code` instead would break the protocol for every conformant
// client. This is the one place the house error contract must yield to the wire
// contract; the raw-route-error baseline records it deliberately.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import {
  buildCodeRedirect,
  buildErrorRedirect,
  parseAuthorizeRequest,
} from "@/lib/auth/oauth-authorize-request";
import {
  OAUTH_AUTHORIZE_PATH,
  canonicalResourceUri,
  resolveResourceOrigin,
} from "@/lib/auth/oauth-metadata";
import { createAuthorizationCode } from "@/lib/auth/oauth-tokens";
import {
  eligibleOAuthCoworkers,
  resolveDefaultOAuthCoworker,
  createOAuthConsentBinding,
  OAUTH_SETUP_REQUIRED,
  type EligibleCoworker,
} from "@/lib/auth/oauth-identity-binding";
import type { AuthorizeRequest } from "@/lib/auth/oauth-authorize-request";
import { touchClient } from "@/lib/auth/oauth-clients";
import { parseScopeParam } from "@/lib/auth/oauth-scope-map";
import {
  htmlResponse,
  renderConsentPage,
  renderConsentRefusal,
} from "@/lib/auth/oauth-consent-page";

export const dynamic = "force-dynamic";

function directError(error: string, detail: string, status = 400): Response {
  // Rendered by us, never bounced to an unvalidated redirect_uri.
  return NextResponse.json({ error, error_description: detail }, { status });
}

export async function GET(request: Request) {
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    return directError("temporarily_unavailable", "This install has no resolvable public URL.", 503);
  }

  const url = new URL(request.url);
  const parsed = await parseAuthorizeRequest(url.searchParams, origin);
  if (!parsed.valid) {
    if (parsed.failure.mode === "direct") {
      return htmlResponse(
        renderConsentRefusal("This connection request is not valid", parsed.failure.detail),
        400,
      );
    }
    return NextResponse.redirect(buildErrorRedirect(parsed.failure), 302);
  }

  // Consent is rendered here rather than as a portal page route — see
  // lib/mcp/oauth-consent-page.ts for why (an OAuth interstitial cannot
  // honestly carry a page-purpose findability contract).
  const session = await auth();
  if (!session?.user?.id) {
    // One login path, not two: bounce through the portal's own sign-in and
    // come straight back with the request intact.
    const back = `${OAUTH_AUTHORIZE_PATH}?${url.searchParams.toString()}`;
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(back)}`, origin).toString(),
      302,
    );
  }

  return renderConsentFor({ userId: session.user.id, email: session.user.email ?? null }, parsed.request,
    url.searchParams, origin, { after: url.searchParams.get("assistant_after") ?? undefined });
}

const CONSENT_FORM_FIELDS = new Set(["granted_scope", "decision", "acting_coworker", "default_coworker", "assistant_after"]);

/**
 * Build and render the consent screen for a validated request. Shared by the
 * GET and by the POST's drift re-render, so both show exactly what the
 * server would bind: the eligible set, then the server-resolved default.
 * The client name is display data throughout — the resolver looks at it
 * last, and only inside a class it has already proven authority-equal.
 */
async function renderConsentFor(
  human: { userId: string; email: string | null },
  request: AuthorizeRequest,
  params: URLSearchParams,
  origin: string,
  options: { after?: string; driftNotice?: boolean } = {},
): Promise<Response> {
  const org = await prisma.organization.findFirst({ select: { name: true } });
  const { client, scopes, redirectUri, resource } = request;
  const coworkers = await eligibleOAuthCoworkers(human.userId, client.rowId, resource, prisma, { after: options.after });
  if (!coworkers.length) {
    return htmlResponse(renderConsentRefusal("Assistant setup needs approval",
      "Ask your administrator to approve an assistant role for this connection, then reconnect."), 403);
  }
  const page = coworkers.slice(0, 50);
  const resolution = await resolveDefaultOAuthCoworker({ userId: human.userId, resource, eligible: page,
    client: { rowId: client.rowId, clientName: client.clientName, redirectUris: client.redirectUris } }, prisma);

  return htmlResponse(
    renderConsentPage({
      clientName: client.clientName,
      selfAsserted: client.selfAsserted,
      installationName: org?.name ?? "this installation",
      actingUser: human.email ?? human.userId,
      scopes,
      assistant: { kind: resolution.kind, selected: resolution.selected, candidates: resolution.candidates },
      driftNotice: options.driftNotice,
      nextAssistantsUrl: coworkers.length > 50 ? (() => {
        const next = new URLSearchParams(params);
        next.set("assistant_after", coworkers[49].agentId);
        return `${OAUTH_AUTHORIZE_PATH}?${next.toString()}`;
      })() : undefined,
      resource: resource || canonicalResourceUri(origin),
      redirectUri,
      // Echoed verbatim so the POST re-derives the same request from scratch.
      hiddenParams: [...params.entries()].filter(([k]) => !CONSENT_FORM_FIELDS.has(k)),
    }),
  );
}

export async function POST(request: Request) {
  const origin = resolveResourceOrigin(request);
  if (!origin) {
    return directError("temporarily_unavailable", "This install has no resolvable public URL.", 503);
  }

  // Same-origin enforcement: this endpoint mutates on the strength of a session
  // cookie, so a cross-site form post must not reach it. Browsers always send
  // Origin on a cross-origin POST, so a present-and-foreign Origin is a hard
  // refusal; an absent one is a non-browser caller, which has no cookie to
  // ride on anyway.
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) {
    return directError("invalid_request", "Cross-origin consent submissions are refused.", 403);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return directError("access_denied", "Sign in before approving a connection.", 401);
  }

  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params.set(k, v);
  }

  const parsed = await parseAuthorizeRequest(params, origin);
  if (!parsed.valid) {
    if (parsed.failure.mode === "direct") {
      return directError(parsed.failure.error, parsed.failure.detail);
    }
    return NextResponse.redirect(buildErrorRedirect(parsed.failure), 302);
  }
  const { client, redirectUri, state, codeChallenge, resource } = parsed.request;

  if (form.get("decision") !== "approve") {
    return NextResponse.redirect(
      buildErrorRedirect({
        mode: "redirect",
        redirectUri,
        state,
        error: "access_denied",
        detail: "The user declined the request.",
      }),
      302,
    );
  }

  // The human may narrow the request on the consent screen. Their selection is
  // intersected with what was requested — a checkbox can only ever REMOVE
  // authority, never add it, even if the form is tampered with.
  const chosen = parseScopeParam(form.getAll("granted_scope").join(" ")).granted;
  const approved = parsed.request.scopes.filter((s) => chosen.includes(s));
  if (approved.length === 0) {
    return NextResponse.redirect(
      buildErrorRedirect({
        mode: "redirect",
        redirectUri,
        state,
        error: "access_denied",
        detail: "No permissions were approved.",
      }),
      302,
    );
  }

  // Which assistant. The human either left the server's default in place or
  // chose another eligible one from the disclosure. An unchanged default is
  // re-derived here and must come out the same; if eligibility or authority
  // signatures moved between the GET and this POST, the screen is shown again
  // with the new answer rather than binding an identity the human never saw.
  const agentId = typeof form.get("acting_coworker") === "string" ? String(form.get("acting_coworker")) : "";
  const shownDefault = typeof form.get("default_coworker") === "string" ? String(form.get("default_coworker")) : "";
  const eligible = await eligibleOAuthCoworkers(session.user.id, client.rowId, resource, prisma);
  if (!agentId || !eligible.some((agent) => agent.agentId === agentId)) {
    return directError("access_denied", OAUTH_SETUP_REQUIRED, 403);
  }
  if (shownDefault && agentId === shownDefault) {
    const page: EligibleCoworker[] = eligible.slice(0, 50);
    const resolution = await resolveDefaultOAuthCoworker({ userId: session.user.id, resource, eligible: page,
      client: { rowId: client.rowId, clientName: client.clientName, redirectUris: client.redirectUris } }, prisma);
    if (resolution.selected.agentId !== agentId) {
      return renderConsentFor({ userId: session.user.id, email: session.user.email ?? null }, parsed.request,
        params, origin, { driftNotice: true });
    }
  }
  const code = await prisma.$transaction(async (db) => {
    const binding = await createOAuthConsentBinding({ userId: session.user.id,
      clientId: client.rowId, resource, agentId, scopes: approved }, db);
    const issuedCode = await createAuthorizationCode({
      oauthClientRowId: client.rowId, userId: session.user.id, redirectUri,
      codeChallenge, resource, publicScopes: approved, authorityBindingId: binding.id,
    }, db);
    await db.authorizationDecisionLog.create({ data: {
      authorityBindingId: binding.id,
      decisionId: `oauth-consent-${crypto.randomUUID()}`,
      actorType: "human", actorRef: session.user.id, humanContextRef: session.user.id,
      agentContextRef: agentId, actionKey: "oauth_authorize", objectRef: resource,
      decision: "allow", rationale: { bindingId: binding.bindingId,
        clientId: client.clientId, registrationKind: client.registrationKind,
        requestedScopes: parsed.request.scopes, approvedScopes: approved },
      endpointUsed: "/api/oauth/authorize", routeContext: "oauth-consent",
    } });
    return issuedCode;
  });

  touchClient(client.rowId);
  return NextResponse.redirect(buildCodeRedirect(redirectUri, code, state), 302);
}
