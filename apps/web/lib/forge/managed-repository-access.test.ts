import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/credential-crypto", () => ({
  decryptSecret: vi.fn((stored: string) => stored.replace(/^enc:/, "")),
}));

import {
  checkRepositoryAccess,
  credentialSlotForPurpose,
  deviceFlowPurposeFromDb,
  invalidateManagedRepositoryStatus,
  isRepositoryManagingInstall,
  loadManagedRepositoryStatus,
  managedRepositoryRemoteUrl,
  parseManagedRepositoryInput,
  readRepositoryVisibility,
  scopeForVisibilities,
  statusFromRepositoryResponse,
  visibilityFromResponse,
  type ManagedRepositoryDb,
} from "./managed-repository-access";

const TOKEN = "gho_supersecret_token_value";

function response(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

describe("parseManagedRepositoryInput", () => {
  it.each([
    ["acme/widgets"],
    ["https://github.com/acme/widgets"],
    ["https://github.com/acme/widgets.git"],
    ["git@github.com:acme/widgets.git"],
    ["  https://github.com/acme/widgets/  "],
  ])("accepts %s", (input) => {
    expect(parseManagedRepositoryInput(input)).toEqual({ forge: "github", owner: "acme", repo: "widgets", fullName: "acme/widgets" });
  });

  it.each([[""], ["   "], ["widgets"], ["https://gitlab.com/acme/widgets"], ["acme/widgets/extra"], [null]])("rejects %s", (input) => {
    expect(parseManagedRepositoryInput(input)).toBeNull();
  });

  it("writes the canonical remote URL", () => {
    expect(managedRepositoryRemoteUrl({ owner: "acme", repo: "widgets" })).toBe("https://github.com/acme/widgets.git");
  });
});

describe("purpose routing", () => {
  it("maps each purpose to one credential slot", () => {
    expect(credentialSlotForPurpose("hive-contribution")).toBe("hive-contribution");
    expect(credentialSlotForPurpose("repository-controller")).toBe("github-repository-controller");
  });

  it("reads a pre-column NULL session as hive contribution", () => {
    expect(deviceFlowPurposeFromDb(null)).toBe("hive-contribution");
    expect(deviceFlowPurposeFromDb("hive_contribution")).toBe("hive-contribution");
    expect(deviceFlowPurposeFromDb("repository_controller")).toBe("repository-controller");
  });
});

describe("scope from visibility", () => {
  it("asks for public_repo only when every repository is public", () => {
    expect(scopeForVisibilities(["public"])).toBe("public_repo");
    expect(scopeForVisibilities(["public", "private"])).toBe("repo");
    expect(scopeForVisibilities(["unknown"])).toBe("repo");
    expect(scopeForVisibilities([])).toBe("repo");
  });

  it("reads visibility from an unauthenticated answer; 404 is private", () => {
    expect(visibilityFromResponse({ status: 200, body: { private: false } })).toBe("public");
    expect(visibilityFromResponse({ status: 200, body: { private: true } })).toBe("private");
    expect(visibilityFromResponse({ status: 404 })).toBe("private");
    expect(visibilityFromResponse({ status: 403 })).toBe("unknown");
    expect(visibilityFromResponse({ status: 500 })).toBe("unknown");
  });

  it("sends no Authorization header and treats a network failure as unknown", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, { private: false }));
    await expect(readRepositoryVisibility({ owner: "acme", repo: "widgets" }, fetchImpl)).resolves.toBe("public");
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.github.com/repos/acme/widgets");
    expect(fetchImpl.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");

    const failing = vi.fn().mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(readRepositoryVisibility({ owner: "acme", repo: "widgets" }, failing)).resolves.toBe("unknown");
  });
});

describe("statusFromRepositoryResponse (spec §3.4)", () => {
  it.each([
    ["Connected with triage", 200, { permissions: { pull: true, triage: true } }, {}, "connected"],
    ["Connected with push", 200, { permissions: { pull: true, triage: false, push: true } }, {}, "connected"],
    ["Connected as admin", 200, { permissions: { pull: true, admin: true } }, {}, "connected"],
    ["Read only with pull alone", 200, { permissions: { pull: true, triage: false, push: false } }, {}, "read-only"],
    ["No access without pull", 200, { permissions: { pull: false } }, {}, "no-access"],
    ["No access without a permissions object", 200, {}, {}, "no-access"],
    ["No access on 404", 404, { message: "Not Found" }, {}, "no-access"],
    ["No access on 403", 403, { message: "Forbidden" }, { "x-ratelimit-remaining": "42" }, "no-access"],
    ["Login expired on 401", 401, { message: "Bad credentials" }, {}, "login-expired"],
    ["Couldn't check on a rate limit", 403, {}, { "x-ratelimit-remaining": "0" }, "check-failed"],
    ["Couldn't check on 429", 429, {}, {}, "check-failed"],
    ["Couldn't check on 502", 502, {}, {}, "check-failed"],
  ] as const)("%s", (_label, status, body, headers, expected) => {
    expect(statusFromRepositoryResponse({ status, body, header: (n) => (headers as Record<string, string>)[n] ?? null })).toBe(expected);
  });

  it("is Couldn't check when the network fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${TOKEN}`));
    await expect(checkRepositoryAccess({ owner: "acme", repo: "widgets" }, TOKEN, fetchImpl)).resolves.toBe("check-failed");
  });
});

