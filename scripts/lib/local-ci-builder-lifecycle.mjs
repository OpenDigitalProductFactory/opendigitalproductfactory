// BI-C85D1B0A — pure decisions for managed local-CI BuildKit lifecycle.
//
// Spec: docs/superpowers/specs/2026-08-10-buildkit-session-lifecycle-design.md
//
// Separates:
//   - process cool-down (buildx stop)  — reclaim multi-GiB idle RAM, keep cache
//   - obsolete policy reap (buildx rm) — only one builderPolicy.version generation
//
// Side effects live in local-ci-bounded-build.mjs and runtime-artifact-janitor.mjs.

/** Default grace before the janitor backstop stops a still-running managed builder. */
export const DEFAULT_IDLE_GRACE_MS = 45 * 60 * 1000;

/**
 * Managed builder names look like `dpf-local-ci-buildkit-v2-0`
 * (policy version + slot ordinal). Container names add a trailing `0`
 * (`buildx_buildkit_dpf-local-ci-buildkit-v2-00`).
 */
export const MANAGED_BUILDER_NAME_RE =
  /^dpf-local-ci-buildkit-v(\d+)-(\d+)$/i;

export const MANAGED_BUILDER_CONTAINER_RE =
  /^buildx_buildkit_dpf-local-ci-buildkit-v(\d+)-(\d+)0$/i;

/**
 * @param {string} name
 * @returns {{policyVersion:number, ordinal:number}|null}
 */
export function parseManagedBuilderName(name) {
  const match = MANAGED_BUILDER_NAME_RE.exec(String(name ?? "").trim());
  if (!match) return null;
  return {
    policyVersion: Number(match[1]),
    ordinal: Number(match[2]),
  };
}

/**
 * @param {string} containerName
 * @returns {{policyVersion:number, ordinal:number, builderName:string}|null}
 */
export function parseManagedBuilderContainer(containerName) {
  const match = MANAGED_BUILDER_CONTAINER_RE.exec(String(containerName ?? "").trim());
  if (!match) return null;
  const policyVersion = Number(match[1]);
  const ordinal = Number(match[2]);
  return {
    policyVersion,
    ordinal,
    builderName: `dpf-local-ci-buildkit-v${policyVersion}-${ordinal}`,
  };
}

export function isManagedBuilderName(name) {
  return parseManagedBuilderName(name) !== null;
}

/**
 * Whether post-build cool-down (buildx stop) is enabled.
 * Default ON. Set DPF_LOCAL_CI_BUILDER_KEEP_WARM=1 to keep the daemon running.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function isBuilderCoolDownEnabled(env = process.env) {
  const raw = String(env.DPF_LOCAL_CI_BUILDER_KEEP_WARM ?? "").trim().toLowerCase();
  return raw !== "1" && raw !== "true" && raw !== "yes" && raw !== "on";
}

/**
 * Decide what to do with one managed builder.
 *
 * Priority:
 *   1. REAP if policy version is not the current generation
 *   2. KEEP if cool-down disabled / lease-or-fence active / not running / within grace
 *   3. STOP if running past grace with no active fence
 *
 * @param {{
 *   name: string,
 *   status?: string,
 *   running?: boolean,
 *   idleMs?: number,
 * }} builder
 * @param {{
 *   currentPolicyVersion: number,
 *   leaseOrFenceActive?: boolean,
 *   idleGraceMs?: number,
 *   coolDownEnabled?: boolean,
 * }} opts
 * @returns {{action:"KEEP"|"STOP"|"REAP", reason:string}}
 */
export function decideManagedBuilderAction(builder, opts) {
  const name = String(builder?.name ?? "").trim();
  const parsed = parseManagedBuilderName(name);
  if (!parsed) {
    return { action: "KEEP", reason: "not a managed local-CI builder name" };
  }

  const currentPolicyVersion = Number(opts.currentPolicyVersion);
  if (!Number.isInteger(currentPolicyVersion) || currentPolicyVersion <= 0) {
    throw new Error("currentPolicyVersion must be a positive integer");
  }

  if (parsed.policyVersion !== currentPolicyVersion) {
    return {
      action: "REAP",
      reason:
        `obsolete policy v${parsed.policyVersion} (current v${currentPolicyVersion}) — remove zombie builder`,
    };
  }

  const coolDownEnabled = opts.coolDownEnabled ?? true;
  if (!coolDownEnabled) {
    return { action: "KEEP", reason: "cool-down disabled (DPF_LOCAL_CI_BUILDER_KEEP_WARM)" };
  }

  if (opts.leaseOrFenceActive) {
    return { action: "KEEP", reason: "local-CI lease/owner fence is active" };
  }

  const running =
    builder.running === true
    || /running/i.test(String(builder.status ?? ""));
  if (!running) {
    return { action: "KEEP", reason: "builder already stopped" };
  }

  const idleGraceMs = opts.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
  const idleMs = Number(builder.idleMs ?? 0);
  if (!Number.isFinite(idleMs) || idleMs < idleGraceMs) {
    return {
      action: "KEEP",
      reason: `running but within idle grace (${Math.max(0, idleMs)}ms < ${idleGraceMs}ms)`,
    };
  }

  return {
    action: "STOP",
    reason: `idle ${idleMs}ms >= grace ${idleGraceMs}ms — buildx stop (keep disk cache)`,
  };
}

/**
 * Post-build cool-down for the builder this process just used.
 * Always STOP when cool-down is enabled (session end), regardless of grace.
 *
 * @param {{name:string}} builder
 * @param {{coolDownEnabled?: boolean}} [opts]
 */
export function decidePostBuildCoolDown(builder, opts = {}) {
  const name = String(builder?.name ?? "").trim();
  if (!isManagedBuilderName(name)) {
    return { action: "KEEP", reason: "not a managed local-CI builder name" };
  }
  if (opts.coolDownEnabled === false) {
    return { action: "KEEP", reason: "cool-down disabled (DPF_LOCAL_CI_BUILDER_KEEP_WARM)" };
  }
  return {
    action: "STOP",
    reason: "build session ended — buildx stop (keep disk cache)",
  };
}

/**
 * Plan actions across a discovered builder set.
 *
 * @param {{
 *   builders: Array<{name:string, status?:string, running?:boolean, idleMs?:number}>,
 *   currentPolicyVersion: number,
 *   leaseOrFenceActive?: boolean,
 *   idleGraceMs?: number,
 *   coolDownEnabled?: boolean,
 * }} input
 */
export function planManagedBuilderLifecycle(input) {
  const decisions = (input.builders ?? []).map((builder) => ({
    builder,
    ...decideManagedBuilderAction(builder, {
      currentPolicyVersion: input.currentPolicyVersion,
      leaseOrFenceActive: input.leaseOrFenceActive,
      idleGraceMs: input.idleGraceMs,
      coolDownEnabled: input.coolDownEnabled,
    }),
  }));

  return {
    decisions,
    toStop: decisions.filter((d) => d.action === "STOP"),
    toReap: decisions.filter((d) => d.action === "REAP"),
    toKeep: decisions.filter((d) => d.action === "KEEP"),
  };
}

/** CLI argv for stopping a builder (keeps state/cache). */
export function buildxStopArgs(builderName) {
  return ["buildx", "stop", String(builderName)];
}

/** CLI argv for removing an obsolete builder (daemon + registration). */
export function buildxRmArgs(builderName) {
  return ["buildx", "rm", "-f", String(builderName)];
}
