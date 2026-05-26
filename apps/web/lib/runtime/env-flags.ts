export function envFlagEnabled(
  env: Record<string, string | undefined>,
  name: string,
): boolean {
  const raw = env[name];
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
