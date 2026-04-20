"use server";

import { auth } from "@/lib/auth";
import { getBuildFlowState as deriveBuildFlowState, type BuildFlowState } from "@/lib/build-flow-state";

/**
 * Server action wrapper around getBuildFlowState — the pure function lives in
 * lib/build-flow-state.ts so it can be called from server-only code (MCP
 * tools, reconciler). This wrapper adds an auth check and is the entry point
 * for client components that need the flow state for rendering.
 */
export async function getBuildFlowStateAction(buildId: string): Promise<BuildFlowState | null> {
  const session = await auth();
  if (!session?.user) return null;
  return deriveBuildFlowState(buildId);
}
