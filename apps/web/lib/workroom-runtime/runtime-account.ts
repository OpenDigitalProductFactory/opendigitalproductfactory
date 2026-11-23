import type { RuntimeProvider } from "@/lib/executor-drivers/types";

export const RUNTIME_ACCOUNT_DRIVERS = new Map<string, RuntimeProvider>([
  ["codex", "codex"], ["chatgpt", "codex"], ["anthropic-sub", "claude"],
]);

export function runtimeAccountDriver(account: { providerId: string; executionChannel: string; authMethod: string }): RuntimeProvider | undefined {
  const provider = RUNTIME_ACCOUNT_DRIVERS.get(account.providerId);
  if (account.executionChannel === "subscription-cli"
    || provider === "codex" && account.executionChannel === "direct-api" && account.authMethod === "api-key") return provider;
  return undefined;
}
