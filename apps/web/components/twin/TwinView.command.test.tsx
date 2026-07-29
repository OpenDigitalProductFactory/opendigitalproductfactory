// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot } from "./demo-snapshot";
import { TwinView } from "./TwinView";
import type { OperationalCommandResult } from "@/lib/twin/operations-command";

afterEach(cleanup);

const profile = deriveTwinProfile(ALL_ARCHETYPES[0]);
const snapshot = buildDemoTwinSnapshot(profile);

describe("TwinView durable command handoff", () => {
  it("does not claim a suggestion was confirmed when no command provider is connected", () => {
    render(<TwinView profile={profile} snapshot={snapshot} />);

    expect(
      screen.getByRole("button", { name: "Command unavailable" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Connect an operations command provider before assigning.",
    );
    expect(screen.queryByText("Confirmed")).toBeNull();
  });

  it("shows immediate pending feedback and a deterministic conflict outcome", async () => {
    let finish!: (result: OperationalCommandResult) => void;
    const onConfirmCog = () =>
      new Promise<OperationalCommandResult>((resolve) => {
        finish = resolve;
      });
    render(<TwinView profile={profile} snapshot={snapshot} onConfirmCog={onConfirmCog} />);

    fireEvent.click(screen.getByRole("button", { name: snapshot.cog!.confirmLabel! }));
    expect(screen.getByRole("button", { name: "Assigning…" }).hasAttribute("disabled")).toBe(true);
    finish({
      status: "conflict",
      idempotencyKey: "fixture-command-1",
      replayed: false,
      currentVersion: "ops-v1-next",
      changedFacts: [{ entityId: "resource-1", field: "availability", value: "occupied" }],
      alternatives: [{ resourceIds: ["resource-2"], label: "Use resource 2" }],
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(false);
    });
    expect(screen.getByRole("status").textContent).toContain(
      "The operation changed. Review the latest state and try again.",
    );
    expect(screen.getByText("Available alternatives")).not.toBeNull();
    expect(screen.getByText("Use resource 2")).not.toBeNull();
    expect(screen.queryByText("Confirmed")).toBeNull();
  });
});
