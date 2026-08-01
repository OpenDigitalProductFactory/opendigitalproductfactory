// apps/web/app/r/[token]/route.ts
// The landing point for a signed attention reach link (BI-C7D25599).
// Spec: docs/superpowers/specs/2026-08-01-attention-reach-layer-design.md §4.4
//
// A ROUTE HANDLER, not a page: this verifies and redirects. A page would add a UI surface
// with no UI, and would drag in the four generated-artifact companions a new page route
// requires (BI-206DAB95) for something that renders nothing.
//
// The token authorizes NOTHING. It names which attention item to land on; the destination
// is a normal authenticated route, so an intercepted link grants an attacker no access —
// at worst they learn an opaque item id they still cannot open. That property is what lets
// this ship ahead of the per-class security review an action-bearing token would need.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { verifyReachLink, type ReachLinkFailure } from "@/lib/attention/reach-link";

export const dynamic = "force-dynamic";

/** Where an unusable link sends the operator, with a reason they can act on. */
const FAILURE_DESTINATION: Record<ReachLinkFailure, string> = {
  // Truthful and useful: the item probably still needs them, it is just this link that died.
  expired: "/workspace?reach=expired",
  // Deliberately identical for malformed and forged. Distinguishing them would tell someone
  // probing the endpoint whether they had the signature right.
  malformed: "/workspace?reach=invalid",
  signature_mismatch: "/workspace?reach=invalid",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const origin = new URL(request.url).origin;

  const verified = verifyReachLink(token);
  if (!verified.ok) {
    return NextResponse.redirect(new URL(FAILURE_DESTINATION[verified.reason], origin));
  }

  const session = await auth();
  if (!session?.user) {
    // Send them to sign in, carrying THIS url so they come back here afterwards and get
    // forwarded to the item. The alternative — landing on /workspace after sign-in — is
    // exactly the "recreates cognitive load" failure the 2026-07-22 audit recorded.
    const callbackUrl = `/r/${encodeURIComponent(token)}`;
    const signIn = new URL("/login", origin);
    signIn.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(signIn);
  }

  // `deepLink` was validated as a same-origin relative path at verify time, and the
  // signature proves it is the one we minted.
  return NextResponse.redirect(new URL(verified.payload.deepLink, origin));
}
