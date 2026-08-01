// Next.js instrumentation hook.
//
// This file is bundled for both Node.js and Edge instrumentation. Keep it free
// of top-level Node-only imports; the production boot reconcilers live in
// instrumentation-node.ts and are loaded only when Next sets NEXT_RUNTIME=nodejs.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { registerNodeInstrumentation } = await import("./instrumentation-node");
  await registerNodeInstrumentation();
}

/**
 * Next.js global error hook — fires for every unhandled server-side error.
 * Delegated so the Edge instrumentation bundle never sees the Node metrics
 * stack or its transitive dependencies.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { onRequestError: recordNodeRequestError } = await import("./instrumentation-node");
  await recordNodeRequestError(error, request, context);
}
