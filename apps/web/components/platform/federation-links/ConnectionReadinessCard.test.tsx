// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConnectionReadinessCard } from "./ConnectionReadinessCard";
import { computeConnectionReadiness } from "@/lib/federation/connection-readiness";

afterEach(cleanup);

describe("ConnectionReadinessCard", () => {
  it("shows 'Ready to connect' when all items pass", () => {
    const readiness = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      PUBLIC_URL: "http://192.168.0.152:3000",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "1",
    });
    render(<ConnectionReadinessCard readiness={readiness} />);
    expect(screen.getByText("Ready to connect")).toBeTruthy();
  });

  it("surfaces the exact missing env lines for the real Mac state", () => {
    const readiness = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      PUBLIC_URL: "",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "0",
    });
    render(<ConnectionReadinessCard readiness={readiness} />);
    expect(screen.getByText("Setup needed")).toBeTruthy();
    // The two missing lines are shown verbatim so the operator can copy them.
    expect(
      screen.getByText("DPF_FEDERATION_ALLOW_INSECURE_PEERS=1"),
    ).toBeTruthy();
    expect(screen.getByText(/PUBLIC_URL=/, { selector: "code" })).toBeTruthy();
    // The satisfied item is not shown as a fix line.
    expect(
      screen.queryByText("DPF_FEDERATION_EXCHANGE_ENABLED=1"),
    ).toBeNull();
  });
});
