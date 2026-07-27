import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    apiToken: {},
  },
}));

import { signAccessToken, verifyAccessToken } from "./jwt";

describe("JWT authentication evidence", () => {
  const previousSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "effective-auth-context-test-secret";
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previousSecret;
    }
  });

  it("preserves issuer-asserted RFC 8176 methods and context class", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      email: "user@example.com",
      platformRole: "HR-300",
      isSuperuser: false,
      amr: ["pwd", "otp"],
      acr: "urn:example:assurance:2",
    });

    await expect(verifyAccessToken(token)).resolves.toMatchObject({
      amr: ["pwd", "otp"],
      acr: "urn:example:assurance:2",
    });
  });

  it("does not invent assurance when the issuer asserted none", async () => {
    const token = await signAccessToken({
      sub: "user-1",
      email: "user@example.com",
      platformRole: null,
      isSuperuser: false,
    });

    await expect(verifyAccessToken(token)).resolves.toMatchObject({
      amr: undefined,
      acr: null,
    });
  });
});
