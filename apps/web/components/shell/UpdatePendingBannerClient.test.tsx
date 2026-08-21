// @vitest-environment jsdom
import "@/test-setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  UpdatePendingBannerClient,
  formatPendingVersion,
} from "./UpdatePendingBannerClient";

describe("UpdatePendingBannerClient", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders as an overlay-friendly banner with a collapse control", () => {
    render(<UpdatePendingBannerClient pendingVersion="v1.2.3" />);

    expect(screen.getByRole("status")).toHaveAttribute("data-overlay-banner", "true");
    // BI-D43EB266: the banner deep-links to the single operator update surface
    // (Ops -> Self-Upgrade), not the Admin source-merge destination.
    expect(screen.getByRole("link", { name: /review in self-upgrade/i })).toHaveAttribute(
      "href",
      "/ops/self-upgrade",
    );
    expect(screen.getByRole("button", { name: /collapse platform update banner/i })).toBeInTheDocument();
  });

  it("collapses into a compact overlay pill and can expand again", () => {
    render(<UpdatePendingBannerClient pendingVersion="v1.2.3" />);

    fireEvent.click(screen.getByRole("button", { name: /collapse platform update banner/i }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand platform update banner/i })).toHaveTextContent(
      "Platform update v1.2.3",
    );

    fireEvent.click(screen.getByRole("button", { name: /expand platform update banner/i }));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("formatPendingVersion (BI-EC26D09D D7)", () => {
  it("passes semver through unchanged", () => {
    expect(formatPendingVersion("v1.2.3")).toBe("v1.2.3");
    expect(formatPendingVersion("v10.0.42")).toBe("v10.0.42");
  });

  it("truncates a 40-char SHA to the git-style 8-char short form", () => {
    expect(
      formatPendingVersion("abcdef0123456789abcdef0123456789abcdef01"),
    ).toBe("update-abcdef01…");
  });

  it("truncates the exact 64-char bundle hash Dale dogfood surfaced", () => {
    // The literal hash from BI-EC26D09D's body — guards the regression
    // path so a future formatter change can't silently re-leak it.
    const dale =
      "f2e89dd8a101ff2c49eb396f0d27e1d1ff83a24d2287ae6db6522d724baa0498";
    expect(formatPendingVersion(dale)).toBe("update-f2e89dd8…");
  });

  it("truncates any pure-hex string of 8+ chars", () => {
    expect(formatPendingVersion("deadbeef")).toBe("update-deadbeef…");
    expect(formatPendingVersion("DEADBEEFCAFEBABE")).toBe(
      "update-DEADBEEF…",
    );
  });

  it("prefixes non-hex non-semver strings with 'v' (legacy behaviour preserved)", () => {
    expect(formatPendingVersion("2026-05-23")).toBe("v2026-05-23");
    expect(formatPendingVersion("nightly-build")).toBe("v" + "nightly-build");
  });

  it("does NOT truncate hex strings shorter than 8 chars (avoids ambiguity)", () => {
    // A 7-char hex string is too short to be a meaningful identifier on
    // its own. Fall through to the v-prefixed legacy path so the operator
    // sees the full value rather than a misleading 7-char truncation.
    expect(formatPendingVersion("abcdef0")).toBe("vabcdef0");
  });

  it("renders the short label inside the banner instead of the raw hash", () => {
    render(
      <UpdatePendingBannerClient pendingVersion={"a".repeat(64)} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /Platform update update-aaaaaaaa… is ready\./,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("a".repeat(40));
  });
});
