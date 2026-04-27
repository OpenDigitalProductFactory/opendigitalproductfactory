export interface NativeIntegrationDescriptor {
  integrationKey: string;
  label: string;
  route: string;
  activationKind: "native_setup";
  metadataSource: "explicit" | "inferred";
}

export interface NativeIntegrationInput {
  name: string;
  slug?: string | null;
  category?: string | null;
  tags?: string[] | null;
  rawMetadata?: unknown;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectTokens(input: NativeIntegrationInput): string[] {
  return [input.name, input.slug ?? "", input.category ?? "", ...(input.tags ?? [])]
    .flatMap((piece) => piece.toLowerCase().split(/[^a-z0-9]+/g))
    .map((piece) => piece.trim())
    .filter(Boolean);
}

function getExplicitNativeIntegration(rawMetadata: unknown): NativeIntegrationDescriptor | null {
  const metadata = toRecord(rawMetadata);
  if (!metadata) return null;

  const explicit = toRecord(metadata.dpfNativeIntegration) ?? toRecord(metadata.nativeIntegration);
  if (!explicit) return null;

  const integrationKey = coerceString(explicit.integrationKey);
  const label = coerceString(explicit.label);
  const route = coerceString(explicit.route);
  const activationKind = coerceString(explicit.activationKind);

  if (!integrationKey || !label || !route || activationKind !== "native_setup") {
    return null;
  }

  return {
    integrationKey,
    label,
    route,
    activationKind: "native_setup",
    metadataSource: "explicit",
  };
}

export function getNativeIntegrationDescriptor(
  input: NativeIntegrationInput
): NativeIntegrationDescriptor | null {
  const explicit = getExplicitNativeIntegration(input.rawMetadata);
  if (explicit) return explicit;

  const tokens = collectTokens(input);
  const joined = tokens.join(" ");

  if (
    tokens.includes("adp") ||
    joined.includes("workforce now") ||
    joined.includes("payroll")
  ) {
    return {
      integrationKey: "adp",
      label: "ADP Workforce Now",
      route: "/platform/tools/integrations/adp",
      activationKind: "native_setup",
      metadataSource: "inferred",
    };
  }

  return null;
}

