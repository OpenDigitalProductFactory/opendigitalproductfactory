// @exposure authenticated — owner-only, preview-only S5 rehearsal requester enrollment and retirement (BI-9F7192F9).
// Inert until its proofs are served: the served ports deny (see servedRequesterBoundaryPorts).

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolveResourceOrigin } from "@/lib/auth/oauth-metadata";
import {
  handleRequesterCommand,
  handleRequesterStatus,
  servedRequesterBoundaryPorts,
  servedRequesterStatusPorts,
} from "@/lib/identity/s5-rehearsal-enrollment.server";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";

const servedDeps = {
  environmentClass: async () => (await loadEnvironmentClassResolution({
    readConfig: async (key: string) => (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null,
  })).environmentClass,
  canonicalOrigin: resolveResourceOrigin,
  sessionUserId: async () => (await auth())?.user?.id ?? null,
};

export async function POST(request: Request, { params }: { params: Promise<{ command: string }> }) {
  const { command } = await params;
  const result = await handleRequesterCommand(request, command, servedRequesterBoundaryPorts(servedDeps));
  return NextResponse.json(result.body, { status: result.status });
}

/** Read-only lost-acknowledgement recovery: GET /api/admin/rehearsal-requester/status?setupDigest=. Never creates. */
export async function GET(request: Request, { params }: { params: Promise<{ command: string }> }) {
  const { command } = await params;
  const result = await handleRequesterStatus(request, command, servedRequesterStatusPorts(servedDeps));
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
