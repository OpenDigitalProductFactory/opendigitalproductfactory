import { prisma } from "@dpf/db";
import { resolveCoworkerIdentity } from "@/lib/coworker-identity";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";

export type CockpitTerminologyMode = "install-aware" | "abstract";
export type CockpitLabelResolution = "database" | "registry" | "raw" | "unresolved";

export interface CockpitInstallContext {
  organization: { name: string | null; industry: string | null } | null;
  storefront: {
    archetype: {
      archetypeId: string;
      name: string;
      category: string;
      customVocabulary: Record<string, string> | null;
    } | null;
  } | null;
  agents: Array<{ agentId: string; slugId: string | null; name: string }>;
}

export interface CockpitTerminologyBanner {
  message: string;
  href: string;
  cta: string;
}

export interface CockpitTerminology {
  mode: CockpitTerminologyMode;
  installName: string;
  portalLabel: string;
  verticalLabel: string;
  coworkerTeamLabel: string;
  missingContext: string[];
  banner: CockpitTerminologyBanner | null;
  archetype: CockpitInstallContext["storefront"] extends infer Storefront
    ? Storefront extends { archetype: infer Archetype }
      ? Archetype
      : null
    : null;
  agents: CockpitInstallContext["agents"];
}

export interface CockpitTerminologyRow {
  innerRing: number | null;
  outerRing: number | null;
  transmissionDirection: string;
  agentIdForTriple: string;
  actorId: string;
  capabilityName: string;
  archetypeContext: string | null;
  shaftSourceType: string;
  outcomeType: string;
  slipDetected: boolean;
  slipReason: string | null;
}

export interface CockpitResolvedLabels {
  interfaceLabel: string;
  capabilityLabel: string;
  archetypeLabel: string;
  agentLabel: string;
  actorLabel: string;
  sourceLabel: string;
  outcomeLabel: string;
  agentResolution: CockpitLabelResolution;
  actorResolution: CockpitLabelResolution;
}

const FALLBACK_BANNER: CockpitTerminologyBanner = {
  message: "Install identity not configured - using abstract gear vocabulary.",
  href: "/storefront/setup",
  cta: "Configure in Storefront setup",
};

const ABSTRACT_INTERFACE_LABELS = new Map<string, string>([
  ["1-2", "Ring 1->2 Coworker -> Workflow"],
  ["2-3", "Ring 2->3 Workflow -> Archetype"],
  ["3-4", "Ring 3->4 Archetype -> Sandbox/Prod"],
  ["4-5", "Ring 4->5 Sandbox/Prod -> Hive"],
]);

function asVocabularyRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string" && entry[1].trim().length > 0;
  });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function cleanLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function humanizeSlug(value: string | null | undefined): string | null {
  const clean = cleanLabel(value);
  if (!clean) return null;
  return clean
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function contextKey(innerRing: number | null, outerRing: number | null): string {
  return innerRing != null && outerRing != null ? `${innerRing}-${outerRing}` : "unknown";
}

function matchesArchetype(
  archetype: NonNullable<CockpitTerminology["archetype"]>,
  value: string | null,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  return [archetype.archetypeId, archetype.category, archetype.name]
    .map((item) => item.trim().toLowerCase())
    .includes(normalized);
}

function findAgent(
  input: string,
  agents: CockpitInstallContext["agents"],
): { label: string; resolution: CockpitLabelResolution } {
  const exact = agents.find((agent) => agent.agentId === input);
  if (exact) return { label: exact.name, resolution: "database" };

  const lowered = input.toLowerCase();
  const slug = agents.find((agent) => agent.slugId?.toLowerCase() === lowered);
  if (slug) return { label: slug.name, resolution: "database" };

  const registry = resolveCoworkerIdentity(input);
  if (registry?.displayName) return { label: registry.displayName, resolution: "registry" };
  if (registry?.agentName) return { label: registry.agentName, resolution: "registry" };

  return { label: input, resolution: input ? "unresolved" : "raw" };
}

export function buildCockpitTerminology(context: CockpitInstallContext): CockpitTerminology {
  const missingContext: string[] = [];
  const installName = cleanLabel(context.organization?.name);

  if (!installName) missingContext.push("organization-name");
  if (!context.storefront) missingContext.push("storefront-config");
  if (context.storefront && !context.storefront.archetype) {
    missingContext.push("storefront-archetype");
  }

  const archetype = context.storefront?.archetype ?? null;
  const vocabulary = getVocabulary(
    archetype?.category ?? context.organization?.industry,
    asVocabularyRecord(archetype?.customVocabulary),
  );
  const mode: CockpitTerminologyMode = missingContext.length === 0 ? "install-aware" : "abstract";

  return {
    mode,
    installName: installName ?? "Reduction Gear",
    portalLabel: vocabulary.portalLabel,
    verticalLabel:
      cleanLabel(archetype?.name) ??
      humanizeSlug(archetype?.category) ??
      humanizeSlug(context.organization?.industry) ??
      "Market vertical",
    coworkerTeamLabel: vocabulary.teamLabel,
    missingContext,
    banner: mode === "abstract" ? FALLBACK_BANNER : null,
    archetype,
    agents: context.agents,
  };
}

export async function getCockpitTerminology(): Promise<CockpitTerminology> {
  const [storefront, fallbackOrganization, agents] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      include: {
        organization: { select: { name: true, industry: true } },
        archetype: {
          select: {
            archetypeId: true,
            name: true,
            category: true,
            customVocabulary: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organization.findFirst({
      select: { name: true, industry: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agent.findMany({
      where: { archived: false },
      select: { agentId: true, slugId: true, name: true },
    }),
  ]);

  return buildCockpitTerminology({
    organization: storefront?.organization ?? fallbackOrganization,
    storefront: storefront
      ? {
          archetype: storefront.archetype
            ? {
                ...storefront.archetype,
                customVocabulary: asVocabularyRecord(storefront.archetype.customVocabulary),
              }
            : null,
        }
      : null,
    agents,
  });
}

export function getCockpitInterfaceLabel(
  innerRing: number | null,
  outerRing: number | null,
  terminology: CockpitTerminology,
): string {
  const key = contextKey(innerRing, outerRing);
  if (terminology.mode === "abstract") {
    return ABSTRACT_INTERFACE_LABELS.get(key) ?? `Ring ${key}`;
  }

  switch (key) {
    case "1-2":
      return `Ring 1->2 ${terminology.coworkerTeamLabel} -> ${terminology.portalLabel} workflow`;
    case "2-3":
      return `Ring 2->3 ${terminology.portalLabel} workflow -> ${terminology.verticalLabel} capability`;
    case "3-4":
      return `Ring 3->4 ${terminology.verticalLabel} capability -> governed delivery`;
    case "4-5":
      return "Ring 4->5 governed delivery -> hive contribution";
    default:
      return `Ring ${key}`;
  }
}

export function resolveCockpitRowLabels(
  row: CockpitTerminologyRow,
  terminology: CockpitTerminology,
): CockpitResolvedLabels {
  const agent = findAgent(row.agentIdForTriple, terminology.agents);
  const actor = findAgent(row.actorId, terminology.agents);
  const archetypeLabel =
    terminology.archetype && matchesArchetype(terminology.archetype, row.archetypeContext)
      ? terminology.verticalLabel
      : humanizeSlug(row.archetypeContext) ?? "Any archetype";
  const outcomeLabel =
    row.slipDetected || row.outcomeType === "slip"
      ? `slip${row.slipReason ? `: ${row.slipReason}` : ""}`
      : row.outcomeType;

  return {
    interfaceLabel: getCockpitInterfaceLabel(row.innerRing, row.outerRing, terminology),
    capabilityLabel:
      terminology.mode === "install-aware"
        ? `${row.capabilityName} work in ${archetypeLabel}`
        : row.capabilityName,
    archetypeLabel,
    agentLabel: agent.label,
    actorLabel: actor.label,
    sourceLabel: row.shaftSourceType,
    outcomeLabel,
    agentResolution: agent.resolution,
    actorResolution: actor.resolution,
  };
}
