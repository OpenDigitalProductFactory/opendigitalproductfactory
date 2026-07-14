// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WORK_CAPSULE_ACTIVITY_EVENT } from "@/lib/work-capsules/activity-stream";
import { AgentSessionFeedLive } from "./AgentSessionFeedLive";

const hookState = vi.hoisted(() => ({
  named: {} as Record<string, (event: MessageEvent) => void>,
  urls: [] as string[],
}));

vi.mock("@/lib/hooks/useResilientEventSource", () => ({
  useResilientEventSource: (
    url: string | null,
    opts: { onNamed?: Record<string, (event: MessageEvent) => void> },
  ) => {
    if (url) hookState.urls.push(url);
    hookState.named = opts.onNamed ?? {};
    return { status: "open" };
  },
}));

afterEach(() => {
  cleanup();
  hookState.named = {};
  hookState.urls = [];
});

describe("AgentSessionFeedLive", () => {
  it("renders the initial server-provided feed and opens the capsule stream", () => {
    render(
      <AgentSessionFeedLive
        capsuleId="WC-123"
        initialEntries={[
          {
            id: "act-1",
            tone: "thought",
            label: "Thinking",
            summary: "Choosing the approach",
            actor: "agent",
            recordedAt: "2026-07-14T04:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Choosing the approach")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(hookState.urls).toEqual(["/api/work-capsules/WC-123/activity-stream"]);
  });

  it("appends pushed activity and dedupes repeated events", () => {
    render(<AgentSessionFeedLive capsuleId="WC-123" initialEntries={[]} />);

    act(() => {
      hookState.named[WORK_CAPSULE_ACTIVITY_EVENT]?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "activity",
            entry: {
              id: "act-2",
              tone: "action",
              label: "Did",
              summary: "Ran the targeted tests",
              actor: "agent",
              recordedAt: "2026-07-14T04:01:00.000Z",
            },
          }),
        }),
      );
      hookState.named[WORK_CAPSULE_ACTIVITY_EVENT]?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "activity",
            entry: {
              id: "act-2",
              tone: "action",
              label: "Did",
              summary: "Ran the targeted tests",
              actor: "agent",
              recordedAt: "2026-07-14T04:01:00.000Z",
            },
          }),
        }),
      );
    });

    expect(screen.getAllByText("Ran the targeted tests")).toHaveLength(1);
  });
});
