// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { AgentCoworkerShell } from "@/components/agent/AgentCoworkerShell";
import { ResponseFeedback } from "@/components/agent/ResponseFeedback";
import type { ResponseFeedbackState } from "@/lib/routing/response-feedback";
import ShellLayout from "./layout";

const actions = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/actions/response-feedback", () => ({ getResponseFeedbackAction: actions.read, recordResponseFeedbackAction: actions.write }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "shell-viewer", email: "viewer@example.test", platformRole: "HR-000", isSuperuser: false } }) }));
vi.mock("@dpf/db", () => ({
  executeBootstrapDiscovery: vi.fn(),
  prisma: {
    discoveryRun: { findFirst: async () => ({ id: "existing-discovery" }) },
    brandingConfig: { findUnique: async () => null },
    organization: { findFirst: async () => ({ name: "Example", logoUrl: null, cooConversationalName: null }) },
    storefrontConfig: { findFirst: async () => null },
    employeeProfile: { findUnique: async () => ({ id: "existing-profile" }) },
    platformSetupProgress: { findFirst: async () => null },
  },
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected shell redirect"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/actions/setup-progress", () => ({ isFirstRun: async () => false }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ language: "en-US" }) }));
vi.mock("@/lib/identity/last-seen", () => ({ recordUserSeen: async () => {} }));
vi.mock("@/lib/branding", () => ({ resolveBrandingLogoUrl: () => null, buildBrandingStyleTag: () => "" }));
vi.mock("@/lib/install/estate-identity", () => ({ loadInstallationBadge: async () => null }));
vi.mock("@/lib/feature-flags", () => ({ isUnifiedCoworkerEnabled: async () => true }));
vi.mock("@/lib/phone-country.server", () => ({ resolveHomePhoneCountry: async () => "US" }));
vi.mock("@/lib/storefront/org-capabilities.server", () => ({ getActiveOrgCapabilities: async () => new Set() }));
vi.mock("@/lib/permissions", () => ({ getGrantedCapabilities: () => new Set(), getShellNavSections: () => [] }));
vi.mock("@/lib/owner-first/archetype-surface", () => ({ resolveCustomerSurface: () => ({ shellLabel: "Customers", detailHint: "Customers" }) }));
vi.mock("@/lib/finance/finance-surface", () => ({ resolveFinanceSurface: () => ({ shellLabel: null }) }));
vi.mock("@/components/shell/Header", () => ({ Header: () => null }));
vi.mock("@/components/agent/AgentCoworkerShell", () => ({ AgentCoworkerShell: () => null }));
vi.mock("@/components/feedback/QueueFlusher", () => ({ QueueFlusher: () => null }));
vi.mock("@/components/shell/StatusBanner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/shell/UpdatePendingBanner", () => ({ UpdatePendingBanner: () => null }));
vi.mock("@/components/shell/DeploymentSkewBanner", () => ({ DeploymentSkewBanner: () => null }));
vi.mock("@/components/platform/PlatformBanner", () => ({ PlatformBanner: () => null }));
vi.mock("@/components/platform/SystemEventProvider", () => ({ SystemEventProvider: () => null }));
vi.mock("@/components/shell/ShellBannerOverlay", () => ({ ShellBannerOverlay: () => null }));
vi.mock("@/components/shell/ModelWarmup", () => ({ ModelWarmup: () => null }));
vi.mock("@/components/setup/SetupOverlay", () => ({ SetupOverlay: () => null }));
vi.mock("@/components/shell/AppRail", () => ({ AppRail: () => null }));
vi.mock("@/components/shell/ShellBreadcrumb", () => ({ ShellBreadcrumb: () => null }));
vi.mock("@/components/ui/PhoneCountryContext", () => ({ PhoneCountryProvider: () => null }));
vi.mock("@/components/shell/UxInitialLoadBoundary", () => ({ UxInitialLoadBoundary: () => null }));
vi.mock("@/components/telemetry/PortalVitals", () => ({ PortalVitals: () => null }));

type ProviderElement = ReactElement<ComponentProps<typeof MessagesProvider>>;
function coworkerProvider(node: ReactNode): ProviderElement | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  const children = Children.toArray(node.props.children);
  if (node.type === MessagesProvider && children.some(child => isValidElement(child) && child.type === AgentCoworkerShell)) {
    return node as ProviderElement;
  }
  for (const child of children) {
    const found = coworkerProvider(child);
    if (found) return found;
  }
  return undefined;
}

async function actualProvider() {
  const tree = await ShellLayout({ children: <span>Route content</span> });
  const provider = coworkerProvider(tree);
  expect(provider, "the actual shell must retain the coworker's own message provider").toBeDefined();
  return provider!;
}
async function mountFeedback(props: ComponentProps<typeof ResponseFeedback>) {
  return render(cloneElement(await actualProvider(), undefined, <ResponseFeedback {...props} />));
}
const available: ResponseFeedbackState = {
  messageId: "answer", available: true, unavailableReason: null, value: null, source: null,
  actorLabel: null, acceptedAt: null, revision: 0, canWrite: true,
};
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); actions.read.mockResolvedValue({ ok: true, data: available }); });

describe("global coworker shell feedback messages", () => {
  it("translates an unbound welcome response through the actual shell provider", async () => {
    const view = await mountFeedback({ messageId: "welcome", eligible: false });
    expect(screen.getByText("Feedback unavailable for this answer.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("routingManagement.");
    expect(actions.read).not.toHaveBeenCalled();
  });
  it("translates eligible controls and empty state through the actual shell provider", async () => {
    const view = await mountFeedback({ messageId: "answer", eligible: true, initialState: available });
    expect(screen.getByRole("button", { name: "Kept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs revision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear feedback" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No feedback yet.");
    expect(view.container.textContent).not.toContain("routingManagement.");
  });
  it("translates failed-read status through the actual shell provider", async () => {
    actions.read.mockResolvedValue({ ok: false, error: "unavailable" });
    const view = await mountFeedback({ messageId: "answer", eligible: true });
    expect(await screen.findByText("Could not load feedback.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("routingManagement.");
  });
});
