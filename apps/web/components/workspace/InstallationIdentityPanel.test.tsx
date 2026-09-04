// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  declare: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/installation-operating-intent", () => ({
  previewInstallationIdentityChange: mocks.preview,
  declareInstallationIdentity: mocks.declare,
}));

import type {
  InstallationIdentityImpact,
  InstallationIdentityView,
} from "@/lib/installation-journey/identity-presentation";

import { InstallationIdentityPanel } from "./InstallationIdentityPanel";

const VIEW: InstallationIdentityView = {
  stance: {
    schemaVersion: 1,
    environmentClass: "development",
    primaryPurpose: "evolve-dpf",
    holdsIrreplaceableWork: true,
    credentials: "local-permitted",
    teardown: "capture-required",
    sourceAuthority: "governed-worktree",
    peerWrite: "read-only",
    workSync: "same-organization",
    pairedProductionInstallationRef: "dpf-prod-acme",
    rationale: {
      credentials: "Local test credentials may be rotated here.",
      teardown: "Capture a durable backlog bundle before any teardown.",
      sourceAuthority: "Source changes belong in a governed worktree.",
      peerWrite: "Read from that peer but never write to it.",
      workSync: "Mirror the backlog this installation owns so the work survives a teardown.",
    },
  },
  environment: {
    environmentClass: "development",
    tier: "installer-state",
    declared: true,
    installerStateValue: "development",
  },
  intentStatus: "valid",
  confirmationStatus: "confirmed",
  declaration: {
    primaryPurpose: "evolve-dpf",
    environmentClass: "development",
    pairedProductionInstallationRef: "dpf-prod-acme",
  },
  headline: "A development installation. Its job: safely improve another dpf.",
  detail: "Paired with dpf-prod-acme. The installer set the environment.",
  stances: [
    {
      stance: "credentials",
      label: "Credentials",
      value: "local-permitted",
      valueLabel: "Local test keys allowed",
      intent: "neutral",
      rationale: "Local test credentials may be rotated here.",
    },
    {
      stance: "teardown",
      label: "Teardown",
      value: "capture-required",
      valueLabel: "Capture work first",
      intent: "warning",
      rationale: "Capture a durable backlog bundle before any teardown.",
    },
    {
      stance: "sourceAuthority",
      label: "Source changes",
      value: "governed-worktree",
      valueLabel: "Governed worktree",
      intent: "neutral",
      rationale: "Source changes belong in a governed worktree.",
    },
    {
      stance: "peerWrite",
      label: "Paired installation",
      value: "read-only",
      valueLabel: "Read only",
      intent: "warning",
      rationale: "Read from that peer but never write to it.",
    },
  ],
};

const MATERIAL_IMPACT: InstallationIdentityImpact = {
  material: true,
  changes: [
    { field: "environmentClass", label: "Environment", from: "Development", to: "Production" },
  ],
  stanceDeltas: [
    {
      stance: "teardown",
      label: "Teardown",
      from: "Capture work first",
      to: "Never",
      direction: "tightens",
      rationale: "Production teardown is never an agent action.",
    },
  ],
  loosenedStances: [],
  staleEvidence: [
    {
      source: "installer",
      claim: "Development workspace detected on host",
      reason: "This helped guess the identity you are replacing.",
    },
  ],
  warnings: ["This installation becomes the one that can make funding decisions."],
  previewToken: "token-abc",
};

