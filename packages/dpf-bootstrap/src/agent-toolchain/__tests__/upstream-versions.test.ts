import { describe, it, expect } from "vitest";

import {
  PINNED_UPSTREAM_VERSIONS,
  detectSuperpowersDrift,
  renderUpstreamDriftAdvisory,
} from "../upstream-versions";

describe("detectSuperpowersDrift", () => {
  it("reports missing when no superpowers block is present", () => {
    const drift = detectSuperpowersDrift(`
[plugins."dpf-platform"]
enabled = true
`);
    expect(drift.status).toBe("missing");
    expect(drift.observed).toBeNull();
    expect(drift.pinned).toBe(PINNED_UPSTREAM_VERSIONS.superpowers);
  });

  it("reports match when superpowers block exists without a version pin", () => {
    const drift = detectSuperpowersDrift(`
[plugins."superpowers@openai-curated"]
enabled = true
`);
    expect(drift.status).toBe("match");
    expect(drift.observed).toBeNull();
  });

  it("reports match when superpowers block has the pinned version", () => {
    const drift = detectSuperpowersDrift(`
[plugins."superpowers@openai-curated"]
enabled = true
version = "${PINNED_UPSTREAM_VERSIONS.superpowers}"
`);
    expect(drift.status).toBe("match");
    expect(drift.observed).toBe(PINNED_UPSTREAM_VERSIONS.superpowers);
  });

  it("reports different when version differs from the pin", () => {
    const drift = detectSuperpowersDrift(`
[plugins."superpowers@openai-curated"]
enabled = true
version = "99.99.99"
`);
    expect(drift.status).toBe("different");
    expect(drift.observed).toBe("99.99.99");
    expect(drift.pinned).toBe(PINNED_UPSTREAM_VERSIONS.superpowers);
  });

  it("accepts the openai-bundled marketplace variant", () => {
    const drift = detectSuperpowersDrift(`
[plugins."superpowers@openai-bundled"]
enabled = true
`);
    expect(drift.status).toBe("match");
  });

  it("accepts a bare 'superpowers' key (no marketplace suffix)", () => {
    const drift = detectSuperpowersDrift(`
[plugins.superpowers]
enabled = true
`);
    expect(drift.status).toBe("match");
  });

  it("treats unparseable TOML as missing (defensive)", () => {
    const drift = detectSuperpowersDrift("[unterminated\nkey = ");
    expect(drift.status).toBe("missing");
  });

  it("handles empty input as missing", () => {
    const drift = detectSuperpowersDrift("");
    expect(drift.status).toBe("missing");
  });
});

describe("renderUpstreamDriftAdvisory", () => {
  it("returns null for a match", () => {
    expect(
      renderUpstreamDriftAdvisory({
        plugin: "superpowers",
        pinned: "0.1.0",
        observed: "0.1.0",
        status: "match",
      }),
    ).toBeNull();
  });

  it("returns null for missing", () => {
    expect(
      renderUpstreamDriftAdvisory({
        plugin: "superpowers",
        pinned: "0.1.0",
        observed: null,
        status: "missing",
      }),
    ).toBeNull();
  });

  it("returns an advisory line for different", () => {
    const advisory = renderUpstreamDriftAdvisory({
      plugin: "superpowers",
      pinned: "0.1.0",
      observed: "99.99.99",
      status: "different",
    });
    expect(advisory).not.toBeNull();
    expect(advisory).toMatch(/superpowers 99\.99\.99/);
    expect(advisory).toMatch(/DPF pin 0\.1\.0/);
    expect(advisory).toMatch(/advisory/);
  });

  it("advisory contains no substrate names or command snippets", () => {
    const advisory = renderUpstreamDriftAdvisory({
      plugin: "superpowers",
      pinned: "0.1.0",
      observed: "0.2.0",
      status: "different",
    });
    if (!advisory) throw new Error("expected advisory");

    const forbidden = [
      "config.toml",
      ".codex",
      "claude plugin install",
      "./scripts/",
      ".\\scripts\\",
    ];
    for (const s of forbidden) {
      expect(advisory.toLowerCase().includes(s.toLowerCase()), `advisory contained "${s}"`).toBe(false);
    }
  });
});
