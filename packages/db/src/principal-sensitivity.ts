export const PRINCIPAL_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export type PrincipalSensitivity = (typeof PRINCIPAL_SENSITIVITIES)[number];

// The installation owner is the accountable human for the business's own
// data: the same seed that grants this floor also creates tier-2 coworkers at
// sensitivity "confidential" (workforce-seed), and the coworker authority gate
// requires the acting human's clearance to include the coworker's sensitivity —
// a floor without "confidential" makes every such coworker permanently
// unauthorizable on a fresh install. "restricted" stays above the floor and
// must be granted explicitly.
export const INSTALLATION_OWNER_SENSITIVITY_FLOOR = [
  "public",
  "internal",
  "confidential",
] as const satisfies readonly PrincipalSensitivity[];

const PRINCIPAL_SENSITIVITY_SET = new Set<string>(PRINCIPAL_SENSITIVITIES);

export function isPrincipalSensitivity(value: string): value is PrincipalSensitivity {
  return PRINCIPAL_SENSITIVITY_SET.has(value);
}

/**
 * Coerce a single stored data/agent sensitivity label to a known level, failing
 * CLOSED to the most-sensitive level ("restricted") for any unrecognized value.
 *
 * Distinct from {@link normalizePrincipalSensitivities}, which validates a
 * CLEARANCE *list* and throws on an unknown member: a single data-sensitivity
 * label must ALWAYS resolve so the authority gate can compare it, and an unknown
 * label must never widen access. Shared by the runtime coworker-authority gate
 * (`resolve-coworker-tool-authority`) and the tools/list clearance filter
 * (`lib/mcp/listing-authority`) so the two never drift.
 */
export function coerceDataSensitivity(
  value: string | null | undefined,
): PrincipalSensitivity {
  return value && isPrincipalSensitivity(value) ? value : "restricted";
}

export function normalizePrincipalSensitivities(
  values: readonly string[] | null | undefined,
): PrincipalSensitivity[] {
  if (!values?.length) return ["public"];

  const unknown = values.find((value) => !isPrincipalSensitivity(value));
  if (unknown) {
    throw new Error(`Unknown principal sensitivity clearance: ${unknown}`);
  }

  const selected = new Set(values);
  return PRINCIPAL_SENSITIVITIES.filter((value) => selected.has(value));
}

export function resolvePrincipalSensitivityClearance(input: {
  existing?: readonly string[] | null;
  isSuperuser: boolean;
}): PrincipalSensitivity[] {
  return normalizePrincipalSensitivities(
    input.isSuperuser
      ? [
          ...(input.existing ?? []),
          ...INSTALLATION_OWNER_SENSITIVITY_FLOOR,
        ]
      : input.existing,
  );
}
