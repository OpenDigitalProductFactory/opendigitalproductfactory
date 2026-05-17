/**
 * Voice Slice 2 — restore wizard public types.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6
 */

export interface RestoreImpactPreview {
  /** The BackupRun.id being restored. */
  sourceBackupRunId: string;
  /** Source dump's finishedAt timestamp (UTC ISO). */
  sourceFinishedAt: string | null;
  /** Source dump size in bytes. */
  sourceSizeBytes: number | null;
  /** Recorded sha256 — UI displays for forensic comparison. */
  sourceSha256: string | null;
  /** How long ago the source dump was taken, in minutes. */
  sourceAgeMinutes: number;
  /**
   * Free-form human summary of estimated impact. UI renders this verbatim
   * — keep operator-friendly, no shell terms.
   */
  impactSummary: string;
  /** True when the file is missing from disk (rare — should not happen for non-pruned runs). */
  fileMissing: boolean;
  /** True when the on-disk sha256 does not match BackupRun.sha256 (corruption). */
  sha256Mismatch: boolean;
  /**
   * Cross-version warning. Spec §10 open question: dump may have been taken
   * from a different DPF version. We surface it but do NOT block; operators
   * recovering from a wipe sometimes need to restore older dumps.
   */
  versionWarning: string | null;
}

export interface RestoreRunListItem {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  sourceBackupRunId: string;
  /** ISO timestamp of the source dump (when it was taken). */
  sourceFinishedAt: string | null;
  preRestoreBackupRunId: string | null;
  initiatedByUserId: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}

/** Confirmation text the operator must type, character-for-character. */
export const RESTORE_CONFIRMATION_TEXT = "RESTORE";
