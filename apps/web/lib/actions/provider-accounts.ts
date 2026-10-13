"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import * as accounts from "@/lib/inference/provider-account-management";

export async function addProviderAccount(input: Parameters<typeof accounts.addProviderAccount>[0]) {
  await requireCapability("manage_provider_connections");
  return accounts.addProviderAccount(input);
}

export async function configureProviderAccount(input: Parameters<typeof accounts.configureProviderAccount>[0]) {
  await requireCapability("manage_provider_connections");
  return accounts.configureProviderAccount(input);
}

export async function setProviderAccountEnabled(connectionId: string, enabled: boolean) {
  await requireCapability("manage_provider_connections");
  return accounts.setProviderAccountEnabled(connectionId, enabled);
}

export async function discoverProviderAccount(connectionId: string) {
  await requireCapability("manage_provider_connections");
  const { discoverProviderAccountModels } = await import("@/lib/inference/provider-account-discovery");
  return discoverProviderAccountModels(connectionId);
}
