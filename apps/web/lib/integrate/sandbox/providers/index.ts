import type { BuildExecutionProvider, BuildExecutionProviderId } from "../provider-types";
import { localDockerProvider } from "./local-docker-provider";

const providers: Record<BuildExecutionProviderId, BuildExecutionProvider | null> = {
  "local-docker": localDockerProvider,
  "tappaas-vm": null,
  "kubernetes-job": null,
  "ecs-task": null,
  "ecs-service": null,
  "cloud-run-job": null,
  "cloud-run-service": null,
  "azure-containerapp-job": null,
  "edge-node-local-docker": null,
  disabled: null,
};

export function getBuildExecutionProvider(id: BuildExecutionProviderId = "local-docker"): BuildExecutionProvider {
  const provider = providers[id];
  if (!provider) throw new Error(`Build execution provider ${id} is not implemented`);
  return provider;
}
