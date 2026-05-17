"use client";

import { useState, useTransition } from "react";

import {
  confirmRestoreAction,
  type ConfirmRestoreResult,
} from "@/lib/actions/backup-restore";
import { RESTORE_CONFIRMATION_TEXT } from "@/lib/operate/backups/restore-types";
import type { RestoreImpactPreview } from "@/lib/operate/backups/restore-types";

interface Props {
  preview: RestoreImpactPreview;
  onClose: () => void;
  onConfirmed: (result: ConfirmRestoreResult) => void;
}

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTimestamp(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

export function RestoreConfirmModal({ preview, onClose, onConfirmed }: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blockedByIntegrity = preview.fileMissing || preview.sha256Mismatch;
  const confirmationValid = confirmation === RESTORE_CONFIRMATION_TEXT;
  const canConfirm = !blockedByIntegrity && confirmationValid && !pending;

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmRestoreAction(
        preview.sourceBackupRunId,
        confirmation,
      );
      if (!result.ok) {
        setError(result.error ?? "Restore failed.");
        return;
      }
      onConfirmed(result);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={pending ? undefined : onClose}
      style={{ background: "rgba(0, 0, 0, 0.6)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[640px] max-w-[95vw] rounded p-6 max-h-[90vh] overflow-y-auto"
        style={{
          background: "var(--dpf-surface)",
          border: "1px solid var(--dpf-border)",
        }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--dpf-text)]">
              Restore from backup
            </h2>
            <p className="text-xs text-[var(--dpf-muted)] mt-1">
              This action replaces the current database with the contents of
              the selected dump.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
          >
            Close
          </button>
        </div>

        {/* ── Impact summary ───────────────────────────────────────────── */}
        <div
          className="rounded p-4 mb-4 text-sm space-y-2"
          style={{
            background: "var(--dpf-bg)",
            border: "1px solid var(--dpf-border)",
          }}
        >
          <div className="flex justify-between gap-3">
            <span className="text-[var(--dpf-muted)] text-xs uppercase">
              Source taken
            </span>
            <span className="text-[var(--dpf-text)]">
              {formatTimestamp(preview.sourceFinishedAt)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--dpf-muted)] text-xs uppercase">
              Size
            </span>
            <span className="text-[var(--dpf-text)]">
              {formatBytes(preview.sourceSizeBytes)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[var(--dpf-muted)] text-xs uppercase">
              Age
            </span>
            <span className="text-[var(--dpf-text)]">
              {preview.sourceAgeMinutes} minute
              {preview.sourceAgeMinutes === 1 ? "" : "s"} ago
            </span>
          </div>
          {preview.sourceSha256 && (
            <div className="flex justify-between gap-3">
              <span className="text-[var(--dpf-muted)] text-xs uppercase">
                Checksum
              </span>
              <span
                className="text-[10px] font-mono text-[var(--dpf-muted)]"
                title={preview.sourceSha256}
              >
                {preview.sourceSha256.slice(0, 16)}…
              </span>
            </div>
          )}
        </div>

        {/* ── Impact narrative ─────────────────────────────────────────── */}
        <div
          className="rounded p-3 mb-4 text-sm"
          style={{
            background: blockedByIntegrity
              ? "rgba(248, 113, 113, 0.15)"
              : "rgba(251, 191, 36, 0.12)",
            color: blockedByIntegrity ? "#f87171" : "var(--dpf-text)",
            border: `1px solid ${blockedByIntegrity ? "rgba(248, 113, 113, 0.3)" : "rgba(251, 191, 36, 0.3)"}`,
          }}
        >
          {preview.impactSummary}
        </div>

        {preview.versionWarning && (
          <div
            className="rounded p-3 mb-4 text-xs"
            style={{
              background: "rgba(251, 191, 36, 0.12)",
              color: "#fbbf24",
              border: "1px solid rgba(251, 191, 36, 0.3)",
            }}
          >
            ⚠️ {preview.versionWarning}
          </div>
        )}

        {/* ── Typed confirmation ───────────────────────────────────────── */}
        {!blockedByIntegrity && (
          <div className="mb-4">
            <label
              htmlFor="restore-confirm"
              className="block text-xs font-medium uppercase mb-2"
              style={{ color: "var(--dpf-muted)" }}
            >
              Type{" "}
              <span
                className="font-mono text-[var(--dpf-text)]"
                style={{ background: "var(--dpf-bg)", padding: "0 4px" }}
              >
                {RESTORE_CONFIRMATION_TEXT}
              </span>{" "}
              to confirm
            </label>
            <input
              id="restore-confirm"
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={pending}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded font-mono text-sm"
              style={{
                background: "var(--dpf-bg)",
                color: "var(--dpf-text)",
                border: `1px solid ${
                  confirmation === "" || confirmationValid
                    ? "var(--dpf-border)"
                    : "rgba(248, 113, 113, 0.5)"
                }`,
              }}
              placeholder={RESTORE_CONFIRMATION_TEXT}
            />
            {confirmation !== "" && !confirmationValid && (
              <p
                className="text-xs mt-1"
                style={{ color: "#f87171" }}
              >
                Confirmation must match exactly (case-sensitive).
              </p>
            )}
          </div>
        )}

        {error && (
          <div
            className="rounded p-3 mb-4 text-sm"
            style={{
              background: "rgba(248, 113, 113, 0.15)",
              color: "#f87171",
              border: "1px solid rgba(248, 113, 113, 0.3)",
            }}
          >
            {error}
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 text-sm rounded transition-colors disabled:opacity-50"
            style={{
              background: "transparent",
              color: "var(--dpf-text)",
              border: "1px solid var(--dpf-border)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{
              background: canConfirm ? "#f87171" : "var(--dpf-border)",
              color: canConfirm ? "#fff" : "var(--dpf-muted)",
              cursor: canConfirm ? "pointer" : "not-allowed",
            }}
          >
            {pending ? "Restoring…" : "Restore"}
          </button>
        </div>
      </div>
    </div>
  );
}
