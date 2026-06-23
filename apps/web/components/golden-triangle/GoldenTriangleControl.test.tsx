// @vitest-environment jsdom
import "./test-setup";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { preferenceFromPreset } from "./posture-display";

function Harness({ initial }: { initial: GoldenTrianglePreference }) {
  const [v, setV] = useState<GoldenTrianglePreference>(initial);
  return <GoldenTriangleControl value={v} onChange={setV} />;
}

describe("GoldenTriangleControl", () => {
  it("renders the four one-click presets", () => {
    render(<Harness initial={preferenceFromPreset("balanced")} />);
    for (const name of ["Fast", "Balanced", "Assured", "Frugal"]) {
      expect(screen.getByRole("radio", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("marks the active preset with aria-checked", () => {
    render(<Harness initial={preferenceFromPreset("balanced")} />);
    expect(screen.getByRole("radio", { name: /Balanced/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Assured/ })).toHaveAttribute("aria-checked", "false");
  });

  it("switches posture on a preset click and updates the configured readout", () => {
    render(<Harness initial={preferenceFromPreset("balanced")} />);
    fireEvent.click(screen.getByRole("radio", { name: /Assured/ }));
    expect(screen.getByRole("radio", { name: /Assured/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Frontier tier/)).toBeInTheDocument();
  });

  it("shows a plain-language summary for the active posture", () => {
    render(<Harness initial={preferenceFromPreset("frugal")} />);
    expect(screen.getByText(/May take a little longer/)).toBeInTheDocument();
  });

  it("exposes three numeric weight inputs (canonical accessible control)", () => {
    render(<Harness initial={preferenceFromPreset("balanced")} />);
    expect(screen.getByLabelText(/Quality priority percent/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cost priority percent/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Time priority percent/)).toBeInTheDocument();
  });
});
