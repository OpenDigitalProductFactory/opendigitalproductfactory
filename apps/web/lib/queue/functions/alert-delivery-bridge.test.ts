import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAlertSources: vi.fn(),
  upsert: vi.fn(),
  resolve: vi.fn(),
  findMany: vi.fn(),
  isVoiceNarrationEnabled: vi.fn(),
  notify: vi.fn(),
  resolveRecipient: vi.fn(),
}));

vi.mock("@/lib/attention/notify-live", () => ({
  notifyAttentionLive: mocks.notify,
  resolveOperatorRecipient: mocks.resolveRecipient,
}));

vi.mock("@/lib/observability/alert-sources", () => ({
  fetchAlertSources: mocks.fetchAlertSources,
}));
vi.mock("@/lib/observability/health-alert-issue", () => ({
  upsertHealthAlertIssue: mocks.upsert,
  resolveHealthAlertIssue: mocks.resolve,
}));
vi.mock("@/lib/voice-synthesis/service-status", () => ({
  isVoiceNarrationEnabled: mocks.isVoiceNarrationEnabled,
}));
vi.mock("@dpf/db", () => ({
  prisma: { portfolioQualityIssue: { findMany: mocks.findMany } },
}));

import { runAlertDeliveryScan } from "./alert-delivery-bridge";

type AlertState = "firing" | "pending";
function alert(name: string, source: "prometheus" | "loki-ruler", state: AlertState, service?: string) {
  return {
    labels: { alertname: name, ...(service ? { service } : {}) },
    annotations: { summary: name },
    state,
    sourceSystem: source,
    activeAt: "2026-06-15T02:00:00Z",
  };
}
// Mirror healthAlertIssueKey so reconciliation key-matching is realistic.
function keyOf(name: string, service?: string) {
  return service ? `health-alert-${name}:${service}` : `health-alert-${name}`;
}

const BOTH_UP = { prometheus: true, "loki-ruler": true };

