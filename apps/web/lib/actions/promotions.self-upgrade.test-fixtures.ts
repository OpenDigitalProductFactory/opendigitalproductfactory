import type { ReleaseInstallContext } from "@/lib/self-upgrade/release-target";

export const mockSession = {
  user: {
    id: "user-ops-1",
    email: "ops@test.com",
    platformRole: "OPS-000",
    isSuperuser: false,
  },
};

export const mockConfig = {
  enabled: true,
  channel: "stable",
  checkIntervalHours: 24,
  healthTarget: 100,
  maintenanceWindows: [],
};

export const consumerReleaseSupport = {
  configuredEnabled: true,
  supported: true,
  enabled: true,
  targetKind: "release-artifact",
  reason: "enabled",
  message: null,
} as const;

export const consumerReleaseContext = {
  installMode: "consumer",
  imageTag: "v1.0.0",
  channelTag: "latest",
  installPath: "D:\\DPF",
  composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
  ghcrOwner: "opendigitalproductfactory",
} satisfies ReleaseInstallContext;

export const mockRun = {
  id: "cuid-1",
  runId: "SUR-AAAA0001",
  status: "succeeded",
  trigger: "scheduled",
  currentSha: "abc1234",
  targetSha: "def5678",
  deployedSha: "def5678",
  startedAt: new Date("2026-05-20T02:00:00Z"),
  completedAt: new Date("2026-05-20T02:05:00Z"),
  completionEvidence: null,
  failureLog: null,
  createdAt: new Date("2026-05-20T02:00:00Z"),
  updatedAt: new Date("2026-05-20T02:05:00Z"),
};

export const mockRunRow1 = {
  runId: "SUR-AAAA0001",
  status: "succeeded",
  trigger: "scheduled",
  currentSha: "abc1234",
  targetSha: "def5678",
  deployedSha: "def5678",
  startedAt: new Date("2026-05-20T02:00:00Z"),
  completedAt: new Date("2026-05-20T02:05:00Z"),
  completionEvidence: { recoveryPoint: { status: "ok" } },
  failureLog: null,
  createdAt: new Date("2026-05-20T02:00:00Z"),
};

export const mockRunRow2 = {
  runId: "SUR-BBBB0002",
  status: "failed",
  trigger: "manual",
  currentSha: "abc1234",
  targetSha: "def5678",
  deployedSha: null,
  startedAt: new Date("2026-05-19T02:00:00Z"),
  completedAt: new Date("2026-05-19T02:01:00Z"),
  completionEvidence: null,
  failureLog: "promoter exited with code 1",
  createdAt: new Date("2026-05-19T02:00:00Z"),
};

export const recoverableRun = {
  ...mockRun,
  runId: "SUR-6B312E24",
  status: "failed",
  admissionFingerprint: "admission-fingerprint",
  dispatchStatus: "failed",
  targetTag: "v2026.08.29-source-free-upgrade-reconciliation.1",
  dispatchAttemptCount: 0,
  dispatchAcknowledgedAt: null,
  dispatchEventIds: [],
};
