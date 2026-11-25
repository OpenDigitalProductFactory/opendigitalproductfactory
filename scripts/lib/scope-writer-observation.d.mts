// The typed contract of the private actuator socket (BI-224F56F1).
//
// scope-writer-observation.mjs is both sides of the socket: the actuator
// serves these routes and the portal calls them. This file is the one typed
// definition of what crosses it. Portal code imports it only through
// apps/web/lib/platform-runtime/actuator-client.ts, never by relative path,
// so a reply shape change fails to compile at every consumer.
//
// Replies cross a trust boundary: the types describe what the actuator
// produces, and callers still validate any field they act on.

import type { Server } from "node:http";

type SocketOption = { socketPath?: string };
type TimedSocketOption = SocketOption & { timeoutMs: number };
type DockerGet = (path: string) => Promise<unknown>;

export declare const SCOPE_WRITER_OBSERVER_SOCKET: string;
export type ActuatorServiceLogName = "portal" | "sandbox" | "postgres" | "portal-init" | "browser-use";
export type ActuatorRestartableService = "portal" | "sandbox" | "postgres";
/** Membership lists, checked with includes() against request input. */
export declare const ACTUATOR_SERVICE_LOG_NAMES: readonly string[];
export declare const ACTUATOR_RESTARTABLE_SERVICES: readonly string[];

// ─── Mount detection: the one switch, fail closed ────────────────────────────

/** True when the mount table shows the private actuator socket directory. */
export declare function hasPrivateActuatorMount(mountinfo: string | Buffer): boolean;
/**
 * Whether this process uses the private actuator. Fail closed: an unreadable
 * or unparsable mount table counts as mounted, so an unknown never reaches raw
 * Docker. Only a successful read with no actuator mount selects the legacy
 * path; ENOENT off Linux (no /proc) is a definite "not mounted". Never rejects.
 */
export declare function usesPrivateActuator(options?: {
  read?: (path: string) => Promise<string | Buffer>; platform?: NodeJS.Platform;
}): Promise<boolean>;
/** Synchronous usesPrivateActuator with the same fail-closed rule. */
export declare function usesPrivateActuatorSync(options?: {
  read?: (path: string) => string | Buffer; platform?: NodeJS.Platform;
}): boolean;

/**
 * The client's send targets: the canonical actuator socket, or a .sock this
 * process created under the OS temporary directory (tests). Nothing else.
 */
export declare function isAllowedActuatorSocketPath(socketPath: unknown, temporaryRoot?: string): boolean;

// ─── Wire replies ─────────────────────────────────────────────────────────────

/** A JSON object reply whose shape a portal module owns; the actuator client narrows it. */
export type ActuatorJsonReply = Record<string, unknown>;

export type ActuatorServiceState = { composePresent: boolean; healthy: boolean };
export type ActuatorProjectServices = Record<string, ActuatorServiceState>;
export type ActuatorServiceLogs = { output: string };
export type ActuatorProjectContainer = { ID: string; Name: string; Service: string; State: string; Status: string };
export type ActuatorProjectContainers = { containers: ActuatorProjectContainer[] };
export type ActuatorPortalImage = { image: string; containerId: string };
export type ActuatorSandbox = { containerId: string; name: string; image: string; running: boolean };
export type ActuatorServiceRestart = { service: ActuatorRestartableService; container: string };
export type ActuatorPromoterSweep = { removed: number };
export type ActuatorDoctoolsOperation = { kind: "render" } | { kind: "convert"; from?: string; to: string };
export type ActuatorDoctoolsResult = {
  stdoutBytes: Buffer; stdout: string; stderr: string; exitCode: number; outputLimitExceeded: boolean;
};

/** A bounded stdio session over the actuator stream transport (the
 * RuntimeProcess shape the Workroom launcher and sandbox exec consume). */
export interface ActuatorRuntimeSession {
  write(line: string | Buffer): void;
  onData(listener: (chunk: Buffer) => void): void;
  onStderr(listener: (chunk: Buffer) => void): void;
  onClose(listener: (code: number | null) => void): void;
  end(): void;
  kill(): void;
}

