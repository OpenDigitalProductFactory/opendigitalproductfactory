const TRUTHY = ["1", "true", "yes", "on"];
const FALSY = ["0", "false", "no", "off"];

export function envFlagEnabled(
  env: Record<string, string | undefined>,
  name: string,
): boolean {
  const raw = env[name];
  if (!raw) return false;
  return TRUTHY.includes(raw.trim().toLowerCase());
}

/**
 * True only when an operator explicitly turned something OFF.
 *
 * The mirror of `envFlagEnabled`, for the capabilities that default to on: an
 * unset variable means the default stands, so absence can never be read as a
 * refusal. Sharing the vocabulary is the point — two flag readers that disagreed
 * about what `off` means would leave an operator unable to predict either.
 */
export function envFlagDisabled(
  env: Record<string, string | undefined>,
  name: string,
): boolean {
  const raw = env[name];
  if (!raw) return false;
  return FALSY.includes(raw.trim().toLowerCase());
}
