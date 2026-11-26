// @exposure authenticated — owner-only, preview-only S5 rehearsal requester enrollment and retirement (BI-9F7192F9).
// Inert until its proofs are served: the served ports deny (see servedRequesterBoundaryPorts).

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import { handleRequesterCommand, servedRequesterBoundaryPorts } from "@/lib/identity/s5-rehearsal-enrollment.server";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";

export async function POST(request: Request, { params }: { params: Promise<{ command: string }> }) {
  const { command } = await params;
  const result = await handleRequesterCommand(request, command, servedRequesterBoundaryPorts({
    environmentClass: async () => (await loadEnvironmentClassResolution({
      readConfig: async (key) => (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null,
    })).environmentClass,
    canonicalOrigin: resolveResourceOrigin,
    sessionUserId: async () => (await auth())?.user?.id ?? null,
  }));
  return NextResponse.json(result.body, { status: result.status });
}
