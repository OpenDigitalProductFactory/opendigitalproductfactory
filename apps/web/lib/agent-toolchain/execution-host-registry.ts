import { z } from "zod";

export const EXECUTION_HOST_ROUTE_ORDER = ["loopback", "tailnet", "https"] as const;
export type ExecutionHostRouteKind = typeof EXECUTION_HOST_ROUTE_ORDER[number];
export type ExecutionHostRoute = { kind: ExecutionHostRouteKind; endpointRef: string };
export type ExecutionHostIdentity = { installationRef: string; hostRef: string; receiverRef: string };

// Internal opaque references, not URLs, paths, secret values, or a wire codec.
export const executionHostRef = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/);
export const executionHostIdentity = z.strictObject({
  installationRef: executionHostRef, hostRef: executionHostRef, receiverRef: executionHostRef,
});
const route = z.strictObject({ kind: z.enum(EXECUTION_HOST_ROUTE_ORDER), endpointRef: executionHostRef });
const observation = z.array(route).min(1).max(EXECUTION_HOST_ROUTE_ORDER.length)
  .refine(rows => new Set(rows.map(row => row.kind)).size === rows.length);
const report = executionHostIdentity.omit({ installationRef: true }).extend({ routes: observation });

type RegistrationInput = {
  localInstallationRef: string;
  authenticated: ExecutionHostIdentity & { source: "local-host-agent" | "paired-install" };
  report: unknown;
  existing: ExecutionHostIdentity | null;
  observedAt: Date;
};

export function readExecutionHostObservation(value: unknown): ExecutionHostRoute[] | null {
  const parsed = observation.safeParse(value);
  return parsed.success ? parsed.data.sort((a, b) => EXECUTION_HOST_ROUTE_ORDER.indexOf(a.kind) - EXECUTION_HOST_ROUTE_ORDER.indexOf(b.kind)) : null;
}

/** Only a verified local host-agent identity may report candidate observations. This never issues qualification. */
export function decideExecutionHostRegistration(input: RegistrationInput):
  | { ok: true; action: "register" | "observe"; identity: ExecutionHostIdentity; observedAt: Date; routes: ExecutionHostRoute[] }
  | { ok: false; reason: string } {
  const { source, installationRef, hostRef, receiverRef } = input.authenticated;
  const identity = { installationRef, hostRef, receiverRef };
  if (source !== "local-host-agent" || installationRef !== input.localInstallationRef || !executionHostIdentity.safeParse(identity).success) {
    return { ok: false, reason: "not-local-host-agent" };
  }
  const verified = report.safeParse(input.report);
  const routes = verified.success ? readExecutionHostObservation(verified.data.routes) : null;
  if (!verified.success || !routes || !Number.isFinite(input.observedAt.getTime())) return { ok: false, reason: "invalid-report" };
  if (verified.data.hostRef !== hostRef || verified.data.receiverRef !== receiverRef ||
    (input.existing && (input.existing.installationRef !== installationRef || input.existing.hostRef !== hostRef))) {
    return { ok: false, reason: "identity-mismatch" };
  }
  if (input.existing && input.existing.receiverRef !== receiverRef) return { ok: false, reason: "receiver-changed" };
  return { ok: true, action: input.existing ? "observe" : "register", identity, observedAt: input.observedAt, routes };
}
