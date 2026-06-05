// apps/web/lib/workspace-home/activation-orchestrator/walker.ts
//
// Pure-ish boundary walker for the archetype-driven workspace-home setup
// activation orchestrator (BI-B14D6CF6 Phase 1). Reads a resolved
// WorkspaceHomeContribution + the install's prisma state and emits a structured
// ActivationPlan describing which canonical-data declarations are satisfied,
// which signals need binding, which slots will render with data vs empty.
//
// Phase 2 (setup-task generator) reads the plan and emits admin-actionable
// setup tasks for unsatisfied entries. Phase 4 (empty-state coordinator) reads
// `slotBehaviors` to drive render decisions per slot. The walker itself emits
// nothing else — no writes, no setup tasks, no UI — so it is unit-testable
// against synthetic prisma mocks.

import type { PrismaClient } from "@dpf/db";

import type {
  WorkspaceHomeComponentDescriptor,
  WorkspaceHomeContribution,
  WorkspaceHomeDataRef,
} from "../types";

import {
  DEFAULT_CANONICAL_DATA_REGISTRY,
  getCanonicalDataEntry,
  type CanonicalDataRegistryEntry,
} from "./canonical-data-registry";

import {
  DEFAULT_SIGNAL_REGISTRY,
  getSignalEntry,
  type SignalRegistryEntry,
} from "./signal-registry";

import type {
  ActivationPlan,
  CanonicalDataWalkResult,
  SignalBindingWalkResult,
  SlotBehaviorWalkResult,
} from "./types";

/** Optional injection hooks so per-archetype tests can override the registries. */
export type BuildActivationPlanOptions = {
  canonicalDataRegistry?: Readonly<Record<string, CanonicalDataRegistryEntry>>;
  signalRegistry?: Readonly<Record<string, SignalRegistryEntry>>;
  /**
   * Optional logger override. Defaults to console.warn. The plan emits at most
   * one warning per unknown canonical-data key per call, with the prefix
   * `[orchestrator-unknown-canonical-data]` so the substrate gap surfaces in
   * observability rather than silently turning into `satisfied: false`.
   */
  warn?: (message: string) => void;
};

const DEFAULT_WARN = (message: string): void => {
  // eslint-disable-next-line no-console
  console.warn(message);
};

/**
 * Build the activation plan for a resolved contribution against the install's
 * current data state. Pure read of prisma; no writes; no side effects beyond
 * the warning log on unknown declaration keys.
 */
export async function buildActivationPlan(input: {
  contribution: WorkspaceHomeContribution;
  archetypeContext: string;
  prisma: PrismaClient;
  options?: BuildActivationPlanOptions;
}): Promise<ActivationPlan> {
  const { contribution, archetypeContext, prisma, options = {} } = input;
  const canonicalRegistry = options.canonicalDataRegistry ?? DEFAULT_CANONICAL_DATA_REGISTRY;
  const signalRegistry = options.signalRegistry ?? DEFAULT_SIGNAL_REGISTRY;
  const warn = options.warn ?? DEFAULT_WARN;

  const canonicalData = await walkCanonicalData({
    declarations: contribution.setupActivation.requiredCanonicalData,
    registry: canonicalRegistry,
    prisma,
    warn,
  });

  const signals = walkSignals({
    declarations: contribution.setupActivation.requiredSignals,
    registry: signalRegistry,
  });

  const slotBehaviors = walkSlotBehaviors({
    contribution,
    canonicalData,
    signals,
  });

  return {
    contributionId: contribution.id,
    archetypeContext,
    canonicalData,
    signals,
    slotBehaviors,
  };
}

