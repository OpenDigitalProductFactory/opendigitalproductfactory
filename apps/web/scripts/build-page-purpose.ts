import {
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  parsePagePurposeContract,
  parsePagePurposeRegistry,
  parsePurposeIdentityBaseline,
  type DraftPurposeRecord,
  type PagePurposeContract,
  type PagePurposeRegistry,
  type PurposeContractSource,
  type PurposeIdentityBaseline,
  type QuarantinedPurposeRecord,
  type RatifiedPurposeContract,
  type RatifiedPurposeContractSource,
} from "../lib/ux-budget/page-purpose";
import { PURPOSE_CONTRACT_SOURCES } from "../lib/ux-budget/purpose-contracts";
import {
  buildRoutePolicies,
  type RoutePolicy,
  type RoutePolicyManifestRow,
} from "../lib/ux-budget/route-policy";
import {
  findRepoRoot,
  readJsonFromGitRef,
  readRouteManifestRows,
  ROUTE_MANIFEST_REL,
  serializeStableJson,
  writeOrCheckGeneratedJson,
} from "./registry-generator-support";

const ROOT = findRepoRoot();
const OUT_REL = "apps/web/lib/ux-budget/route-purpose.generated.json";
const BASELINE_REL = "apps/web/lib/ux-budget/route-purpose-baseline.json";

export function buildPagePurposeRegistry(
  manifestRows: readonly RoutePolicyManifestRow[] = readRouteManifestRows(ROOT),
  contractSources: Readonly<Record<string, PurposeContractSource>> =
    PURPOSE_CONTRACT_SOURCES,
): PagePurposeRegistry {
  const policies = buildRoutePolicies(manifestRows);
  const policyPaths = new Set(policies.map((policy) => policy.routePath));
  for (const routePath of Object.keys(contractSources)) {
    if (!policyPaths.has(routePath)) {
      throw new Error(
        `[page-purpose] Ratified contract ${routePath} is not a canonical page route.`,
      );
    }
  }

  const routes: PagePurposeContract[] = policies.map(
    (policy) => {
      const source = contractSources[policy.routePath];
      if (source) {
        if (source.status === "intent-quarantined") {
          return composeQuarantinedPurposeRecord(source, policy);
        }
        const ratified = composeRatifiedPurposeContract(source, policy);
        const referenceIssues = validatePurposeRouteReferences(
          ratified,
          policyPaths,
        );
        if (referenceIssues.length > 0) {
          throw new Error(
            `[page-purpose] ${referenceIssues.join("\n")}`,
          );
        }
        return ratified;
      }

      const draft: DraftPurposeRecord = {
        schemaVersion: 1,
        status: "draft",
        routePath: policy.routePath,
        derived: {
          audience: policy.audience,
          destinationKind: policy.destinationKind,
          shell: policy.shell,
          confidence: policy.confidence,
          sweepEligible: policy.sweepEligible,
          ...(policy.sweepExclusionReason
            ? { sweepExclusionReason: policy.sweepExclusionReason }
            : {}),
        },
      };
      return draft;
    },
  );

  return parsePagePurposeRegistry({
    schemaVersion: 1,
    generator: "apps/web/scripts/build-page-purpose.ts",
    pageRouteCount: routes.length,
    draftCount: routes.filter((route) => route.status === "draft").length,
    ratifiedCount: routes.filter(
      (route) => route.status === "intent-ratified",
    ).length,
    quarantinedCount: routes.filter(
      (route) => route.status === "intent-quarantined",
    ).length,
    routes,
  });
}

export function composeRatifiedPurposeContract(
  source: RatifiedPurposeContractSource,
  policy: RoutePolicy,
): RatifiedPurposeContract {
  if (source.routePath !== policy.routePath) {
    throw new Error(
      `[page-purpose] Ratified contract key ${policy.routePath} does not match ${source.routePath}.`,
    );
  }
  const contract = parsePagePurposeContract({
    ...source,
    derived: {
      audience: policy.audience,
      destinationKind: policy.destinationKind,
      shell: policy.shell,
      confidence: policy.confidence,
      sweepEligible: policy.sweepEligible,
      ...(policy.sweepExclusionReason
        ? { sweepExclusionReason: policy.sweepExclusionReason }
        : {}),
    },
  });
  if (contract.status !== "intent-ratified") {
    throw new Error(
      `[page-purpose] Ratified source ${policy.routePath} parsed as a draft.`,
    );
  }
  return contract;
}

