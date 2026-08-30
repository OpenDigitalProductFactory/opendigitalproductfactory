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

  const org = await prisma.organization.findFirst({ select: { name: true } });
  const { client, scopes, redirectUri, resource } = parsed.request;

  return htmlResponse(
    renderConsentPage({
      clientName: client.clientName,
      selfAsserted: client.selfAsserted,
      installationName: org?.name ?? "this installation",
      actingUser: session.user.email ?? session.user.id,
      scopes,
      resource: resource || canonicalResourceUri(origin),
      redirectUri,
      // Echoed verbatim so the POST re-derives the same request from scratch.
      hiddenParams: [...url.searchParams.entries()].filter(
        ([k]) => k !== "granted_scope" && k !== "decision",
      ),
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

  const code = await createAuthorizationCode({
    oauthClientRowId: client.rowId,
    userId: session.user.id,
    redirectUri,
    codeChallenge,
    resource,
    publicScopes: approved,
  });

  // The consent decision is an authorization event and belongs in the audit
  // stream beside every other one, not only in the token row it produced.
  await prisma.authorizationDecisionLog
    .create({
      data: {
        decisionId: `oauth-consent-${crypto.randomUUID()}`,
        actorType: "human",
        actorRef: session.user.id,
        humanContextRef: session.user.id,
        actionKey: "oauth_authorize",
        objectRef: resource,
        decision: "allow",
        rationale: {
          clientId: client.clientId,
          clientName: client.clientName,
          registrationKind: client.registrationKind,
          selfAsserted: client.selfAsserted,
          requestedScopes: parsed.request.scopes,
          approvedScopes: approved,
        },
        endpointUsed: "/api/oauth/authorize",
        routeContext: "oauth-consent",
      },
    })
    .catch(() => undefined);

  touchClient(client.rowId);
  return NextResponse.redirect(buildCodeRedirect(redirectUri, code, state), 302);
}