async function walkCanonicalData(input: {
  declarations: readonly string[];
  registry: Readonly<Record<string, CanonicalDataRegistryEntry>>;
  prisma: PrismaClient;
  warn: (message: string) => void;
}): Promise<CanonicalDataWalkResult[]> {
  const { declarations, registry, prisma, warn } = input;
  const results: CanonicalDataWalkResult[] = [];

  for (const key of declarations) {
    const entry = getCanonicalDataEntry(key, registry);
    if (!entry) {
      warn(
        `[orchestrator-unknown-canonical-data] contribution declares "${key}" but the canonical-data registry has no entry; extend canonical-data-registry.ts when this is reached.`,
      );
      results.push({ key, satisfied: false, sample: null });
      continue;
    }

    const observed = await entry.count(prisma);
    results.push({
      key,
      satisfied: observed >= entry.expectedMin,
      sample: {
        tableName: entry.tableName,
        expectedMin: entry.expectedMin,
        observed,
      },
    });
  }

  return results;
}

function walkSignals(input: {
  declarations: readonly string[];
  registry: Readonly<Record<string, SignalRegistryEntry>>;
}): SignalBindingWalkResult[] {
  const { declarations, registry } = input;
  return declarations.map((kind) => {
    const entry = getSignalEntry(kind, registry);
    if (!entry) {
      return { kind, loaderId: null, bound: false };
    }
    return { kind, loaderId: entry.loaderId, bound: entry.bound };
  });
}

function walkSlotBehaviors(input: {
  contribution: WorkspaceHomeContribution;
  canonicalData: CanonicalDataWalkResult[];
  signals: SignalBindingWalkResult[];
}): SlotBehaviorWalkResult[] {
  const { contribution, canonicalData, signals } = input;
  const { missingDataBehavior } = contribution.setupActivation;
  const canonicalSatisfied = new Set(
    canonicalData.filter((c) => c.satisfied).map((c) => c.key),
  );
  const signalBound = new Set(signals.filter((s) => s.bound).map((s) => s.kind));

  return contribution.slots.map((slot) => {
    const componentsForSlot = contribution.components.filter(
      (c) => c.slotId === slot.id,
    );
    const hasData = slotHasData({
      componentsForSlot,
      canonicalSatisfied,
      signalBound,
    });
    return {
      slotId: slot.id,
      missingDataBehavior,
      hasData,
    };
  });
}

function slotHasData(input: {
  componentsForSlot: WorkspaceHomeComponentDescriptor[];
  canonicalSatisfied: ReadonlySet<string>;
  signalBound: ReadonlySet<string>;
}): boolean {
  const { componentsForSlot, canonicalSatisfied, signalBound } = input;

  // A slot with no components is reported as `hasData: true` — the renderer
  // decides what to show in an empty slot; the walker stays out of UX.
  if (componentsForSlot.length === 0) return true;

  // A slot "has data" when at least one of its components has all its required
  // data refs satisfied. Components share the same slot to give the worker a
  // useful surface when any one of them can render; the renderer composes them.
  return componentsForSlot.some((component) => {
    const dataRefs = component.dataRefs.filter(isTypedDataRef);
    const requiredRefs = dataRefs.filter((ref) => ref.required === true);
    if (requiredRefs.length === 0) return true;
    return requiredRefs.every((ref) => {
      if (ref.kind === "canonical-data") return canonicalSatisfied.has(ref.key);
      if (ref.kind === "signal") return signalBound.has(ref.key);
      // `projection` data refs are exercised at render time by the projection
      // service; the walker can't pre-evaluate them without binding the
      // loader. Treat them as satisfied here; Phase 3 (signal binder) and
      // Phase 4 (empty-state coordinator) refine the read at render time.
      return true;
    });
  });
}

function isTypedDataRef(
  ref: WorkspaceHomeDataRef | Record<string, unknown>,
): ref is WorkspaceHomeDataRef {
  return (
    typeof (ref as WorkspaceHomeDataRef).kind === "string" &&
    typeof (ref as WorkspaceHomeDataRef).key === "string" &&
    typeof (ref as WorkspaceHomeDataRef).required === "boolean"
  );
}
