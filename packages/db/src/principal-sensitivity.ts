export const PRINCIPAL_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export type PrincipalSensitivity = (typeof PRINCIPAL_SENSITIVITIES)[number];

export const INSTALLATION_OWNER_SENSITIVITY_FLOOR = [
  "public",
  "internal",
] as const satisfies readonly PrincipalSensitivity[];

const PRINCIPAL_SENSITIVITY_SET = new Set<string>(PRINCIPAL_SENSITIVITIES);

export function isPrincipalSensitivity(value: string): value is PrincipalSensitivity {
  return PRINCIPAL_SENSITIVITY_SET.has(value);
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