function open() {
  fireEvent.click(screen.getByRole("button", { name: /change what this installation is/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue({
    ok: true,
    data: { impact: MATERIAL_IMPACT, environmentAfter: VIEW.environment },
  });
  mocks.declare.mockResolvedValue({
    ok: true,
    data: {
      kind: "saved",
      changed: true,
      confirmationStatus: "confirmed",
      environmentAfter: VIEW.environment,
    },
  });
});

afterEach(() => cleanup());

describe("InstallationIdentityPanel read view", () => {
  it("states the identity and every stance rationale", () => {
    render(<InstallationIdentityPanel view={VIEW} />);

    expect(screen.getByText(VIEW.headline)).toBeInTheDocument();
    expect(screen.getByText(/Paired with dpf-prod-acme/)).toBeInTheDocument();
    for (const row of VIEW.stances) {
      expect(screen.getByText(row.rationale)).toBeInTheDocument();
      expect(screen.getByText(row.valueLabel)).toBeInTheDocument();
    }
  });

  it("says a stance is a brake and not a permission", () => {
    render(<InstallationIdentityPanel view={VIEW} />);
    expect(screen.getByText(/A stance is a brake, never a permission/)).toBeInTheDocument();
  });

  it("keeps the change form behind a disclosure", () => {
    render(<InstallationIdentityPanel view={VIEW} />);
    expect(screen.queryByLabelText(/Its main job/i)).toBeNull();
    open();
    expect(screen.getByLabelText(/Its main job/i)).toBeInTheDocument();
  });

  it("explains a shadowed declaration and names the installer flag", () => {
    render(
      <InstallationIdentityPanel
        view={{
          ...VIEW,
          environment: {
            ...VIEW.environment,
            shadowedPortalDeclaration: {
              declaredClass: "test",
              winningTier: "installer-state",
              winningClass: "development",
            },
          },
        }}
      />,
    );
    expect(screen.getByText(/not the one in force/i)).toBeInTheDocument();
    expect(screen.getByText("--environment-class")).toBeInTheDocument();
  });
});

describe("InstallationIdentityPanel change flow", () => {
  it("offers no confirm control until the impact has been shown", () => {
    render(<InstallationIdentityPanel view={VIEW} />);
    open();

    expect(screen.getByRole("button", { name: /show me the impact/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yes, this is what it is/i })).toBeNull();
  });

  it("shows the field diff, stance diff, warning, and stale evidence", async () => {
    render(<InstallationIdentityPanel view={VIEW} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /show me the impact/i }));

    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    const changes = (await screen.findByText("What you are changing")).nextElementSibling;
    expect(changes?.textContent).toContain("Environment");
    expect(changes?.textContent).toContain("Development");
    expect(changes?.textContent).toContain("Production");
    expect(screen.getByText("Production teardown is never an agent action.")).toBeInTheDocument();
    expect(
      screen.getByText("This installation becomes the one that can make funding decisions."),
    ).toBeInTheDocument();
    expect(screen.getByText("One evidence note goes stale.")).toBeInTheDocument();
    expect(mocks.declare).not.toHaveBeenCalled();
  });

  it("sends the previewed token when the operator confirms", async () => {
    render(<InstallationIdentityPanel view={VIEW} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /show me the impact/i }));
    const confirm = await screen.findByRole("button", { name: /yes, this is what it is/i });
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.declare).toHaveBeenCalledTimes(1));
    expect(mocks.declare).toHaveBeenCalledWith(expect.any(Object), "token-abc");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("withdraws the confirm control when a field is edited after previewing", async () => {
    render(<InstallationIdentityPanel view={VIEW} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /show me the impact/i }));
    await screen.findByRole("button", { name: /yes, this is what it is/i });

    fireEvent.change(screen.getByLabelText(/Paired installation/i), {
      target: { value: "another-peer" },
    });

    expect(screen.queryByRole("button", { name: /yes, this is what it is/i })).toBeNull();
    expect(screen.getByRole("button", { name: /show me the impact/i })).toBeInTheDocument();
  });

  it("surfaces a refusal and the fresh preview it carries", async () => {
    mocks.declare.mockResolvedValue({
      ok: true,
      data: {
        kind: "needs-preview",
        reason: "This changes what the installation is. Look at the impact, then confirm it.",
        impact: MATERIAL_IMPACT,
      },
    });

    render(<InstallationIdentityPanel view={VIEW} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /show me the impact/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, this is what it is/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Look at the impact/);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reports plainly when the chosen identity is the one already in force", async () => {
    mocks.preview.mockResolvedValue({
      ok: true,
      data: {
        impact: {
          ...MATERIAL_IMPACT,
          material: false,
          changes: [],
          warnings: [],
          staleEvidence: [],
        },
        environmentAfter: VIEW.environment,
      },
    });

    render(<InstallationIdentityPanel view={VIEW} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /show me the impact/i }));

    expect(
      await screen.findByText("The identity you chose is the one already in force."),
    ).toBeInTheDocument();
  });
});
