// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleEditor } from "./ScheduleEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScheduleEditor", () => {
  it("notifies its owner after availability is saved", async () => {
    const onSaved = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    render(
      <ScheduleEditor
        saveEndpoint="/api/storefront/admin/hospitality-resources/table-1"
        availability={[]}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Schedule" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
