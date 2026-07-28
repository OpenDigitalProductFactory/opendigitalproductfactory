import type { DataControlTargetAdapters } from "./control-operation-runner";

/**
 * Domain BIs add adapters here only after their effect, verifier, and optional
 * compensator are independently tested. An absent adapter leaves the durable
 * step pending and visible; the generic journal never guesses a mutation.
 */
export const DATA_CONTROL_TARGET_ADAPTERS: DataControlTargetAdapters =
  Object.freeze({});
