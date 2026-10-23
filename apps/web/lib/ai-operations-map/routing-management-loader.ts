import { getProviders } from "@/lib/inference/ai-provider-data";
import { loadProviderRoutingControls } from "@/lib/inference/provider-routing-control-data";
import { projectRoutingManagement } from "./routing-management-projection";

/** Reuse catalog/detail eligibility without exposing credential-bearing provider rows. */
export async function loadRoutingManagement(input: Omit<Parameters<typeof projectRoutingManagement>[0], "controls">) {
  const providers = await getProviders();
  const counts = new Map(providers.map(p => [p.provider.providerId, input.models.filter(m => m.providerId === p.provider.providerId).length]));
  const controls = await loadProviderRoutingControls(providers, counts);
  return projectRoutingManagement({ ...input, controls: [...controls].map(([providerId, view]) => ({ providerId, view })) });
}
