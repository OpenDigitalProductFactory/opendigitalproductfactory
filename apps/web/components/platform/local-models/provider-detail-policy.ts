import { isLocalProviderId } from "@/lib/routing/provider-locality";

export function shouldShowProviderAccountPosture(
  providerId: string,
  endpointType: string,
): boolean {
  return endpointType !== "service" && !isLocalProviderId(providerId);
}
