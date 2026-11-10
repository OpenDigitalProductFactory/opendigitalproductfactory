// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actionMocks = vi.hoisted(() => ({
  checkWordPressConnectionAction: vi.fn(),
  connectWordPressAction: vi.fn(),
  disconnectWordPressAction: vi.fn(),
  setWordPressPublicationPolicyAction: vi.fn(),
}));
const dialogMocks = vi.hoisted(() => ({ confirmDialog: vi.fn() }));

vi.mock("@/app/(shell)/platform/tools/integrations/wordpress/actions", () => actionMocks);
vi.mock("@/components/ui/Dialog", () => dialogMocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import {
  WordPressConnectPanel,
  type WordPressConnectionViewState,
} from "./WordPressConnectPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const disconnected: WordPressConnectionViewState = {
  status: "unconfigured",
  siteUrl: null,
  username: null,
  siteName: null,
  origin: null,
  supportedResourceKinds: [],
  supportedTaxonomies: [],
  unsupportedResourceTypes: [],
  canCreateDrafts: false,
  canPublishLive: false,
  canUploadMedia: false,
  publicPublicationEnabled: false,
  lastErrorMsg: null,
  lastTestedAt: null,
};

const connected: WordPressConnectionViewState = {
  ...disconnected,
  status: "connected",
  siteUrl: "https://rescue.example",
  username: "dpf-publisher",
  siteName: "Second Chance Animal Rescue",
  origin: "https://rescue.example",
  supportedResourceKinds: ["post", "page", "media"],
  supportedTaxonomies: ["category", "post_tag"],
  unsupportedResourceTypes: ["event"],
  canCreateDrafts: true,
  canPublishLive: true,
  canUploadMedia: true,
  lastTestedAt: "2026-08-22T07:00:00.000Z",
};

describe("WordPressConnectPanel", () => {
  it("labels the initial consequential action Connect WordPress", () => {
    render(<WordPressConnectPanel initialState={disconnected} />);

    expect(screen.getByLabelText(/WordPress site URL/i)).toBeTruthy();
    expect(screen.getByLabelText(/WordPress username/i)).toBeTruthy();
    expect(screen.getByLabelText(/Application Password/i)).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /^connect wordpress$/i })).toHaveAttribute(
      "data-dpf-primary-action",
      "true",
    );
    expect(screen.queryByRole("button", { name: /^check connection$/i })).toBeNull();
  });

  it("puts identity, health, capabilities, authority, and one next action in the connected view", () => {
    render(<WordPressConnectPanel initialState={connected} />);

    expect(screen.getByRole("heading", { name: "Second Chance Animal Rescue" })).toBeTruthy();
    expect(screen.getByText("rescue.example")).toBeTruthy();
    expect(screen.getByText(/Create WordPress drafts by default/i)).toBeTruthy();
    expect(screen.getByText(/Posts, pages, and media/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /check connection/i })).toHaveAttribute(
      "data-dpf-primary-action",
      "true",
    );
    expect(screen.getByRole("button", { name: /replace connection/i })).toBeTruthy();
    expect(screen.queryByDisplayValue(/application password/i)).toBeNull();
  });

  it("keeps a usable failed connection visible as degraded with a recovery action", () => {
    render(<WordPressConnectPanel initialState={{
      ...connected,
      status: "degraded",
      lastErrorMsg: "WordPress could not be reached safely.",
    }} />);

    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("WordPress could not be reached safely.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^check connection$/i })).toBeTruthy();
  });

  it("checks a connected site and reports a safe recovery error", async () => {
    actionMocks.checkWordPressConnectionAction.mockResolvedValue({
      ok: false,
      error: "The WordPress user lacks the required permissions.",
    });
    render(<WordPressConnectPanel initialState={connected} />);

    fireEvent.click(screen.getByRole("button", { name: /check connection/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/lacks the required permissions/i);
  });

  it("disconnects only after confirmation and shows revocation recovery", async () => {
    actionMocks.disconnectWordPressAction.mockResolvedValue({
      ok: true,
      revocationInstructions:
        "In WordPress, open Users > Profile > Application Passwords and revoke the password created for DPF.",
    });
    dialogMocks.confirmDialog.mockResolvedValue(true);
    render(<WordPressConnectPanel initialState={connected} />);

    fireEvent.click(screen.getByRole("button", { name: /disconnect wordpress/i }));

    await waitFor(() => expect(actionMocks.disconnectWordPressAction).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Users > Profile > Application Passwords/i,
    );
  });
});