describe("loadManagedRepositoryStatus", () => {
  function db(opts: { url?: string | null; cred?: { secretRef: string | null; status: string } | null }): ManagedRepositoryDb {
    return {
      platformDevConfig: { findUnique: vi.fn().mockResolvedValue(opts.url === undefined ? null : { upstreamRemoteUrl: opts.url }) },
      credentialEntry: { findUnique: vi.fn().mockResolvedValue(opts.cred ?? null) },
    };
  }

  beforeEach(() => invalidateManagedRepositoryStatus());

  it("is Not connected with no credential in the slot, and never calls GitHub", async () => {
    const fetchImpl = vi.fn();
    const view = await loadManagedRepositoryStatus(db({ url: "https://github.com/acme/widgets.git" }), { fetchImpl });
    expect(view.status).toBe("not-connected");
    expect(view.repository?.fullName).toBe("acme/widgets");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads only the controller slot", async () => {
    const store = db({ url: "https://github.com/acme/widgets.git" });
    await loadManagedRepositoryStatus(store, { fetchImpl: vi.fn() });
    expect(store.credentialEntry.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { providerId: "github-repository-controller" } }));
  });

  it("never substitutes a hardcoded repository when none is saved", async () => {
    const view = await loadManagedRepositoryStatus(db({ url: null, cred: { secretRef: `enc:${TOKEN}`, status: "active" } }), { fetchImpl: vi.fn() });
    expect(view.repository).toBeNull();
    expect(view.status).toBe("not-connected");
  });

  it("checks with the decrypted token, caches for five minutes, and never exposes the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { permissions: { pull: true, triage: true } }));
    const store = db({ url: "https://github.com/acme/widgets.git", cred: { secretRef: `enc:${TOKEN}`, status: "active" } });
    const now = new Date("2026-10-14T10:00:00Z");

    const first = await loadManagedRepositoryStatus(store, { fetchImpl, now });
    expect(first.status).toBe("connected");
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(first)).not.toContain(TOKEN);

    await loadManagedRepositoryStatus(store, { fetchImpl, now: new Date(now.getTime() + 60_000) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await loadManagedRepositoryStatus(store, { fetchImpl, now: new Date(now.getTime() + 60_000), force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await loadManagedRepositoryStatus(store, { fetchImpl, now: new Date(now.getTime() + 6 * 60_000) });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps the time of the last answered check when a later check fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { permissions: { pull: true, push: true } }))
      .mockRejectedValueOnce(new Error("offline"));
    const store = db({ url: "acme/widgets", cred: { secretRef: `enc:${TOKEN}`, status: "active" } });
    const t0 = new Date("2026-10-14T10:00:00Z");

    await loadManagedRepositoryStatus(store, { fetchImpl, now: t0 });
    const failed = await loadManagedRepositoryStatus(store, { fetchImpl, now: new Date(t0.getTime() + 60_000), force: true });

    expect(failed.status).toBe("check-failed");
    expect(failed.lastAnsweredAt).toBe(t0.toISOString());
  });

  it("treats an inactive credential as Not connected", async () => {
    const view = await loadManagedRepositoryStatus(db({ url: "acme/widgets", cred: { secretRef: null, status: "unconfigured" } }), { fetchImpl: vi.fn() });
    expect(view.status).toBe("not-connected");
  });
});

describe("isRepositoryManagingInstall (spec §3.1)", () => {
  const intent = (primaryPurpose: string, status: string) => ({ status: "valid" as const, intent: { primaryPurpose, confirmation: { status } } });

  it("is true only for a valid, confirmed evolve-dpf intent", () => {
    expect(isRepositoryManagingInstall(intent("evolve-dpf", "confirmed"))).toBe(true);
    expect(isRepositoryManagingInstall(intent("evolve-dpf", "proposed"))).toBe(false);
    expect(isRepositoryManagingInstall(intent("operate-organization", "confirmed"))).toBe(false);
    expect(isRepositoryManagingInstall({ status: "missing" })).toBe(false);
    expect(isRepositoryManagingInstall({ status: "invalid", error: "bad" })).toBe(false);
  });
});
