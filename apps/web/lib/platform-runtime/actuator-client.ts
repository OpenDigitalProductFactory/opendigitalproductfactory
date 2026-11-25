// The portal's one door to the private actuator (BI-224F56F1).
//
// Every portal module reaches the actuator socket through this module, never
// by a relative path into scripts/lib. The wire contract is typed once, in
// scripts/lib/scope-writer-observation.d.mts, next to the code both sides
// run. Replies whose shape a portal module owns are narrowed here, once, so a
// change on either side fails to compile at its consumers instead of being
// absorbed by a cast at each call site.
//
// Mount detection is usesPrivateActuator / usesPrivateActuatorSync, and only
// those. Rule: fail closed. A mount table that cannot be read or parsed counts
// as mounted, so the caller takes the actuator path (or refuses) and never
// runs raw Docker on an unknown. Only a successful read that shows no actuator
// mount selects the legacy local path. ENOENT on a host without /proc
// (macOS, Windows) is a definite "not mounted", not an unknown.

import type { ConverterAvailability } from "@/lib/documents/conversion/availability";
import type { observeCiCapacityAtDaemon } from "@/lib/nonprod/local-ci-capacity-broker";
import type { PreviewFenceResult } from "@/lib/nonprod/preview-runtime-fence";
import * as wire from "../../../../scripts/lib/scope-writer-observation.mjs";

export {
  ACTUATOR_RESTARTABLE_SERVICES, ACTUATOR_SERVICE_LOG_NAMES, SCOPE_WRITER_OBSERVER_SOCKET,
  buildActuatorPromoterCandidate, createScopeWriterObserver, hasPrivateActuatorMount, isAllowedActuatorSocketPath, launchActuatorPromoter,
  observeActuatorPortalImage, observeActuatorProjectContainers, observeActuatorProjectServices, observeActuatorSandbox,
  openActuatorRuntimeSession, probeActuatorRuntimeProtocol, proveActuatorReassessmentCandidate, publishActuatorSocket,
  pruneActuatorDockerDisk, readActuatorPortalImage, readActuatorProjectContainers, readActuatorProjectServices,
  readActuatorReassessmentProof, readActuatorSandbox, readActuatorServiceLogs, readScopeWriterObservation,
  readScopeWriterRetirement, reconcileActuatorPromoters, reconcileActuatorSubstrate, resolveActuatorProjectServiceContainer,
  restartActuatorProjectService, restartActuatorService, runActuatorDoctools, runActuatorDoctoolsImage, runActuatorSandboxDb,
  runActuatorSourceWriter, usesPrivateActuator, usesPrivateActuatorSync,
} from "../../../../scripts/lib/scope-writer-observation.mjs";
export type {
  ActuatorDoctoolsOperation, ActuatorDoctoolsResult, ActuatorJsonReply, ActuatorPortalImage, ActuatorProjectContainer,
  ActuatorProjectContainers, ActuatorProjectServices, ActuatorPromoterSweep, ActuatorRestartableService, ActuatorRuntimeSession,
  ActuatorSandbox, ActuatorServiceLogName, ActuatorServiceLogs, ActuatorServiceRestart, ActuatorServiceState,
} from "../../../../scripts/lib/scope-writer-observation.mjs";

export type ActuatorCiCapacity = Awaited<ReturnType<typeof observeCiCapacityAtDaemon>>;
export type ActuatorDoctoolsHealth = Omit<ConverterAvailability, "checkedAt">;

/** The broker's daemon observation, produced by observeCiCapacityAtDaemon. */
export const readActuatorCiCapacity = (): Promise<ActuatorCiCapacity> =>
  wire.readActuatorCiCapacity() as Promise<ActuatorCiCapacity>;
/** The preview fence result, produced by fenceEndedPreviewRuntimesAtDaemon. */
export const reconcileEndedPreviewRuntimes = (): Promise<PreviewFenceResult> =>
  wire.reconcileEndedPreviewRuntimes() as Promise<PreviewFenceResult>;
/** The converter's health, produced by the actuator's doctools owner. */
export const readActuatorDoctoolsHealth = (): Promise<ActuatorDoctoolsHealth> =>
  wire.readActuatorDoctoolsHealth() as Promise<ActuatorDoctoolsHealth>;
