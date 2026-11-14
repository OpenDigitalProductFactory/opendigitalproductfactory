// @vitest-environment jsdom
// BI-E7974C18 — the "Connected agent clients" section on /ops/self-upgrade.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRequire } from "node:module";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { ConnectedAgentClients } from "./ConnectedAgentClients";
import type { ConnectedClientRow, ConnectedClientsView } from "@/lib/agent-toolchain/connected-clients";

// The repository's Vite react-dom alias is an exact package file, so resolve
// the client entry through Node rather than that prefix alias.
const { hydrateRoot } = createRequire(import.meta.url)("react-dom/client") as typeof import("react-dom/client");

const now = new Date("2026-10-13T12:00:00Z");
const release = { packVersion: "0.4.0", fingerprint: "1111111111aa" };

function content(view: ConnectedClientsView | null, sinceMessage?: string) {
  const upgrade = { ...namespaceMessages("en-US", "upgrade") };
  if (sinceMessage) upgrade["agentClients.hostAgentSince"] = sinceMessage;
  return (
    <MessagesProvider locale="en-US" messages={{ upgrade }}>
      <ConnectedAgentClients view={view} now={now} />
    </MessagesProvider>
  );
}

function render(view: ConnectedClientsView | null) {
  return renderToStaticMarkup(content(view));
}

function hostFailure(status: NonNullable<ConnectedClientRow["hostAgent"]>["status"], since: Date | null): ConnectedClientsView {
  return { release, truncated: false, clients: [{
    credentialRef: "oauth:hydration-fixture", product: "Codex", probable: false,
    authMode: "oauth", standing: "stale", loadedVersion: "0.3.0",
    loadedFingerprint: null, lastSeen: now, behind: true, reasons: [],
    hostAgent: { status, code: null, since },
  }] };
}

describe("ConnectedAgentClients", () => {
  it.each(["failed", "needs-operator"] as const)("keeps initial markup identical across server/viewer zones for %s", status => {
    const previous = process.env.TZ;
    const since = new Date("2026-11-06T00:30:00Z");
    try {
      process.env.TZ = "UTC";
      expect(since.getDate()).toBe(6);
      const server = render(hostFailure(status, since));
      process.env.TZ = "America/Chicago";
      expect(since.getDate()).toBe(5);
      expect(render(hostFailure(status, since))).toBe(server);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("hydrates without recovery and localizes dates in translated sentence order", async () => {
    const previous = process.env.TZ;
    const since = new Date("2026-11-06T00:30:00Z");
    const element = content(hostFailure("failed", since), "[{$date}] depuis / {$date}.");
    const container = document.createElement("div");
    const errors: unknown[] = [];
    let root: Root | undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    try {
      process.env.TZ = "UTC";
      container.innerHTML = renderToString(element);
      document.body.append(container);
      process.env.TZ = "America/Chicago";
      await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error) }); });
      expect(errors).toEqual([]);
      expect(container.querySelector("[data-host-agent=failed]")?.textContent).toContain("[Nov 5, 2026] depuis / Nov 5, 2026.");
    } finally {
      if (root) await act(async () => { root!.unmount(); });
      container.remove();
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it.each(["failed", "needs-operator", "ok"] as const)("omits the since sentence when its date is missing for %s", status => {
    expect(render(hostFailure(status, null))).not.toContain("Since ");
  });

  it("does not add a since sentence to a healthy host with a date", () => {
    expect(render(hostFailure("ok", new Date("2026-11-06T00:30:00Z")))).not.toContain("Since ");
  });

  it("lists each client with its tools version, standing in plain words, and when it was last seen", () => {
    const html = render({
      release,
      truncated: false,
      clients: [
        { credentialRef: "oauth:a", product: "Claude Code", probable: false, authMode: "oauth", standing: "current", loadedVersion: "0.4.0", loadedFingerprint: "1111111111aa", lastSeen: new Date("2026-10-13T11:30:00Z"), behind: false, reasons: [], hostAgent: { status: "ok", code: null, since: null } },
        { credentialRef: "token:b", product: "Codex", probable: false, authMode: "bearer", standing: "stale", loadedVersion: "0.3.0", loadedFingerprint: "2222222222bb", lastSeen: new Date("2026-10-11T12:00:00Z"), behind: true, reasons: ["the files it loaded differ from the released pack"], hostAgent: { status: "failed", code: "exit-1", since: new Date("2026-10-10T09:00:00Z") } },
        { credentialRef: "oauth:c", product: null, probable: false, authMode: "oauth", standing: "undeclared", loadedVersion: null, loadedFingerprint: null, lastSeen: new Date("2026-10-13T07:00:00Z"), behind: true, reasons: ["the connection declares no DPF toolchain"], hostAgent: null },
      ],
    });

    expect(html).toContain("Connected agent clients");
    expect(html).toContain("1 of 3 up to date");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Up to date");
    expect(html).toContain("Codex");
    expect(html).toContain("Behind");
    expect(html).toContain("0.3.0");
    expect(html).toContain("2 days ago");
    expect(html).toContain("Stored token");
    expect(html).toContain("Unidentified client");
    expect(html).toContain("Version unknown");
    expect(html).toContain("did not say");
    expect(html).toContain("5 hours ago");
    expect(html).toContain("within the last hour");
    // BI-3E66F76F: why it is behind, and how its computer's automatic update fared.
    expect(html).toContain("Why: the files it loaded differ from the released pack.");
    expect(html).toContain("This computer updates its agent tools on its own.");
    expect(html).toContain("automatic update has been failing.");
    expect(html).toContain("Since ");
    // The fingerprint is explained, never bare jargon.
    expect(html).toContain("fingerprint");
    expect(html).not.toMatch(/digest/i);
  });

  it("shows an honest empty state when no client has connected yet", () => {
    const html = render({ release, clients: [], truncated: false });
    expect(html).toContain("No agent client has connected yet");
    expect(html).toContain('role="status"');
  });

  it("says when this image carries no agent tools", () => {
    expect(render({ release: null, clients: [], truncated: false })).toContain("does not include the DPF agent tools");
  });

  it("says when the list could not be read", () => {
    expect(render(null)).toContain("could not be read");
  });

  it("uses theme tokens only", () => {
    const html = render({ release, clients: [], truncated: false });
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|text-white|text-black|gray-\d/i);
  });
});
