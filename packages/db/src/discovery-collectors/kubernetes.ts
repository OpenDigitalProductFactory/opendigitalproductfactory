import type { CollectorContext, CollectorOutput } from "../discovery-types";

type KubernetesDeps = {
  env: NodeJS.ProcessEnv;
};

const defaultKubernetesDeps: KubernetesDeps = {
  env: process.env,
};

export async function collectKubernetesDiscovery(
  ctx?: CollectorContext,
  deps: KubernetesDeps = defaultKubernetesDeps,
): Promise<CollectorOutput> {
  const host = deps.env.KUBERNETES_SERVICE_HOST;
  const namespace = deps.env.KUBERNETES_NAMESPACE ?? deps.env.POD_NAMESPACE;

  if (!host) {
    return { items: [], relationships: [], warnings: ["kubernetes_unavailable"] };
  }

  return {
    items: [
      {
        sourceKind: ctx?.sourceKind ?? "kubernetes",
        itemType: "kubernetes_runtime",
        name: "Kubernetes",
        externalRef: `kubernetes_runtime:${host}`,
        naturalKey: `cluster_host:${host}`,
        confidence: 0.8,
        attributes: {
          host,
          namespace: namespace ?? null,
        },
      },
    ],
    relationships: [],
  };
}
