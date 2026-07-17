/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PatientIntakeRunner } from "./PatientIntakeRunner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PatientIntakeRunner", () => {
  it("restores saved patient answers without rendering the resume token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/access-grants") && init?.method === "POST") {
        return jsonResponse({ token: "resume-secret", expiresAt: "2026-08-01T15:00:00.000Z" }, 201);
      }
      if (url.endsWith("/responses/medical-history")) {
        return jsonResponse({
          responseId: "response-a", version: 2, status: "in-progress",
          answers: { "visit-reason": "Routine check" }, answeredLinkIds: ["visit-reason"],
        });
      }
      return jsonResponse({
        packetId: "intake-a", status: "in-progress", version: 2,
        dueAt: null, completionPercent: 50,
        forms: [{
          formId: "medical-history", title: "Medical history", version: 2,
          fields: [{ key: "visit-reason", type: "textarea", label: "Reason for visit", required: true }],
          dataCategories: { "visit-reason": "visit-reason" }, offlineCapable: true,
        }],
      });
    });

    render(<PatientIntakeRunner packetId="intake-a" />);

    expect((await screen.findByLabelText("Reason for visit *") as HTMLTextAreaElement).value).toBe("Routine check");
    expect(document.body.textContent).not.toContain("resume-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/healthcare/intake/intake-a/responses/medical-history",
      expect.objectContaining({ headers: { "x-intake-resume-token": "resume-secret" } }),
    );
  });

  it("requires a separate confirmation before sending forms", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/access-grants") && init?.method === "POST") {
        return jsonResponse({ token: "resume-secret", expiresAt: "2026-08-01T15:00:00.000Z" }, 201);
      }
      if (url.endsWith("/responses/medical-history")) {
        return jsonResponse({ responseId: null, version: null, status: "not-started", answers: {}, answeredLinkIds: [] });
      }
      return jsonResponse({
        packetId: "intake-a", status: "assigned", version: 1,
        dueAt: null, completionPercent: 0,
        forms: [{
          formId: "medical-history", title: "Medical history", version: 2,
          fields: [{ key: "visit-reason", type: "textarea", label: "Reason for visit", required: true }],
          dataCategories: { "visit-reason": "visit-reason" }, offlineCapable: true,
        }],
      });
    });

    render(<PatientIntakeRunner packetId="intake-a" />);
    fireEvent.change(await screen.findByLabelText("Reason for visit *"), { target: { value: "Routine check" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and send" }));

    expect((await screen.findByRole("dialog")).textContent).toContain("Send these forms to your care team?");
    expect(screen.getByRole("button", { name: "Send forms" })).not.toBeNull();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/submit"))).toBe(false));
  });
});