// ─── Portal-side client calls ────────────────────────────────────────────────

export declare function readScopeWriterObservation(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function readScopeWriterRetirement(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function readActuatorProjectServices(options?: SocketOption): Promise<ActuatorProjectServices>;
export declare function readActuatorCiCapacity(options?: SocketOption): Promise<ActuatorJsonReply>;
/** The client refuses any service outside ACTUATOR_SERVICE_LOG_NAMES before sending. */
export declare function readActuatorServiceLogs(service: ActuatorServiceLogName | (string & {}), lines: number,
  options?: SocketOption & { timestamps?: boolean }): Promise<ActuatorServiceLogs>;
export declare function reconcileEndedPreviewRuntimes(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function reconcileActuatorSubstrate(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function reconcileActuatorPromoters(options?: SocketOption): Promise<ActuatorPromoterSweep>;
/** The client sends only a name the actuator's restart catalog admits. */
export declare function restartActuatorService(service: ActuatorRestartableService | (string & {}), options?: SocketOption): Promise<ActuatorServiceRestart>;
export declare function pruneActuatorDockerDisk(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function launchActuatorPromoter(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function runActuatorSourceWriter(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function runActuatorSandboxDb(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function probeActuatorRuntimeProtocol(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function proveActuatorReassessmentCandidate(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function runActuatorDoctoolsImage(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function buildActuatorPromoterCandidate(body: unknown, options: TimedSocketOption): Promise<ActuatorJsonReply>;
export declare function readActuatorProjectContainers(options?: SocketOption): Promise<ActuatorProjectContainers>;
export declare function readActuatorPortalImage(options?: SocketOption): Promise<ActuatorPortalImage>;
export declare function readActuatorSandbox(options?: SocketOption): Promise<ActuatorSandbox>;
export declare function readActuatorReassessmentProof(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function readActuatorDoctoolsHealth(options?: SocketOption): Promise<ActuatorJsonReply>;
export declare function runActuatorDoctools(operation: ActuatorDoctoolsOperation, input: Buffer,
  options: TimedSocketOption & { maxOutputBytes: number }): Promise<ActuatorDoctoolsResult>;
export declare function openActuatorRuntimeSession(owner: unknown, options?: SocketOption): ActuatorRuntimeSession;

// ─── Actuator-side server and Docker observation ─────────────────────────────

// Owners are typed by the actuator entry that supplies them; the server only
// routes to them, so their parameters stay open here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Owner = (...args: any[]) => unknown;
export type ScopeWriterObserverOwners = Partial<Record<
  "observe" | "observeServices" | "observeCiCapacity" | "readRetirement" | "fencePreviews" | "reconcileSubstrate"
  | "readServiceLogs" | "observeProjectContainers" | "observePortalImage" | "observeSandbox" | "sweepPromoters"
  | "openRuntimeSession" | "readReassessmentProof" | "restartService" | "pruneDockerDisk" | "launchPromoter"
  | "sourceWriter" | "promoterCandidate" | "doctoolsImage" | "reassessmentCandidate" | "runtimeProtocol" | "sandboxDb", Owner>>
  & { doctools?: { health?: Owner; limit: Owner; run: Owner } };
export declare function createScopeWriterObserver(owners: ScopeWriterObserverOwners): Server;
export declare function publishActuatorSocket(server: Server, options?: SocketOption & { uid?: number; gid?: number }): Promise<void>;
export declare function resolveActuatorProjectServiceContainer(project: string, service: string, get?: DockerGet): Promise<string>;
export declare function observeActuatorPortalImage(project: string, get?: DockerGet): Promise<ActuatorPortalImage>;
export declare function observeActuatorSandbox(project: string, get?: DockerGet, expectedId?: string): Promise<ActuatorSandbox>;
export declare function observeActuatorProjectContainers(project: string, get?: DockerGet): Promise<ActuatorProjectContainers>;
export declare function restartActuatorProjectService(project: string, service: string, get?: DockerGet,
  restart?: (id: string) => Promise<unknown>): Promise<ActuatorServiceRestart>;
export declare function observeActuatorProjectServices(project: string, get?: DockerGet): Promise<ActuatorProjectServices>;
