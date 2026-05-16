// apps/web/lib/routing/capability-profile-cache.ts
//
// Phase A5: DB-backed cache for adapter capability profiles.
//
// Reads cached rows by [adapterKind, adapterVersion] unique key. On cache
// miss (or stale row past TTL), runs the appropriate probe, upserts the row,
// and returns. Re-runs the version-discovery probe on every call — that's
// cheap (a single `--version` shellout for CLIs, a constant return for HTTP
// adapters), and the version is the cache key.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2
//
// A6 will read from this cache to gate capability-based fallback when a
// route plan declares `capabilityRequirements: [...]`.

import os from "node:os";

import { prisma, Prisma } from "@dpf/db";

// AdapterCapabilityProfile is the Prisma generated row type. It isn't
// re-exported by name from @dpf/db (only `Prisma` is), so we resolve it
// through the namespace.
type AdapterCapabilityProfile = Prisma.AdapterCapabilityProfileModel;

import type { ExecutionAdapterKind } from "./execution-adapter-types";
import type { CapabilityProbeResult } from "./capability-probe-types";

import { probeClaudeCli } from "./capability-probes/probe-claude-cli";
import { probeCodexCli } from "./capability-probes/probe-codex-cli";
import { probeHttpAnthropic } from "./capability-probes/probe-http-anthropic";
import { probeHttpOpenAI } from "./capability-probes/probe-http-openai";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type ProbeFn = () => Promise<CapabilityProbeResult>;

function pickProbe(adapterKind: ExecutionAdapterKind): ProbeFn {
  switch (adapterKind) {
    case "claude-code-cli":
      return probeClaudeCli;
    case "codex-cli":
      return probeCodexCli;
    case "http-anthropic":
      return probeHttpAnthropic;
    case "http-openai":
      return probeHttpOpenAI;
    case "http-gemini":
    case "http-ollama":
    case "http-generic":
    case "codex-mcp-server":
    case "local-runtime":
      throw new Error(
        `No capability probe registered yet for adapter kind: ${adapterKind}`,
      );
    default: {
      const _exhaustive: never = adapterKind;
      throw new Error(`Unknown adapter kind: ${String(_exhaustive)}`);
    }
  }
}

function probedByIdentity(): string {
  return `${os.hostname()}:${process.pid}`;
}

function isFresh(probedAt: Date): boolean {
  return Date.now() - probedAt.getTime() < TTL_MS;
}

/**
 * Get-or-probe semantics:
 *   1. Discover current adapter version via the probe (cheap version-only call).
 *   2. Look up cache row by [adapterKind, adapterVersion].
 *   3. If found AND fresh (< 24h old): return it.
 *   4. Otherwise: probe, upsert, return.
 *
 * The probe itself is responsible for throwing on operational failure (e.g.
 * docker exec fails). We do NOT swallow probe errors — a missing CLI in the
 * sandbox is a real outage that should surface.
 */
export async function getOrProbeCapabilityProfile(
  adapterKind: ExecutionAdapterKind,
): Promise<AdapterCapabilityProfile> {
  const probe = pickProbe(adapterKind);

  // Step 1: discover version (cheap)
  const probed = await probe();

  // Step 2: cache lookup
  const cached = await prisma.adapterCapabilityProfile.findUnique({
    where: {
      adapterKind_adapterVersion: {
        adapterKind: probed.adapterKind,
        adapterVersion: probed.adapterVersion,
      },
    },
  });

  if (cached && isFresh(cached.probedAt)) {
    return cached;
  }

  // Step 3: write/refresh
  const probedBy = probedByIdentity();
  const probedAt = new Date();

  const writeData = {
    adapterKind: probed.adapterKind,
    adapterVersion: probed.adapterVersion,
    probedAt,
    probedBy,
    supportsStreamingEvents: probed.supportsStreamingEvents,
    supportsMcpAttach: probed.supportsMcpAttach,
    supportsMcpAttachPerInvoke: probed.supportsMcpAttachPerInvoke,
    supportsSubagents: probed.supportsSubagents,
    supportsHooks: probed.supportsHooks,
    supportsPlanState: probed.supportsPlanState,
    supportsTodoState: probed.supportsTodoState,
    supportsWebFetch: probed.supportsWebFetch,
    supportsWebSearch: probed.supportsWebSearch,
    supportsSessionResume: probed.supportsSessionResume,
    supportsExtendedThinking: probed.supportsExtendedThinking,
    supportsOutputSchema: probed.supportsOutputSchema,
    maxInteractiveLatencyMs: probed.maxInteractiveLatencyMs,
    supportedAuthModes: probed.supportedAuthModes,
    knownDegradations:
      probed.knownDegradations === null
        ? Prisma.JsonNull
        : (probed.knownDegradations as unknown as Prisma.InputJsonValue),
  };

  return prisma.adapterCapabilityProfile.upsert({
    where: {
      adapterKind_adapterVersion: {
        adapterKind: probed.adapterKind,
        adapterVersion: probed.adapterVersion,
      },
    },
    create: writeData,
    update: writeData,
  });
}
