export function envFlagEnabled(
  env: Record<string, string | undefined>,
  name: string,
): boolean {
  const raw = env[name];
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

// Boot-time feature flags. These sit beside `envFlagEnabled` rather than in
// instrumentation.ts so the boot hook reads flags it does not also define
// (AGENTS.md §8 — one home per shared concern).

export function isStartupModelRevalidationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_STARTUP_MODEL_REVALIDATION_ENABLED");
}

export function isInngestSelfSyncOnBootEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED");
}

export function areOptionalStartupTasksEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_OPTIONAL_STARTUP_TASKS_ENABLED");
}
