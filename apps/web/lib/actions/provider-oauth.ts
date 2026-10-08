"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { createOAuthFlow, disconnectProviderOAuthInternal } from "@/lib/provider-oauth";

async function requireManageProviders(): Promise<string> {
  return (await requireCapability("manage_provider_connections")).userId;
}

export async function startProviderOAuth(providerId: string, connectionId?: string): Promise<{ authorizeUrl: string } | { error: string }> {
  try {
    await requireManageProviders();
    return connectionId === undefined ? createOAuthFlow(providerId) : createOAuthFlow(providerId, connectionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start OAuth sign-in";
    if (message === "Unauthorized") {
      return { error: "Your admin session expired — sign in again and retry OAuth setup" };
    }
    return { error: message };
  }
}

export async function disconnectProviderOAuth(providerId: string, connectionId?: string): Promise<{ error?: string }> {
  try {
    await requireManageProviders();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to disconnect provider";
    if (message === "Unauthorized") {
      return { error: "Your admin session expired — sign in again before disconnecting this provider" };
    }
    return { error: message };
  }
  return disconnectProviderOAuthInternal(providerId, connectionId);
}
