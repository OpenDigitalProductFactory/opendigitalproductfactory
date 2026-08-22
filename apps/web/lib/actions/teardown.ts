"use server";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { runPostgresBackup } from "@/lib/operate/backups/postgres-backup-runner";
import { runPostgresTrialRestore } from "@/lib/operate/backups/postgres-trial-restore-runner";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";
import {
  captureActiveSessionBlockers,
  failQuiescenceSwap,
  signalSwapComplete,
  signalSwapStarting,
  startQuiescence,
} from "@/lib/self-upgrade/quiescence";
import { issueTeardownChallenge, verifyTeardownChallenge } from "@/lib/teardown/challenge";
import {
  MIN_HOLD_MS,
  TEARDOWN_SCOPES,
  isDestructiveScope,
  scopeDeletesSource,
  scopeDeletesVolumes,
  validateTeardownEnvelope,
  type TeardownEnvelope,
  type TeardownRecoveryReceipt,
  type TeardownScope,
} from "@/lib/teardown/contract";
import { dispatchTeardown } from "@/lib/teardown/dispatcher";
import {
  buildTeardownPreview,
  readTeardownEvidenceHistory,
  type TeardownPreview,
} from "@/lib/teardown/preview";
import { signTeardownEnvelope } from "@/lib/teardown/signing";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

async function loadTeardownSecret(): Promise<string> {
  const secret = (await readFile("/dpf-state/runtime-transition.secret", "utf8")).trim();
  if (secret.length < 32) throw new Error("teardown_signing_secret_invalid");
  return secret;
}

async function hardBlockers(): Promise<TeardownPreview["blockers"]> {
  const snapshot = await captureActiveSessionBlockers();
  return snapshot.surfaces.filter((surface) => surface.kind === "hard").map((surface) => ({
    surface: surface.surface,
    kind: surface.kind,
    reason: `${surface.detectionClass}:${JSON.stringify(surface.blockerSignal)}`,
  }));
}

function isScope(value: string): value is TeardownScope {
  return (TEARDOWN_SCOPES as readonly string[]).includes(value);
}

type PreviewTeardownPayload = {
  preview: TeardownPreview;
  challenge: string;
  holdMs: number;
  challengeExpiresAt: string;
};

