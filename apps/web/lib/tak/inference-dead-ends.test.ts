import { describe, it, expect } from "vitest";
import {
  noEligibleModelHandoff,
  providersBusyHandoff,
  providerUnreachableHandoff,
} from "./inference-dead-ends";

// BI-33F1EA72. Measured on the live install: 196 of 1,138 assistant messages
// were dead ends, and 84% of those were provider availability — the paths the
// hand-off rung originally did NOT cover.
describe("dead-end replies hand off instead of asking the user to poll", () => {
  const all = [
    ["no eligible model", noEligibleModelHandoff()],
    ["providers busy", providersBusyHandoff()],
    ["provider unreachable", providerUnreachableHandoff()],
  ] as const;

  it.each(all)("%s ends on the resumption, not on the limitation", (_name, message) => {
    const lastLine = message.trimEnd().split("\n").pop() ?? "";
    expect(lastLine).toMatch(/pick this|straight back up/i);
  });

  it.each(all)("%s gives at least one numbered step", (_name, message) => {
    expect(message).toMatch(/^1\. /m);
  });

  it("stops telling the user to poll on the most common dead end", () => {
    // The prior copy was "Please try again in about 30 seconds." — a poll
    // instruction with no step and no resumption. 114 of 196 dead ends.
    const message = providerUnreachableHandoff();
    expect(message).not.toMatch(/try again in about 30 seconds/i);
    expect(message).toMatch(/Providers & Routing/);
  });

  it("keeps the genuinely transient case short rather than inventing config steps", () => {
    // Nothing is misconfigured when every endpoint is rate-limited, so a
    // three-step "go check your settings" would be a fabricated instruction.
    const message = providersBusyHandoff();
    expect(message).toMatch(/Nothing is misconfigured/);
    expect(message).not.toMatch(/^2\. /m);
  });

  it("names the routing causes rather than blaming a disconnected provider", () => {
    const message = noEligibleModelHandoff();
    expect(message).toMatch(/residency|data-policy/);
    expect(message).toMatch(/context size/);
  });
});