describe("runAlertDeliveryScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isVoiceNarrationEnabled.mockResolvedValue(true);
    // Default: upsert returns the deterministic key for the alert it received.
    mocks.upsert.mockImplementation(async (_db: unknown, a: { labels: Record<string, string> }) =>
      keyOf(a.labels.alertname, a.labels.service),
    );
    mocks.findMany.mockResolvedValue([]);
    mocks.resolveRecipient.mockResolvedValue("owner-1");
    mocks.notify.mockResolvedValue(undefined);
  });

  // The last mile that was missing when WindowsHostDiskCritical sat open for
  // twelve days (2026-07-19 → the 2026-07-31 disk-full outage) with no
  // human-facing signal: the row existed and projected into the inbox, but
  // nothing ever pushed it.
  describe("operator notification", () => {
    it("pushes a newly-opened alert to the operator", async () => {
      mocks.fetchAlertSources.mockResolvedValue({
        alerts: [alert("WindowsHostDiskCritical", "prometheus", "firing")],
        reached: BOTH_UP,
      });

      const res = await runAlertDeliveryScan();

      expect(res.notified).toBe(1);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
      const pushed = mocks.notify.mock.calls[0][0];
      expect(pushed.source).toBe("platform-health");
      expect(pushed.userId).toBe("owner-1");
      expect(pushed.itemKey).toBe(keyOf("WindowsHostDiskCritical"));
      expect(pushed.deepLink).toBe("/ops/health");
    });

    it("does NOT re-notify an alert that is already open", async () => {
      // The row is already open from an earlier cycle — it is being re-confirmed,
      // not newly detected. Re-notifying here is exactly what would turn a
      // 5-minute cron into inbox noise once the first notification is read.
      mocks.findMany.mockResolvedValue([
        { issueKey: keyOf("WindowsHostDiskCritical"), details: { source: "prometheus" } },
      ]);
      mocks.fetchAlertSources.mockResolvedValue({
        alerts: [alert("WindowsHostDiskCritical", "prometheus", "firing")],
        reached: BOTH_UP,
      });

      const res = await runAlertDeliveryScan();

      expect(res.delivered).toBe(1); // still refreshed
      expect(res.notified).toBe(0);  // but not re-pushed
      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it("marks critical alerts high-risk and warnings bounded-write", async () => {
      const critical = {
        ...alert("WindowsHostDiskCritical", "prometheus", "firing"),
        labels: { alertname: "WindowsHostDiskCritical", severity: "critical" },
      };
      const warning = {
        ...alert("WindowsHostDiskPressure", "prometheus", "firing"),
        labels: { alertname: "WindowsHostDiskPressure", severity: "warning" },
      };
      mocks.fetchAlertSources.mockResolvedValue({ alerts: [critical, warning], reached: BOTH_UP });

      await runAlertDeliveryScan();

      expect(mocks.notify.mock.calls[0][0].riskClass).toBe("high-risk");
      expect(mocks.notify.mock.calls[1][0].riskClass).toBe("bounded-write");
    });

    it("skips notification when no operator resolves, without failing delivery", async () => {
      mocks.resolveRecipient.mockResolvedValue(null);
      mocks.fetchAlertSources.mockResolvedValue({
        alerts: [alert("PostgresDown", "prometheus", "firing")],
        reached: BOTH_UP,
      });

      const res = await runAlertDeliveryScan();

      expect(res.delivered).toBe(1); // delivery still succeeded
      expect(res.notified).toBe(0);
      expect(mocks.notify).not.toHaveBeenCalled();
    });

    it("does not notify when both sources are unreachable", async () => {
      mocks.fetchAlertSources.mockResolvedValue({
        alerts: [],
        reached: { prometheus: false, "loki-ruler": false },
      });

      const res = await runAlertDeliveryScan();

      expect(res.sourcesUnreachable).toBe(true);
      expect(res.notified).toBe(0);
      expect(mocks.notify).not.toHaveBeenCalled();
    });
  });

  it("delivers one issue per FIRING alert and ignores pending ones", async () => {
    mocks.fetchAlertSources.mockResolvedValue({
      alerts: [
        alert("PostgresDown", "prometheus", "firing"),
        alert("ContainerErrorLogSpike", "loki-ruler", "pending", "sandbox"), // still in `for:` window
      ],
      reached: BOTH_UP,
    });

    const res = await runAlertDeliveryScan();

    expect(res.delivered).toBe(1);
    expect(res.firing).toBe(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][1].labels.alertname).toBe("PostgresDown");
  });

  it("flags a VoiceServiceDown alert as detector self-distrust when narration is disabled", async () => {
    mocks.isVoiceNarrationEnabled.mockResolvedValue(false);
    mocks.fetchAlertSources.mockResolvedValue({
      alerts: [alert("VoiceServiceDown", "prometheus", "firing")],
      reached: BOTH_UP,
    });
    mocks.findMany.mockResolvedValue([
      { issueKey: keyOf("VoiceServiceDown"), details: { source: "prometheus" } },
    ]);

    const res = await runAlertDeliveryScan();

    expect(res.delivered).toBe(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][1].labels).toMatchObject({
      alertname: "DetectorSelfDistrust",
      service: "VoiceServiceDown",
      contradicted_alert: "VoiceServiceDown",
      detector_self_distrust: "true",
    });
    // The original VoiceServiceDown key is no longer considered firing, so a
    // stale phantom issue from the same source is allowed to resolve.
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), keyOf("VoiceServiceDown"));
  });

  it("resolves an open issue whose alert cleared, from a source it reached", async () => {
    mocks.fetchAlertSources.mockResolvedValue({
      alerts: [alert("ContainerErrorLogStorm", "loki-ruler", "firing", "sandbox")],
      reached: BOTH_UP,
    });
    mocks.findMany.mockResolvedValue([
      { issueKey: keyOf("ContainerErrorLogStorm", "sandbox"), details: { source: "loki-ruler" } }, // still firing -> keep
      { issueKey: keyOf("PostgresDown"), details: { source: "prometheus" } },                       // cleared -> resolve
    ]);

    const res = await runAlertDeliveryScan();

    expect(res.delivered).toBe(1);
    expect(res.resolved).toBe(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][1]).toBe(keyOf("PostgresDown"));
  });

  it("NEVER resolves issues from an unreached source (no false-resolve)", async () => {
    mocks.fetchAlertSources.mockResolvedValue({
      alerts: [alert("ContainerErrorLogSpike", "loki-ruler", "firing", "portal")],
      reached: { prometheus: false, "loki-ruler": true }, // Prometheus blind this cycle
    });
    mocks.findMany.mockResolvedValue([
      { issueKey: keyOf("PostgresDown"), details: { source: "prometheus" } },        // unreached source -> keep
      { issueKey: keyOf("ContainerErrorLogSpike", "stt"), details: { source: "loki-ruler" } }, // reached + cleared -> resolve
    ]);

    const res = await runAlertDeliveryScan();

    expect(res.resolved).toBe(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][1]).toBe(keyOf("ContainerErrorLogSpike", "stt"));
  });

  it("never auto-resolves webhook-owned rows", async () => {
    mocks.fetchAlertSources.mockResolvedValue({ alerts: [], reached: BOTH_UP });
    mocks.findMany.mockResolvedValue([
      { issueKey: "health-alert-ManualThing", details: { source: "webhook" } },
    ]);

    const res = await runAlertDeliveryScan();

    expect(res.resolved).toBe(0);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("does nothing (and resolves nothing) when both sources are unreachable", async () => {
    mocks.fetchAlertSources.mockResolvedValue({
      alerts: [],
      reached: { prometheus: false, "loki-ruler": false },
    });

    const res = await runAlertDeliveryScan();

    expect(res.sourcesUnreachable).toBe(true);
    expect(res.delivered).toBe(0);
    expect(res.resolved).toBe(0);
    expect(mocks.findMany).not.toHaveBeenCalled(); // never touch the DB to resolve
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("caps delivery under a pathological storm fan-out", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      alert("ContainerErrorLogStorm", "loki-ruler", "firing", `svc-${i}`),
    );
    mocks.fetchAlertSources.mockResolvedValue({ alerts: many, reached: BOTH_UP });

    const res = await runAlertDeliveryScan();

    expect(res.firing).toBe(250);
    expect(res.delivered).toBe(200); // MAX_ALERTS_PER_CYCLE default
    expect(res.capped).toBe(true);
  });
});
