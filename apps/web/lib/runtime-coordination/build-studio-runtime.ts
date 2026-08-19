import { resolveSandboxUrl } from "@/lib/build/sandbox/resolve-sandbox-url";

import type { RuntimeTargetInput } from "./types";

export function buildBuildStudioSandboxTargetInput(args: {
  buildRowId: string;
  buildId: string;
  capsuleRowId?: string | null;
  containerName: string;
  hostPort: number;
  branchName: string;
}): RuntimeTargetInput {
  const urls = resolveSandboxUrl(args.containerName, args.hostPort);
  return {
    targetId: `RT-BUILD-SANDBOX-${args.buildId}`,
    kind: "build-sandbox",
    status: "running",
    featureBuildId: args.buildRowId,
    workCapsuleId: args.capsuleRowId ?? null,
    containerName: args.containerName,
    hostUrl: urls.host,
    internalUrl: urls.internal,
    port: args.hostPort,
    metadata: {
      buildId: args.buildId,
      buildBranch: args.branchName,
    },
  };
}