export function composeQuarantinedPurposeRecord(
  source: Extract<PurposeContractSource, { status: "intent-quarantined" }>,
  policy: RoutePolicy,
): QuarantinedPurposeRecord {
  if (source.routePath !== policy.routePath) {
    throw new Error(
      `[page-purpose] Quarantine key ${policy.routePath} does not match ${source.routePath}.`,
    );
  }
  const record = parsePagePurposeContract({
    ...source,
    derived: {
      audience: policy.audience,
      destinationKind: policy.destinationKind,
      shell: policy.shell,
      confidence: policy.confidence,
      sweepEligible: policy.sweepEligible,
      ...(policy.sweepExclusionReason
        ? { sweepExclusionReason: policy.sweepExclusionReason }
        : {}),
    },
  });
  if (record.status !== "intent-quarantined") {
    throw new Error(
      `[page-purpose] Quarantine source ${policy.routePath} parsed with the wrong status.`,
    );
  }
  return record;
}

export function validatePurposeRouteReferences(
  contract: RatifiedPurposeContract,
  canonicalRoutePaths: ReadonlySet<string>,
): string[] {
  const referencedRoutes = [
    contract.taskProtocol.startRoute,
    ...Object.values(contract.stateScenarios).map(
      (scenario) => scenario.recovery.routePath,
    ),
  ];
  return referencedRoutes
    .filter((routePath) => !canonicalRoutePaths.has(routePath))
    .map(
      (routePath) =>
        `Ratified contract ${contract.routePath} references noncanonical route ${routePath}.`,
    );
}

export function validatePurposeIdentityRatchet(
  registry: PagePurposeRegistry,
  baseline: PurposeIdentityBaseline,
): string[] {
  const issues: string[] = [];
  const manifestRoutes = new Set(registry.routes.map((route) => route.routePath));
  const routesByPath = new Map(
    registry.routes.map((route) => [route.routePath, route]),
  );
  const legacyDrafts = new Set(baseline.legacyDraftRoutePaths);

  for (const routePath of baseline.legacyDraftRoutePaths) {
    if (!manifestRoutes.has(routePath)) {
      issues.push(`Removed route ${routePath} remains in the purpose baseline.`);
    } else if (routesByPath.get(routePath)?.status !== "draft") {
      issues.push(
        `Reviewed route ${routePath} remains in the draft-exception baseline.`,
      );
    }
  }

  for (const route of registry.routes) {
    if (
      route.status === "draft" &&
      !legacyDrafts.has(route.routePath)
    ) {
      issues.push(
        `Non-ratified route ${route.routePath} is not grandfathered; add a ratified contract.`,
      );
    }
  }

  return issues;
}

export function validatePurposeBaselineTransition(
  current: PurposeIdentityBaseline,
  base: PurposeIdentityBaseline,
): string[] {
  const issues: string[] = [];
  const baseDrafts = new Set(base.legacyDraftRoutePaths);

  for (const routePath of current.legacyDraftRoutePaths) {
    if (!baseDrafts.has(routePath)) {
      issues.push(
        `Purpose baseline cannot grandfather new draft route ${routePath}.`,
      );
    }
  }

  return issues;
}

export function validatePurposeStatusTransition(
  current: PagePurposeRegistry,
  base: PagePurposeRegistry,
): string[] {
  const issues: string[] = [];
  const currentByPath = new Map(
    current.routes.map((route) => [route.routePath, route]),
  );
  const baseByPath = new Map(
    base.routes.map((route) => [route.routePath, route]),
  );

  for (const currentRoute of current.routes) {
    if (currentRoute.status !== "intent-quarantined") continue;
    const baseRoute = baseByPath.get(currentRoute.routePath);
    if (!baseRoute || baseRoute.status === "draft") {
      issues.push(
        `Quarantined route ${currentRoute.routePath} was not reviewed in the base registry.`,
      );
    }
  }

  for (const baseRoute of base.routes) {
    const currentRoute = currentByPath.get(baseRoute.routePath);
    if (!currentRoute) continue;
    if (
      baseRoute.status !== "draft" &&
      currentRoute.status === "draft"
    ) {
      issues.push(
        `Reviewed route ${baseRoute.routePath} reverted to an unreviewed draft.`,
      );
    }
  }

  return issues;
}

export function createBootstrapBaseline(
  registry: PagePurposeRegistry,
): PurposeIdentityBaseline {
  return parsePurposeIdentityBaseline({
    schemaVersion: 1,
    legacyDraftRoutePaths: registry.routes
      .filter((route) => route.status === "draft")
      .map((route) => route.routePath),
  });
}

