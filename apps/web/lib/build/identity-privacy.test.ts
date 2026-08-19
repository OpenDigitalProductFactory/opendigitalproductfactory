import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    credentialEntry: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  getPlatformIdentity,
  getDisplayPseudonym,
  detectHostnameLeaks,
  redactHostnames,
  generatePrivateBranchName,
  generateAnonymousCommitMessage,
  __resetPlatformIdentityCacheForTests,
} from "./identity-privacy";

const mockConfigFind = vi.mocked(prisma.platformDevConfig.findUnique);

// A plausible seeded row: clientId is a UUID; gitAgentEmail is
// "agent-<16-char-sha256-of-clientId>@hive.dpf". The first 8 chars of that
// hash are what we expect to appear in the author name.
const SEEDED_CLIENT_ID = "b8f3c1a2-4d5e-6f7a-8b9c-0d1e2f3a4b5c";
const SEEDED_EMAIL = "agent-a1b2c3d4e5f67890@hive.dpf";
const EXPECTED_SHORT_ID = "a1b2c3d4";
const EXPECTED_AUTHOR_NAME = `dpf-agent-${EXPECTED_SHORT_ID}`;

function seededConfigRow() {
  return {
    clientId: SEEDED_CLIENT_ID,
    gitAgentEmail: SEEDED_EMAIL,
  } as Awaited<ReturnType<typeof prisma.platformDevConfig.findUnique>>;
}

describe("getPlatformIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPlatformIdentityCacheForTests();
  });

  it("derives authorName from the email hash prefix", async () => {
    mockConfigFind.mockResolvedValue(seededConfigRow());

    const identity = await getPlatformIdentity();

    expect(identity.authorName).toBe(EXPECTED_AUTHOR_NAME);
    expect(identity.authorEmail).toBe(SEEDED_EMAIL);
    expect(identity.shortId).toBe(EXPECTED_SHORT_ID);
    expect(identity.clientId).toBe(SEEDED_CLIENT_ID);
  });

  it("builds a DCO signoff with the pseudonym, not the hardcoded literal", async () => {
    mockConfigFind.mockResolvedValue(seededConfigRow());

    const identity = await getPlatformIdentity();

    expect(identity.dcoSignoff).toBe(
      `Signed-off-by: ${EXPECTED_AUTHOR_NAME} <${SEEDED_EMAIL}>`,
    );
    // Guard against regression to the old flat identity.
    expect(identity.dcoSignoff).not.toMatch(/Signed-off-by: dpf-agent </);
  });

  it("throws a clear error when identity has not been seeded", async () => {
    mockConfigFind.mockResolvedValue(null);

    await expect(getPlatformIdentity()).rejects.toThrow(
      /Platform identity not initialized/,
    );
  });

  it("rejects malformed gitAgentEmail rather than producing a truncated pseudonym", async () => {
    mockConfigFind.mockResolvedValue({
      clientId: SEEDED_CLIENT_ID,
      gitAgentEmail: "agent-abc@hive.dpf", // hash too short
    } as Awaited<ReturnType<typeof prisma.platformDevConfig.findUnique>>);

    await expect(getPlatformIdentity()).rejects.toThrow(
      /unexpected format/,
    );
  });
});

describe("getDisplayPseudonym", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetPlatformIdentityCacheForTests();
  });

  it("returns the pseudonym used in PR/issue metadata", async () => {
    mockConfigFind.mockResolvedValue(seededConfigRow());
    await expect(getDisplayPseudonym()).resolves.toBe(EXPECTED_AUTHOR_NAME);
  });

  it("shares the cached identity with getPlatformIdentity", async () => {
    mockConfigFind.mockResolvedValue(seededConfigRow());

    await getDisplayPseudonym();
    await getPlatformIdentity();

    // Only one DB read — cache is shared across both helpers.
    expect(mockConfigFind).toHaveBeenCalledTimes(1);
  });
});

describe("detectHostnameLeaks + redactHostnames", () => {
  it("detects a Windows desktop hostname", () => {
    expect(detectHostnameLeaks("Committed from DESKTOP-ABC123")).toContain("DESKTOP-ABC123");
  });

  it("redacts detected patterns", () => {
    expect(redactHostnames("ran on LAPTOP-XYZ99")).toBe("ran on [redacted]");
  });

  it("leaves clean text alone", () => {
    expect(detectHostnameLeaks("feat: add button")).toHaveLength(0);
    expect(redactHostnames("feat: add button")).toBe("feat: add button");
  });
});

describe("generatePrivateBranchName", () => {
  it("uses clientId-derived prefix (unchanged behavior — backwards compat)", () => {
    const branch = generatePrivateBranchName("b8f3c1a2-4d5e-6f7a-8b9c-0d1e2f3a4b5c", "Add Login Button");
    // First 8 hex chars of the UUID (hyphens stripped), slug lowercased.
    expect(branch).toBe("dpf/b8f3c1a2/add-login-button");
  });
});

describe("generateAnonymousCommitMessage", () => {
  beforeEach(() => {
    __resetPlatformIdentityCacheForTests();
  });

  it("includes the pseudonym in the Author line", () => {
    const identity = {
      authorName: EXPECTED_AUTHOR_NAME,
      authorEmail: SEEDED_EMAIL,
      clientId: SEEDED_CLIENT_ID,
      shortId: EXPECTED_SHORT_ID,
      dcoSignoff: `Signed-off-by: ${EXPECTED_AUTHOR_NAME} <${SEEDED_EMAIL}>`,
    };

    const msg = generateAnonymousCommitMessage({
      title: "add tooltip",
      buildId: "B-123",
      productId: "dpf-portal",
      platformIdentity: identity,
    });

    expect(msg).toContain(`Author: ${EXPECTED_AUTHOR_NAME} (AI Coworker)`);
    expect(msg).toContain(identity.dcoSignoff);
    expect(msg).toContain("Build: B-123");
    expect(msg).toContain("Product: dpf-portal");
  });
});
