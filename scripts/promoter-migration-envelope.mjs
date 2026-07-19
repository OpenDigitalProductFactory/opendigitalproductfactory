#!/usr/bin/env node
// Promoter-only entrypoint for the readiness-to-promotion install-state handoff.
//
// Lives OUTSIDE scripts/lib/transition-signing.mjs on purpose. That module is
// imported by the portal (instrumentation, queue functions, server components),
// so Next.js bundles it — and anything it reaches. Pulling the installer
// modules and the capability catalog in there drags promoter-only code into the
// web bundle and breaks the production build. The signing primitives stay pure
// and shared; the filesystem + projection work lives here, where only the
// promoter container ever runs it.
//
// Behaviour:
//   caller sent a handoff  -> verify it, exactly as before
//   caller sent nothing    -> self-issue from the mounted state (BI-76651B7B),
//                             because an N-1 portal has no code to produce one
//                             and refusing it wedges the install for good
//   caller sent one half   -> fail closed; that is a broken caller, not a legacy one
//
// Prints the envelope JSON on success. Exits 78 on any refusal, matching the
// promoter's other governed-refusal codes.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { issueSelfSignedMigrationEnvelope, verifyInstallStateMigrationEnvelope } from "./lib/transition-signing.mjs";
import { resolveHostIdentity } from "./installer/resolve-host-identity.mjs";
import { projectInstallState } from "./installer/migrate-install-state.mjs";

const HERE = new URL("./", import.meta.url);

/**
 * Build the envelope for a caller that never sent one, by recomputing the same
 * projection readiness produces from the install-state the promoter mounts.
 */
export async function selfIssueFromMountedState({ stateBytes, sourceHash, secret, now, env = process.env }) {
  const catalog = JSON.parse(await readFile(new URL("./capability-service-catalog.generated.json", HERE), "utf8"));
  const state = JSON.parse(stateBytes.toString("utf8").replace(/^﻿/, ""));
  const hostIdentity = resolveHostIdentity({ state, env });
  const projection = await projectInstallState({ bytes: stateBytes, hostIdentity, catalog });

  return issueSelfSignedMigrationEnvelope({
    secret,
    // The deployed caller sends no DPF_PROMOTER_DIGEST either; the target SHA
    // identifies the candidate just as well when issuer and verifier are the
    // same container.
    promoterDigest: env.DPF_PROMOTER_DIGEST ?? `target-sha:${env.PROMOTE_TARGET_SHA ?? "unknown"}`,
    now,
    sourceHash,
    projectionHash: projection.projectionHash,
    fromSchemaVersion: state.schemaVersion ?? 1,
    toSchemaVersion: projection.projectedState.schemaVersion,
    hostIdentity: { platform: hostIdentity.platform, arch: hostIdentity.arch, provenance: hostIdentity.provenance },
  });
}

export async function resolveMigrationEnvelope({ env = process.env, now = Date.now() } = {}) {
  // Caller-protocol check first: a half handoff is malformed regardless of what
  // is on disk, and should not be reported as a missing-file error.
  const rawEnvelope = env.DPF_INSTALL_STATE_MIGRATION_ENVELOPE ?? "";
  const rawSignature = env.DPF_INSTALL_STATE_MIGRATION_SIGNATURE ?? "";
  if (Boolean(rawEnvelope) !== Boolean(rawSignature)) throw new Error("install_state_migration_handoff_incomplete");
  const carried = Boolean(rawEnvelope);

  const secret = (await readFile(env.DPF_RUNTIME_TRANSITION_SECRET_FILE ?? "/run/secrets/dpf-runtime-transition", "utf8")).trim();
  const stateBytes = await readFile(`${env.DPF_PROMOTER_STATE_DIR ?? "/dpf-state"}/install-state.json`);
  const sourceHash = createHash("sha256").update(stateBytes).digest("hex");

  const { envelope, signature } = carried
    ? { envelope: JSON.parse(Buffer.from(rawEnvelope, "base64url").toString("utf8")), signature: rawSignature }
    : await selfIssueFromMountedState({ stateBytes, sourceHash, secret, now, env });

  verifyInstallStateMigrationEnvelope(envelope, signature, secret, {
    runId: carried ? env.DPF_SELF_UPGRADE_RUN_ID : envelope.runId,
    promoterDigest: carried ? env.DPF_PROMOTER_DIGEST : envelope.promoterDigest,
    sourceHash,
    now,
  });
  return envelope;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) {
  try {
    process.stdout.write(`${JSON.stringify(await resolveMigrationEnvelope())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "install_state_envelope_invalid"}\n`);
    process.exitCode = 78;
  }
}