export function resolvePurposeBaseState(
  baseBaseline: unknown | undefined,
  baseRegistry: unknown | undefined,
  baseManifestRows: readonly RoutePolicyManifestRow[] | undefined,
): {
  baseline: PurposeIdentityBaseline;
  registry: PagePurposeRegistry;
} {
  if (
    (baseBaseline === undefined) !==
    (baseRegistry === undefined)
  ) {
    throw new Error(
      "[page-purpose] Base baseline and registry must either both exist or both be absent for first-use bootstrap.",
    );
  }
  if (baseBaseline !== undefined && baseRegistry !== undefined) {
    return {
      baseline: parsePurposeIdentityBaseline(baseBaseline),
      registry: parsePagePurposeRegistry(baseRegistry),
    };
  }
  if (!baseManifestRows) {
    throw new Error(
      "[page-purpose] First-use base artifacts are absent and the base route manifest could not be read.",
    );
  }

  const registry = buildPagePurposeRegistry(baseManifestRows, {});
  return {
    baseline: createBootstrapBaseline(registry),
    registry,
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const bootstrapBaseline = process.argv.includes("--bootstrap-baseline");
  const baseRefIndex = process.argv.indexOf("--base-ref");
  const baseRef =
    baseRefIndex >= 0 ? process.argv[baseRefIndex + 1] : undefined;
  if (baseRefIndex >= 0 && !baseRef) {
    throw new Error("[page-purpose] --base-ref requires a Git ref.");
  }
  const outPath = join(ROOT, OUT_REL);
  const baselinePath = join(ROOT, BASELINE_REL);
  const registry = buildPagePurposeRegistry();

  if (bootstrapBaseline) {
    try {
      const baseline = createBootstrapBaseline(registry);
      writeFileSync(
        baselinePath,
        serializeStableJson(baseline),
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      throw new Error(
        `[page-purpose] ${BASELINE_REL} already exists; bootstrap is first-use only.`,
      );
    }
  }

  let baselineText: string;
  try {
    baselineText = readFileSync(baselinePath, "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
    throw new Error(
      `[page-purpose] Missing ${BASELINE_REL}. Run the reviewed first-use bootstrap.`,
    );
  }
  const baseline = parsePurposeIdentityBaseline(
    JSON.parse(baselineText),
  );
  const ratchetIssues = validatePurposeIdentityRatchet(registry, baseline);
  if (baseRef) {
    const baseBaselineValue = readJsonFromGitRef<unknown>(
      ROOT,
      baseRef,
      BASELINE_REL,
    );
    const baseRegistryValue = readJsonFromGitRef<unknown>(
      ROOT,
      baseRef,
      OUT_REL,
    );
    const firstUse =
      baseBaselineValue === undefined && baseRegistryValue === undefined;
    const baseManifest = firstUse
      ? readJsonFromGitRef<{ routes: RoutePolicyManifestRow[] }>(
          ROOT,
          baseRef,
          ROUTE_MANIFEST_REL,
        )?.routes
      : undefined;
    const baseState = resolvePurposeBaseState(
      baseBaselineValue,
      baseRegistryValue,
      baseManifest,
    );
    ratchetIssues.push(
      ...validatePurposeBaselineTransition(baseline, baseState.baseline),
      ...validatePurposeStatusTransition(registry, baseState.registry),
    );
  }
  if (ratchetIssues.length > 0) {
    throw new Error(`[page-purpose] Identity ratchet failed:\n${ratchetIssues.join("\n")}`);
  }

  if (check) {
    writeOrCheckGeneratedJson({
      root: ROOT,
      relativePath: OUT_REL,
      value: registry,
      check: true,
      label: "page-purpose",
      buildCommand: "pnpm --filter web build:page-purpose",
    });
    const current = readFileSync(outPath, "utf8");
    parsePagePurposeRegistry(JSON.parse(current));
    console.error(
      `[page-purpose] up to date (${registry.pageRouteCount} page routes, ${registry.ratifiedCount} ratified, ${registry.quarantinedCount} quarantined)`,
    );
    return;
  }

  writeOrCheckGeneratedJson({
    root: ROOT,
    relativePath: OUT_REL,
    value: registry,
    check: false,
    label: "page-purpose",
    buildCommand: "pnpm --filter web build:page-purpose",
  });
  console.error(
    `[page-purpose] wrote ${OUT_REL} (${registry.pageRouteCount} page routes, ${registry.ratifiedCount} ratified, ${registry.quarantinedCount} quarantined)`,
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

if (process.argv[1] && /build-page-purpose\.[cm]?ts$/.test(process.argv[1])) {
  main();
}
