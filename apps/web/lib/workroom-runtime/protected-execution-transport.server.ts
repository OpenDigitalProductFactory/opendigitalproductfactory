import { executionHostRef, readExecutionHostObservation, type ExecutionHostRoute } from "@/lib/agent-toolchain/execution-host-registry";

import type { ProtectedExecutionBinding } from "./protected-execution-binding";

export type ProtectedEndpoint = ExecutionHostRoute & Pick<ProtectedExecutionBinding, "installationRef" | "hostRef" | "receiverRef" | "registrationRef"> & {
  url: string;
  audienceRef: string;
  network: "loopback" | "tailnet" | "direct-https";
};
export type ProtectedChannel<T> = Pick<ProtectedEndpoint, "installationRef" | "hostRef" | "receiverRef" | "registrationRef" | "audienceRef" | "endpointRef" | "network"> & {
  // The connector proves the receiver and transport audience before it hands over this channel.
  port: T;
};
export type ConnectProtectedReceiver<T> = (endpoint: Readonly<ProtectedEndpoint>, options: { redirect: "error"; relay: "forbidden" }) => Promise<
  | { kind: "unreachable-before-send" }
  | { kind: "refused" }
  | { kind: "authenticated"; channel: ProtectedChannel<T> }
>;
export type ProtectedTransport<T> = {
  resolveEndpoint(binding: Readonly<ProtectedExecutionBinding>, route: Readonly<ExecutionHostRoute>): Promise<ProtectedEndpoint | null>;
  connect: ConnectProtectedReceiver<T>;
};
export type ProtectedRouteSelection<T> = { kind: "selected"; channel: ProtectedChannel<T> } |
  { kind: "held"; reason: "invalid-route-set" | "endpoint-mismatch" | "receiver-refused" | "channel-mismatch" | "transport-unverifiable" | "unreachable" };

const sameReceiver = (expected: ProtectedChannel<unknown> | ProtectedEndpoint | ProtectedExecutionBinding,
  observed: ProtectedChannel<unknown> | ProtectedEndpoint) => expected.installationRef === observed.installationRef &&
  expected.hostRef === observed.hostRef && expected.registrationRef === observed.registrationRef && expected.receiverRef === observed.receiverRef;

function approvedEndpoint(binding: ProtectedExecutionBinding, route: ExecutionHostRoute, endpoint: ProtectedEndpoint): ProtectedEndpoint | null {
  const network = route.kind === "https" ? "direct-https" : route.kind;
  if (!sameReceiver(binding, endpoint) || endpoint.kind !== route.kind || endpoint.endpointRef !== route.endpointRef ||
    endpoint.network !== network || !executionHostRef.safeParse(endpoint.audienceRef).success || typeof endpoint.url !== "string" ||
    endpoint.url.length > 512) return null;
  const url = URL.parse(endpoint.url);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname) return null;
  const local = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((network === "loopback") !== local || url.hostname === "0.0.0.0" || url.hostname === "[::]") return null;
  return { ...endpoint, url: url.href };
}

/** Only a positive pre-send unreachability classification permits another route. Never tries another host. */
export async function selectProtectedRoute<T>(binding: ProtectedExecutionBinding, transport: ProtectedTransport<T>): Promise<ProtectedRouteSelection<T>> {
  const routes = readExecutionHostObservation(binding.routes);
  if (!routes) return { kind: "held", reason: "invalid-route-set" };
  for (const route of routes) {
    try {
      const candidate = await transport.resolveEndpoint(binding, route);
      const endpoint = candidate && approvedEndpoint(binding, route, candidate);
      if (!endpoint) return { kind: "held", reason: "endpoint-mismatch" };
      const result = await transport.connect(Object.freeze(endpoint), { redirect: "error", relay: "forbidden" });
      if (result.kind === "unreachable-before-send") continue;
      if (result.kind === "refused") return { kind: "held", reason: "receiver-refused" };
      const channel = result.channel;
      if (result.kind !== "authenticated" || !sameReceiver(endpoint, channel) || channel.endpointRef !== endpoint.endpointRef ||
        channel.audienceRef !== endpoint.audienceRef || channel.network !== endpoint.network) return { kind: "held", reason: "channel-mismatch" };
      return { kind: "selected", channel };
    } catch {
      return { kind: "held", reason: "transport-unverifiable" };
    }
  }
  return { kind: "held", reason: "unreachable" };
}
