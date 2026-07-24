// @vitest-environment jsdom
//
// The critique-capture form is a surface AGT-906 would critique, so its own
// cognitive-load shape is under test: the default view stays tight and the
// reproduction metadata is deferred. Layout decided by the kernel
// (DI-E1600108C932, human_cognitive_load axis).
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const captureCritiqueEntry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/critique-entry", () => ({ captureCritiqueEntry }));

import { CritiqueCaptureForm } from "./CritiqueCaptureForm";

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  captureCritiqueEntry.mockReset();
  captureCritiqueEntry.mockResolvedValue({ ok: true, slug: "craft/ux-design/x", status: "draft" });
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ assetId: "asset9", url: "/api/media/asset9" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CritiqueCaptureForm — default view stays tight (BI-3880DA1D)", () => {
  it("shows the three essentials and the verdict in the default view", () => {
    render(<CritiqueCaptureForm />);
    expect(screen.getByLabelText(/short title/i)).toBeVisible();
    expect(screen.getByLabelText(/^route/i)).toBeVisible();
    expect(screen.getByLabelText(/what is wrong/i)).toBeVisible();
    expect(screen.getByLabelText(/your verdict/i)).toBeVisible();
  });

  it("marks the three essentials required and the verdict optional", () => {
    render(<CritiqueCaptureForm />);
    expect(screen.getByLabelText(/short title/i)).toBeRequired();
    expect(screen.getByLabelText(/^route/i)).toBeRequired();
    expect(screen.getByLabelText(/what is wrong/i)).toBeRequired();
    expect(screen.getByLabelText(/your verdict/i)).not.toBeRequired();
  });

  it("defers the reproduction metadata behind a collapsed disclosure", () => {
    const { container } = render(<CritiqueCaptureForm />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    // Collapsed by default — this is the construct the budget path excises, so
    // the capture form is rewarded for deferring, not taxed.
    expect(details).not.toHaveAttribute("open");
    // The screenshot is a file picker (lower load than a typed path), still
    // deferred inside the disclosure.
    const shot = screen.getByLabelText(/screenshot/i);
    expect(shot).toBeInTheDocument();
    expect(shot).toHaveAttribute("type", "file");
  });
});

describe("CritiqueCaptureForm — the verdict authority", () => {
  it("reveals the authority selector only once a verdict is chosen", () => {
    render(<CritiqueCaptureForm />);
    expect(screen.queryByLabelText(/attributed to/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/your verdict/i), {
      target: { value: "change-needed" },
    });
    expect(screen.getByLabelText(/attributed to/i)).toBeVisible();
  });
});

describe("CritiqueCaptureForm — submission", () => {
  it("captures as a human with the entered fields and no verdict authority when none chosen", async () => {
    render(<CritiqueCaptureForm />);
    fireEvent.change(screen.getByLabelText(/short title/i), { target: { value: "Lead band" } });
    fireEvent.change(screen.getByLabelText(/^route/i), { target: { value: "/workspace" } });
    fireEvent.change(screen.getByLabelText(/what is wrong/i), {
      target: { value: "Lead band carries 240 words before the next action appears." },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture as draft/i }));

    await waitFor(() => expect(captureCritiqueEntry).toHaveBeenCalledTimes(1));
    const arg = captureCritiqueEntry.mock.calls[0]![0];
    expect(arg.callerKind).toBe("human");
    expect(arg.route).toBe("/workspace");
    expect(arg.verdict).toBeNull();
    expect(arg.verdictAuthority).toBeNull();
  });

  it("attaches the chosen verdict authority", async () => {
    render(<CritiqueCaptureForm />);
    fireEvent.change(screen.getByLabelText(/short title/i), { target: { value: "Lead band" } });
    fireEvent.change(screen.getByLabelText(/^route/i), { target: { value: "/finance" } });
    fireEvent.change(screen.getByLabelText(/what is wrong/i), {
      target: { value: "Six status lines sit above the primary action on this screen." },
    });
    fireEvent.change(screen.getByLabelText(/your verdict/i), {
      target: { value: "change-needed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /capture as draft/i }));

    await waitFor(() => expect(captureCritiqueEntry).toHaveBeenCalledTimes(1));
    const arg = captureCritiqueEntry.mock.calls[0]![0];
    expect(arg.verdict).toBe("change-needed");
    expect(arg.verdictAuthority).toBe("founder");
  });

  it("uploads a staged screenshot and passes its asset id, never a raw ref", async () => {
    render(<CritiqueCaptureForm />);
    fireEvent.change(screen.getByLabelText(/short title/i), { target: { value: "Admin density" } });
    fireEvent.change(screen.getByLabelText(/^route/i), { target: { value: "/admin" } });
    fireEvent.change(screen.getByLabelText(/what is wrong/i), {
      target: { value: "The admin table packs eleven columns above the primary filter control." },
    });
    const file = new File(["pngbytes"], "admin-1280.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/screenshot/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /capture as draft/i }));

    await waitFor(() => expect(captureCritiqueEntry).toHaveBeenCalledTimes(1));
    // The image went to the upload endpoint...
    expect(fetchMock).toHaveBeenCalledWith("/api/media", expect.objectContaining({ method: "POST" }));
    // ...and the action receives the asset id, not a hand-typed screenshotRef.
    const arg = captureCritiqueEntry.mock.calls[0]![0];
    expect(arg.screenshotAssetId).toBe("asset9");
    expect(arg.screenshotRef).toBeUndefined();
  });

  it("does not capture the entry if the screenshot upload fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, json: async () => ({ error: "too big" }) });
    render(<CritiqueCaptureForm />);
    fireEvent.change(screen.getByLabelText(/short title/i), { target: { value: "Admin density" } });
    fireEvent.change(screen.getByLabelText(/^route/i), { target: { value: "/admin" } });
    fireEvent.change(screen.getByLabelText(/what is wrong/i), {
      target: { value: "The admin table packs eleven columns above the primary filter control." },
    });
    const file = new File(["x".repeat(20)], "huge.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/screenshot/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /capture as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too big/i);
    expect(captureCritiqueEntry).not.toHaveBeenCalled();
  });

  it("surfaces a rejection from the action instead of clearing", async () => {
    captureCritiqueEntry.mockResolvedValue({ ok: false, error: "Say what is specifically wrong." });
    render(<CritiqueCaptureForm />);
    fireEvent.change(screen.getByLabelText(/short title/i), { target: { value: "Vague" } });
    fireEvent.change(screen.getByLabelText(/^route/i), { target: { value: "/x" } });
    fireEvent.change(screen.getByLabelText(/what is wrong/i), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /capture as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/specifically wrong/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
