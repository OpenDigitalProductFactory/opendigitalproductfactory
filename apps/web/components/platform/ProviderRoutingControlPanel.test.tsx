// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import { ProviderRoutingControlPanel } from "./ProviderRoutingControlPanel";
vi.mock("./ProviderStatusToggle", () => ({ ProviderStatusToggle: () => <button>Pause control</button> }));
afterEach(cleanup);
it("keeps shared-auth navigation and simultaneous restrictions visible to a read-only viewer", () => {
  const pw = { provider: { providerId: "chatgpt", status: "active", endpointType: "responses" }, credential: null } as unknown as ProviderWithCredential;
  render(<MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}><ProviderRoutingControlPanel pw={pw} canWrite={false} view={{ eligibility: { state: "disabled", eligible: false, label: "Paused", reason: "Paused by an operator." }, restrictions: [{ key: "operator", summary: "Operator pause", until: "2026-10-13T12:00:00Z" }, { key: "capacity", summary: "Usage limit reached", until: "2026-10-14T12:00:00Z" }], healthSummary: "No recent health observation.", weeklyHint: null }} /></MessagesProvider>);
  expect(screen.getByRole("heading", { name: "Routing right now" })).toBeTruthy();
  expect(screen.getByText(/Usage limit reached/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Manage shared sign-in" }).getAttribute("href")).toBe("/platform/ai/providers/codex");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText(/Resuming preserves/)).toBeTruthy();
});

it("shows health separately and explains which traffic a pause blocks", () => {
  const pw = { provider: { providerId: "local", status: "inactive", endpointType: "llm", defaultConnectionStatus: "paused", operatorPause: { resumeAt: null } }, credential: null } as unknown as ProviderWithCredential;
  render(<MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}><ProviderRoutingControlPanel pw={pw} canWrite={true} view={{ eligibility: { state: "disabled", eligible: false, label: "Paused", reason: "Paused by an operator." }, restrictions: [{ key: "operator", summary: "Paused by an operator.", until: null }], healthSummary: "Connection health has not been verified.", weeklyHint: null }} /></MessagesProvider>);
  expect(screen.getByText("Health")).toBeTruthy();
  expect(screen.getByText(/Health checks continue/)).toBeTruthy();
  expect(screen.getByText(/including chat and embeddings/)).toBeTruthy();
  expect(screen.queryByText("Paused by an operator.")).toBeNull();
});