export async function previewInstallationTeardown(scopeInput: string): Promise<ActionResult<PreviewTeardownPayload>> {
  try {
    const { userId } = await requireCapability("manage_platform");
    if (!isScope(scopeInput)) return err("Choose a supported teardown scope.");
    const [config, blockers, secret] = await Promise.all([
      getSelfUpgradeConfig(),
      hardBlockers(),
      loadTeardownSecret(),
    ]);
    const preview = await buildTeardownPreview({ scope: scopeInput, config, blockers });
    const challenge = issueTeardownChallenge({
      runId: preview.runId,
      actorRef: userId,
      scope: preview.scope,
      installPath: preview.installPath,
      backupsPath: preview.backupsPath,
      composeProject: preview.composeProject,
      composeFiles: preview.composeFiles,
      previewDigest: preview.previewDigest,
      salvageDigest: preview.salvageDigest,
    }, secret);
    return ok({
      preview,
      challenge,
      holdMs: isDestructiveScope(scopeInput) ? MIN_HOLD_MS : 0,
      challengeExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  } catch (error) {
    return err(getErrorMessage(error));
  }
}

type ExecuteTeardownPayload = {
  runId: string;
  containerId: string;
  evidencePath: string;
  disconnectExpected: true;
};

export async function executeInstallationTeardown(challengeToken: string): Promise<ActionResult<ExecuteTeardownPayload>> {
  let quiescenceRunId: string | null = null;
  try {
    const { userId } = await requireCapability("manage_platform");
    const secret = await loadTeardownSecret();
    const verified = verifyTeardownChallenge(challengeToken, secret, userId);
    if (!verified.valid) return err(`The teardown confirmation expired or was not completed (${verified.code}). Preview it again.`);
    const challenge = verified.payload;
    const config = await getSelfUpgradeConfig();
    const blockers = await hardBlockers();
    if (blockers.length > 0) {
      return err(`In-flight work must finish first: ${blockers.map((item) => item.surface).join(", ")}.`);
    }
    const preview = await buildTeardownPreview({
      scope: challenge.scope,
      config,
      blockers,
      runId: challenge.runId,
    });
    if (preview.previewDigest !== challenge.previewDigest || preview.salvageDigest !== challenge.salvageDigest || preview.installPath !== challenge.installPath || preview.backupsPath !== challenge.backupsPath) {
      return err("The installation changed after preview. Review the refreshed consequences before continuing.");
    }
    if (scopeDeletesSource(challenge.scope) && !preview.sourceEvidenceSafe) {
      return err("Source removal is blocked because the recovery/evidence path is inside the install directory.");
    }

    const promoter = await (await import("@/lib/self-upgrade/promoter")).ensurePromoterImage(config.promoterImage);
    if (!promoter.ok) return err("The host-side lifecycle runner could not be prepared.");

    let recovery: TeardownRecoveryReceipt | null = null;
    if (scopeDeletesVolumes(challenge.scope)) {
      const backup = await runPostgresBackup({ trigger: "pre-teardown-recovery", composeProject: preview.composeProject });
      if (backup.status !== "ok") return err(backup.error ?? "The recovery backup failed.");
      const backupRow = await prisma.backupRun.findUnique({ where: { id: backup.runId }, select: { sha256: true } });
      if (!backupRow?.sha256) return err("The recovery backup completed without a checksum receipt.");
      const trial = await runPostgresTrialRestore({ sourceBackupRunId: backup.runId });
      if (trial.status !== "ok" || !trial.restoreId) return err(trial.reason ?? "The recovery dump did not pass a trial restore.");
      recovery = {
        backupRunId: backup.runId,
        backupSha256: backupRow.sha256,
        trialRestoreId: trial.restoreId,
        trialStatus: "ok",
      };
    }

    const quiescence = await startQuiescence({
      trigger: "installation-teardown",
      triggerRefId: challenge.runId,
      targetVersion: `teardown:${challenge.scope}`,
      targetBundleHash: preview.previewDigest,
    });
    quiescenceRunId = quiescence.runId;
    const ready = await quiescence.awaitReady();
    if (!ready.ok) {
      return err(`Teardown was not dispatched because the platform could not drain safely${ready.outcome === "deferred" && ready.deferSurface ? ` (${ready.deferSurface})` : ""}.`);
    }

    const now = new Date();
    const issuedAt = Date.parse(challenge.issuedAt);
    const envelope: TeardownEnvelope = {
      schemaVersion: 1,
      kind: "installation-teardown",
      runId: challenge.runId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      scope: challenge.scope,
      actorRef: userId,
      installPath: preview.installPath,
      backupsPath: preview.backupsPath,
      composeProject: preview.composeProject,
      composeFiles: preview.composeFiles,
      previewDigest: preview.previewDigest,
      salvageDigest: preview.salvageDigest,
      recovery,
      confirmation: isDestructiveScope(challenge.scope)
        ? { mode: "pointer-hold", challengeId: createHash("sha256").update(challengeToken).digest("hex"), heldForMs: Date.now() - issuedAt }
        : { mode: "non-destructive" },
    };
    const envelopeValidation = validateTeardownEnvelope(envelope);
    if (!envelopeValidation.valid) throw new Error(envelopeValidation.code);
    const signature = signTeardownEnvelope(envelope, secret);
    await signalSwapStarting(quiescenceRunId);
    const dispatched = await dispatchTeardown({
      envelope,
      signature,
      promoterImage: config.promoterImage?.trim() || "dpf-promoter",
      stateDirHostPath: process.env.DPF_STATE_DIR_HOST ?? "",
    });
    // The sibling waits briefly before compose-down. Close the coordinator now
    // so no new work is admitted into a drain that can never receive a callback
    // after the portal stops.
    await signalSwapComplete(quiescenceRunId);
    return ok({
      runId: challenge.runId,
      containerId: dispatched.containerId,
      evidencePath: `${preview.backupsPath}/teardown/${challenge.runId}/evidence.json`,
      disconnectExpected: true,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (quiescenceRunId) await failQuiescenceSwap(quiescenceRunId, message).catch(() => {});
    return err(message);
  }
}

export async function listInstallationTeardownEvidence() {
  await requireCapability("manage_platform");
  return readTeardownEvidenceHistory();
}
