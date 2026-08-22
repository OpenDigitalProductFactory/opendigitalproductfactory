import { describe, expect, it } from "vitest";

import { connectorRegistry } from "./index";

describe("production connector registry", () => {
  it("registers the outbound-only WordPress connector", () => {
    const entry = connectorRegistry.get("wordpress-self-hosted");
    expect(entry?.definition).toMatchObject({
      callback: { kind: "none" },
      auth: { kind: "api-key" },
      sync: { kind: "incremental" },
    });
  });
});
