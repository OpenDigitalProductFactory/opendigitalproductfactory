import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/docs-asset/[...path]", () => {
  it("serves a committed user-guide diagram from its authored asset path", async () => {
    const response = await GET(
      new Request("http://localhost/api/docs-asset/assets/diagrams/index/0.svg"),
      { params: Promise.resolve({ path: ["assets", "diagrams", "index", "0.svg"] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect((await response.text()).startsWith("<svg")).toBe(true);
  });
});
