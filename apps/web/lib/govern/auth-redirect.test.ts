import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "./auth-redirect";

describe("resolveAuthRedirect (BI-86165533)", () => {
  it("sends the installed localhost form flow to /workspace", () => {
    // Default local install: base derived as localhost, relative redirectTo.
    expect(resolveAuthRedirect("/workspace", "http://localhost:3000")).toBe(
      "http://localhost:3000/workspace",
    );
  });

  it("normalizes a bind-all base so post-login is reachable, not inert", () => {
    // The failing case: trustHost derived the wildcard the server binds to, which
    // the browser cannot load — leaving the login form apparently inert.
    expect(resolveAuthRedirect("/workspace", "http://0.0.0.0:3000")).toBe(
      "http://localhost:3000/workspace",
    );
    expect(
      resolveAuthRedirect("http://0.0.0.0:3000/workspace", "http://0.0.0.0:3000"),
    ).toBe("http://localhost:3000/workspace");
  });

  it("allows same-origin absolute redirects and rejects cross-origin", () => {
    expect(
      resolveAuthRedirect("http://localhost:3000/build", "http://localhost:3000"),
    ).toBe("http://localhost:3000/build");
    // Cross-origin redirect falls back to the safe base.
    expect(
      resolveAuthRedirect("http://evil.example.com/x", "http://localhost:3000"),
    ).toBe("http://localhost:3000");
  });
});
