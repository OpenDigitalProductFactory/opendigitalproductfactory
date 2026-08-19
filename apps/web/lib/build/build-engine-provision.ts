// apps/web/lib/build/build-engine-provision.ts
//
// Build-Engine Provisioning (EP-2D477458) — Phase 2, the governed provision
// action. Installs a build-dispatch engine into the RUNNING sandbox from its
// registry recipe, idempotently, and verifies by re-probing.
//
// Governance:
//   - Side-effecting: runs an install command inside the sandbox. Callers MUST
//     authorize first — the MCP tool via the sandbox_execute grant, a future
//     server action via requireManageProviders(). This module trusts the
//     `actorUserId` it is given (records it as provisionedBy) and does not do
//     its own session auth, so it works from both call paths.
//   - Runs via execInSandbox (NOT the agent-facing run_sandbox_command, whose
//     blocklist intentionally rejects `curl | sh`). Recipe commands come from
//     the operator-curated registry (build-engines.json), never user input.
//   - structural-verification-is-not-functional: "ran the installer" != "binary
//     present". Success requires a fresh probe to confirm the binary responds.
//
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 2)

import { prisma } from "@dpf/db";

import { execInSandbox } from "@/lib/build/sandbox/sandbox";
import {
  probeEngineReadiness,
  type EngineProbeConfig,
} from "@/lib/routing/capability-probes/probe-engine-readiness";
import { persistEngineReadiness } from "@/lib/routing/persist-engine-readiness";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

export type EngineRecipe = {
  method: "npm-global" | "prestaged-binary" | "curl-installer";
  /** npm-global: the package to install globally. */
  package?: string;
  /** prestaged-binary: path of a binary baked into the image to copy into PATH. */
  stagedPath?: string;
  /** Explicit shell command (required for curl-installer; optional override otherwise). */
  command?: string;
  /** false ⇒ never run on the musl/alpine sandbox base. */
  muslSafe?: boolean;
  /** true ⇒ needs network egress (skipped in offline/air-gapped mode). */
  requiresEgress?: boolean;
  /** Lower runs first. */
  priority?: number;
};

export type ProvisionOutcome =
  | { kind: "already-present"; engineId: string; version: string | null }
  | { kind: "provisioned"; engineId: string; version: string | null; recipe: string }
  | { kind: "no-recipe"; engineId: string; reason: string }
  | { kind: "verify-failed"; engineId: string; recipe: string; error: string }
  | { kind: "error"; engineId: string; error: string };

/**
 * Pick the first recipe that can run here: musl-safe, and (when offline) not
 * egress-dependent, ordered by priority. Pure — unit-tested.
 */
export function selectRecipe(
  recipes: EngineRecipe[],
  opts: { offline: boolean },
): EngineRecipe | null {
  return (
    [...recipes]
      .filter((r) => r.muslSafe !== false)
      .filter((r) => !opts.offline || r.requiresEgress !== true)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0] ?? null
  );
}

/**
 * Build the sandbox shell command for a recipe, or null when it is missing the
 * fields its method requires. Pure — unit-tested. curl-installer never falls
 * back to a blind `curl | sh`: it requires an explicit, registry-curated
 * `command` (installers vary and often need post-install fixups).
 */
export function buildInstallCommand(recipe: EngineRecipe, binary: string): string | null {
  switch (recipe.method) {
    case "npm-global":
      return recipe.command ?? (recipe.package ? `npm install -g ${recipe.package}` : null);
    case "prestaged-binary":
      return (
        recipe.command ??
        (recipe.stagedPath
          ? `install -m 0755 ${recipe.stagedPath} /usr/local/bin/${binary}`
          : null)
      );
    case "curl-installer":
      return recipe.command ?? null;
    default:
      return null;
  }
}

function asRecipes(value: unknown): EngineRecipe[] {
  return Array.isArray(value) ? (value as EngineRecipe[]) : [];
}

/**
 * Provision `engineId` into the running sandbox. Idempotent (no-op when already
 * present), governed by the caller, verified by re-probe.
 */
export async function provisionBuildEngine(
  engineId: string,
  opts: { offline?: boolean; actorUserId: string },
): Promise<ProvisionOutcome> {
  const engine = await prisma.buildEngine.findUnique({
    where: { engineId },
    select: { engineId: true, binary: true, verifyCommand: true, versionRegex: true, recipes: true },
  });
  if (!engine) {
    return {
      kind: "error",
      engineId,
      error: `Unknown engine '${engineId}'. Run sync-engine-registry to populate the BuildEngine catalog.`,
    };
  }

  const probeConfig: EngineProbeConfig = {
    engineId: engine.engineId,
    binary: engine.binary,
    verifyCommand: engine.verifyCommand,
    versionRegex: engine.versionRegex,
  };

  // Idempotency — already installed?
  const before = await probeEngineReadiness(probeConfig);
  await persistEngineReadiness(before).catch(() => undefined);
  if (before.present) {
    return { kind: "already-present", engineId, version: before.version };
  }

  const recipe = selectRecipe(asRecipes(engine.recipes), { offline: opts.offline ?? false });
  if (!recipe) {
    return {
      kind: "no-recipe",
      engineId,
      reason: opts.offline
        ? "no offline (no-egress) recipe available for this engine"
        : "no musl-safe recipe available for this engine",
    };
  }

  const command = buildInstallCommand(recipe, engine.binary);
  if (!command) {
    return {
      kind: "no-recipe",
      engineId,
      reason: `recipe method '${recipe.method}' is missing the fields it needs to run`,
    };
  }

  try {
    await execInSandbox(SANDBOX_CONTAINER, command);
  } catch (err) {
    return {
      kind: "error",
      engineId,
      error: `provision command failed in sandbox: ${getErrorMessage(err)}`,
    };
  }

  // Verify by re-probing — "ran the installer" is not "binary present".
  const after = await probeEngineReadiness(probeConfig);
  await persistEngineReadiness(after).catch(() => undefined);
  await prisma.buildEngineState
    .update({
      where: { engineId },
      data: {
        lastProvisionedAt: new Date(),
        recipeApplied: recipe.method,
        provisionedBy: opts.actorUserId,
        desired: "present",
      },
    })
    .catch(() => undefined);

  if (!after.present) {
    return {
      kind: "verify-failed",
      engineId,
      recipe: recipe.method,
      error: after.error ?? "binary still not present after running the install recipe",
    };
  }

  return { kind: "provisioned", engineId, version: after.version, recipe: recipe.method };
}
