// The LDAP listener's runtime entrypoint (EP-24741BBF · BI-A91004A7).
//
// `createLdapServer` BUILDS a listener. This module decides whether an install
// SERVES one, and that distinction is the whole reason the file exists: before
// it, the protocol was implemented, covered by 78 unit tests, and exercised by
// six real `ldapsearch` runs — and no install served LDAP, because every one of
// those tests started its own listener. A functional test that provisions its
// own runtime proves the code works, not that the product does.
//
// Three states, and deliberately no fourth:
//
//   disabled   — the operator has not turned it on. Nothing is bound.
//   listening  — a client can bind right now, on this port.
//   refused    — it was turned on and could NOT start, with the reason.
//
// "Refused" exists so the failure is never silence. A directory that is
// configured-but-dead must not look the same as one that was never asked for;
// the operator surface renders all three, so "off" is a statement rather than
// an absence.

import type { Server } from "node:tls";

import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import type { DirectoryProjection } from "../projection";
import { buildDirectoryProjection } from "../projection";
import { createBindVerifier } from "./bind";
import type { BindVerifier } from "./server";
import { createLdapServer } from "./server";
import { loadLdapTlsMaterial } from "./tls";

/** LDAPS. RFC 8314 §3 deprecates StartTLS-on-389 in favour of implicit TLS. */
export const LDAP_DEFAULT_PORT = 636;

export const LDAP_ENABLED_ENV = "DPF_LDAP_ENABLED";
export const LDAP_PORT_ENV = "DPF_LDAP_PORT";
export const LDAP_REQUIRE_CLIENT_CERTIFICATE_ENV = "DPF_LDAP_REQUIRE_CLIENT_CERTIFICATE";

export type LdapListenerStatus =
  | { state: "disabled"; detail: string }
  | { state: "listening"; port: number; detail: string }
  | { state: "refused"; reason: string; detail: string };

type Env = Record<string, string | undefined>;

/** Whether the operator has asked this install to serve LDAP. Off by default. */
export function isLdapListenerEnabled(env: Env = process.env): boolean {
  return envFlagEnabled(env, LDAP_ENABLED_ENV);
}

export function requiresClientCertificate(env: Env = process.env): boolean {
  return envFlagEnabled(env, LDAP_REQUIRE_CLIENT_CERTIFICATE_ENV);
}

/**
 * Resolve the listen port, rejecting anything that is not a usable TCP port.
 *
 * An unparseable port is refused rather than silently replaced by the default:
 * an operator who typed `DPF_LDAP_PORT=6360 ` and got 636 would be serving the
 * directory somewhere they did not choose.
 */
export function resolveLdapListenerPort(
  env: Env = process.env,
): { port: number } | { error: string } {
  const raw = env[LDAP_PORT_ENV]?.trim();
  if (!raw) return { port: LDAP_DEFAULT_PORT };
  if (!/^\d+$/.test(raw)) {
    return { error: `${LDAP_PORT_ENV} must be a whole number, got "${raw}"` };
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    return { error: `${LDAP_PORT_ENV} must be between 1 and 65535, got ${port}` };
  }
  return { port };
}

/** Bind the server to a port, resolving only once it is actually listening. */
function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

let current: LdapListenerStatus = {
  state: "disabled",
  detail: `Off. Set ${LDAP_ENABLED_ENV}=1 to serve LDAP.`,
};
let running: Server | null = null;

/** The listener's status for the operator surface. Never throws. */
export function getLdapListenerStatus(): LdapListenerStatus {
  return current;
}

export type StartLdapListenerOptions = {
  env?: Env;
  logger?: Pick<Console, "log" | "error">;
  loadTls?: typeof loadLdapTlsMaterial;
  loadProjection?: () => Promise<DirectoryProjection>;
  verifyBind?: BindVerifier;
  createServer?: typeof createLdapServer;
};

/**
 * Start the listener if it is enabled and can be served.
 *
 * Never throws, and never takes the portal down with it: a directory that
 * cannot start is a serious misconfiguration, but the install still serves
 * everything else, so the failure is reported rather than fatal. What it will
 * NOT do is downgrade — absent org PKI it refuses, exactly as
 * `loadLdapTlsMaterial` intends, because a directory that quietly self-signs
 * is invisible to every client that trusts it.
 */
export async function startLdapListener(
  options: StartLdapListenerOptions = {},
): Promise<LdapListenerStatus> {
  const {
    env = process.env,
    logger = console,
    loadTls = loadLdapTlsMaterial,
    loadProjection = () => buildDirectoryProjection(),
    verifyBind = createBindVerifier(),
    createServer = createLdapServer,
  } = options;

  if (!isLdapListenerEnabled(env)) {
    current = {
      state: "disabled",
      detail: `Off. Set ${LDAP_ENABLED_ENV}=1 to turn it on.`,
    };
    logger.log("[ldap] Listener disabled; no port bound.");
    return current;
  }

  const refuse = (reason: string): LdapListenerStatus => {
    current = {
      state: "refused",
      reason,
      detail: `Turned on, but it could not start. Nothing is bound.`,
    };
    logger.error(`[ldap] Refusing to serve the directory: ${reason}`);
    return current;
  };

  const resolvedPort = resolveLdapListenerPort(env);
  if ("error" in resolvedPort) return refuse(resolvedPort.error);
  const { port } = resolvedPort;

  let tls;
  try {
    tls = loadTls();
  } catch (error) {
    return refuse(getErrorMessage(error));
  }

  // Build the tree once before binding. The alternative — bind first, discover
  // at the first search that there is no Organization to publish — turns a
  // startup misconfiguration into a per-client mystery.
  try {
    await loadProjection();
  } catch (error) {
    return refuse(
      `the published tree could not be built: ${getErrorMessage(error)}`,
    );
  }

  const server = createServer({
    tls,
    loadProjection,
    verifyBind,
    requireClientCertificate: requiresClientCertificate(env),
  });

  try {
    await listen(server, port);
  } catch (error) {
    server.close();
    return refuse(
      `could not bind port ${port}: ${getErrorMessage(error)}`,
    );
  }

  running = server;
  current = {
    state: "listening",
    port,
    detail: `Serving on port ${port} with your own CA.`,
  };
  logger.log(`[ldap] Serving the directory over LDAPS on port ${port}.`);
  return current;
}

/** Stop the listener, if one is running. Safe to call when none is. */
export async function stopLdapListener(): Promise<void> {
  const server = running;
  running = null;
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  current = {
    state: "disabled",
    detail: "Stopped.",
  };
}

/** Test seam: forget any listener state between cases. */
export function resetLdapListenerStateForTest(): void {
  running = null;
  current = {
    state: "disabled",
    detail: `Off. Set ${LDAP_ENABLED_ENV}=1 to serve LDAP.`,
  };
}
