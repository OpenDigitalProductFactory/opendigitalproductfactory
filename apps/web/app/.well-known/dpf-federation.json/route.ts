// GET /.well-known/dpf-federation.json
//
// The discovery advertisement for THIS install: how a nearby Edge Node learns
// that a host on its segment is a DPF install, which capability generation it
// speaks, where it accepts pairing, and which estate it belongs to.
//
// Public by design, and deliberately no more public than what already ships: the
// field set is the DNS-SD TXT allow-list, and the sibling
// `/.well-known/dpf-instance.json` already serves this install's organization
// name and id unauthenticated. Nothing here identifies a host, a person, or a
// device, and nothing here is a secret — the rotating install id is an HMAC
// under a secret that never leaves the install.
//
// Discovery is not trust. Everything this endpoint says is an untrusted setup
// suggestion; an auto-enrolment additionally requires a TLS chain that validates
// against the pinned organization root (design §5.6/§5.7).
//
// Design: docs/superpowers/specs/2026-08-23-zero-touch-organization-federation-design.md §5.11

import { NextResponse } from "next/server";

import { prisma } from "@dpf/db";

import {
  buildFederationAdvertisement,
  federationAdvertisingEnabled,
} from "@/lib/federation/discovery-advertisement";
import { resolveFederationIdentity } from "@/lib/federation/demand-identity";
import { loadEstateNameResolution } from "@/lib/install/estate-identity";

export const dynamic = "force-dynamic";

/** An install that does not advertise is indistinguishable from one that cannot. */
function notAdvertising(): NextResponse {
  return NextResponse.json(
    { code: "NOT_FOUND", message: "This installation does not advertise federation discovery." },
    { status: 404 },
  );
}

export async function GET(): Promise<NextResponse> {
  if (!federationAdvertisingEnabled()) return notAdvertising();

  let advertisement;
  try {
    const [identity, estate] = await Promise.all([
      resolveFederationIdentity(prisma),
      loadEstateNameResolution({
        readConfig: async (key: string) =>
          (await prisma.platformConfig.findUnique({ where: { key }, select: { value: true } }))
            ?.value ?? null,
      }),
    ]);
    advertisement = buildFederationAdvertisement({
      projectionSecret: identity.projectionSecret,
      estateName: estate.estateName,
      now: new Date(),
    });
  } catch {
    // No identity means nothing to advertise. Answering "not advertising" rather
    // than 500 keeps a scanner's handling of the two cases identical, and a
    // scanner has nothing useful to do with the difference.
    return notAdvertising();
  }

  return NextResponse.json(advertisement, {
    status: 200,
    // The install id rotates; a cached copy would outlive its window and make an
    // install look like two peers, or two installs look like one.
    headers: { "Cache-Control": "no-store" },
  });
}
