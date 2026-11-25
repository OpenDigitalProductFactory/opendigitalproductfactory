import { namespaceMessages } from "@dpf/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { UploadsBackupReadiness } from "@/lib/operate/backups/readiness";
import { BackupsClient } from "./BackupsClient";

vi.mock("@/lib/actions/backups", () => ({}));
vi.mock("@/lib/actions/backup-restore", () => ({}));

const emptyUploads = {
  target: "uploads",
  scheduledJob: null,
  lastRun: null,
  lastSuccess: null,
  retention: { daily: 7, weekly: 4, monthly: 12 },
  retainedCount: 0,
  retainedBytes: 0,
  storagePath: "/backups/uploads/",
  failuresInLastThreeRuns: 0,
  trialRestore: null,
  openCorruptionAlert: null,
  capturePair: { status: "not-captured" },
  pairedRestore: { status: "no-unfinished" },
} satisfies UploadsBackupReadiness;

function render(uploads: UploadsBackupReadiness): string {
  return renderToStaticMarkup(
    <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>
      <BackupsClient
        initialReadiness={{ postgres: { ...emptyUploads, target: "postgres" }, uploads, capabilityOwned: [] }}
        initialPgRuns={[]}
        initialRestoreRuns={[]}
      />
    </MessagesProvider>,
  );
}

describe("uploads backup readiness operator copy", () => {
  it("separates the paired capture from the latest run and a passing trial", () => {
    const html = render({
      ...emptyUploads,
      lastRun: {
        id: "latest-uploads", status: "failed", startedAt: "2026-11-25T03:00:00Z",
        finishedAt: null, sizeBytes: null, durationMs: null, trigger: "scheduled",
      },
      capturePair: { status: "paired", uploadsRunId: "prior-uploads", postgresRunId: "prior-db" },
    });
    expect(html).toContain("Last uploads run");
    expect(html).toContain("Failed");
    expect(html).toContain("Earlier uploads run paired with Postgres");
    expect(html).toContain("Capture only");
    expect(html).not.toContain("Run Uploads backup now");
  });

  it("keeps a partial restore and the next action visible without opening a control", () => {
    const html = render({
      ...emptyUploads,
      pairedRestore: { status: "unfinished", operations: [{ operationId: "op-1", stage: "uploads-started" }] },
    });
    expect(html).toContain("Postgres restored. Uploads may be incomplete.");
    expect(html).toContain("Follow the disaster recovery runbook before resuming service.");
  });

  it("shows no uploads runs and does not interpret an unreadable journal as clear", () => {
    const html = render({ ...emptyUploads, pairedRestore: { status: "unreadable" } });
    expect(html).toContain("No runs yet");
    expect(html).toContain("Could not check the paired restore journal");
    expect(html).not.toContain("No unfinished restore found");
  });
});
