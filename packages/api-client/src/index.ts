import { DpfClient } from "./client";
import type { ApiClientConfig } from "./types";
import { authEndpoints } from "./endpoints/auth";
import { workspaceEndpoints } from "./endpoints/workspace";
import { portfolioEndpoints } from "./endpoints/portfolio";
import { opsEndpoints } from "./endpoints/ops";
import { agentEndpoints } from "./endpoints/agent";
import { governanceEndpoints } from "./endpoints/governance";
import { customerEndpoints } from "./endpoints/customer";
import { complianceEndpoints } from "./endpoints/compliance";
import { notificationsEndpoints } from "./endpoints/notifications";
import { dynamicEndpoints } from "./endpoints/dynamic";
import { uploadEndpoints } from "./endpoints/upload";

export function createApiClient(config: ApiClientConfig) {
  const client = new DpfClient(config);
  return {
    auth: authEndpoints(client),
    workspace: workspaceEndpoints(client),
    portfolio: portfolioEndpoints(client),
    ops: opsEndpoints(client),
    agent: agentEndpoints(client),
    governance: governanceEndpoints(client),
    customer: customerEndpoints(client),
    compliance: complianceEndpoints(client),
    notifications: notificationsEndpoints(client),
    dynamic: dynamicEndpoints(client),
    upload: uploadEndpoints(client),
  };
}

export type DpfApiClient = ReturnType<typeof createApiClient>;
export { DpfClient } from "./client";
export type { ApiClientConfig } from "./types";
