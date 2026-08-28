import { describe, expect, it } from "vitest";

import { resolveOrganizationTrustAnchor } from "@/lib/federation/organization-trust-anchor";
import {
  createOrganizationTrustAnchorStore,
  JOIN_IMPORT_ACTION_TYPE,
  JOIN_IMPORT_COMPLETED_STATUS,
  type TrustAnchorStoreDb,
} from "@/lib/federation/organization-trust-anchor-store";

const ROOT_FINGERPRINT = "a".repeat(64);
const NOW = new Date("2026-08-26T00:00:00.000Z");

/** A join package the REAL parser accepts, so these tests cannot drift from it. */
function joinPackage(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    package_id: "b".repeat(32),
    ca_url: "https://ca.internal/",
    root_fingerprint: ROOT_FINGERPRINT,
    intended_hostname: "dpf-dev.local",
    expires_at: String(Math.floor(NOW.getTime() / 1000) + 86_400),
    enrollment_token: "enrollment-token",
    edge_client_enrollment_token: "edge-token",
    ...overrides,
  };
  return [
    "DPF_ORGANIZATION_JOIN_V2",
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
  ].join("\n");
}

interface DbOptions {
  joinImport?: { parameters: unknown; completedAt: Date | null; createdAt: Date } | null;
  estateName?: string | null;
}

function db(options: DbOptions = {}): { db: TrustAnchorStoreDb; queries: unknown[] } {
  const queries: unknown[] = [];
  return {
    queries,
    db: {
      remoteAction: {
        async findFirst(args) {
          queries.push(args);
          return options.joinImport ?? null;
        },
      },
      platformConfig: {
        async findUnique() {
          if (!options.estateName) return null;
          return {
            value: {
              schemaVersion: 1,
              estateName: options.estateName,
              source: "operator",
              declaredAt: NOW.toISOString(),
              declaredByPrincipalId: "PRN-test",
            },
          };
        },
      },
    },
  };
}

function store(options: DbOptions & { env?: Record<string, string | undefined> } = {}) {
  const { db: fake, queries } = db(options);
  return {
    queries,
    store: createOrganizationTrustAnchorStore(fake, {
      env: options.env ?? {},
      // Installer state lives on disk; refusing to read it keeps these tests
      // hermetic and proves the tier is optional rather than required.
      readText: async () => {
        throw new Error("no installer state");
      },
    }),
  };
}

describe("createOrganizationTrustAnchorStore — the reads behind a real anchor", () => {
  it("reads only a COMPLETED join import, so a queued or failed one cannot establish trust", async () => {
    const { store: subject, queries } = store();
    await subject.findLatestCompletedJoinImport();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      where: {
        actionType: JOIN_IMPORT_ACTION_TYPE,
        status: JOIN_IMPORT_COMPLETED_STATUS,
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns the estate as the organization ref, not the tenant organization", async () => {
    const { store: subject } = store({ estateName: "Northwind" });
    expect(await subject.findLocalOrganizationRef()).toBe("northwind");
  });

  it("absorbs the drift two operators actually produce — spacing and case", async () => {
    const a = store({ estateName: "North Wind" });
    const b = store({ estateName: "  north   wind  " });
    expect(await a.store.findLocalOrganizationRef()).toBe(
      await b.store.findLocalOrganizationRef(),
    );
  });

  it("keeps distinct estate names distinct, because this value gates trust", async () => {
    // `slugifyEstateName` would collapse both of these to "north-wind" and make
    // two unrelated estates one trust root. The normal form must not.
    const spaced = store({ estateName: "North Wind" });
    const hyphenated = store({ estateName: "North-Wind" });
    expect(await spaced.store.findLocalOrganizationRef()).not.toBe(
      await hyphenated.store.findLocalOrganizationRef(),
    );
  });

  it("has no organization ref when nobody has named the estate", async () => {
    const { store: subject } = store({ estateName: null });
    expect(await subject.findLocalOrganizationRef()).toBeNull();
  });

  it("honours the process override above a portal declaration", async () => {
    const { store: subject } = store({
      estateName: "Declared Estate",
      env: { DPF_ESTATE_NAME: "Override Estate" },
    });
    expect(await subject.findLocalOrganizationRef()).toBe("override estate");
  });
});

describe("resolveOrganizationTrustAnchor with the production store", () => {
  const decrypt = (value: string) => value;

  it("establishes an anchor carrying the FULL root fingerprint", async () => {
    const { store: subject } = store({
      estateName: "Northwind",
      joinImport: {
        parameters: { joinPackageEnc: joinPackage() },
        completedAt: NOW,
        createdAt: NOW,
      },
    });

    const resolution = await resolveOrganizationTrustAnchor(subject, { decrypt, now: NOW });

    expect(resolution.established).toBe(true);
    expect(resolution.anchor).toEqual({
      rootFingerprint: ROOT_FINGERPRINT,
      organizationRef: "northwind",
    });
  });

  it("refuses when the estate is unnamed, because the install cannot say which trust root it belongs to", async () => {
    const { store: subject } = store({
      estateName: null,
      joinImport: {
        parameters: { joinPackageEnc: joinPackage() },
        completedAt: NOW,
        createdAt: NOW,
      },
    });

    const resolution = await resolveOrganizationTrustAnchor(subject, { decrypt, now: NOW });

    expect(resolution.established).toBe(false);
    expect(resolution).toMatchObject({
      reason: "no-local-organization",
      anchor: { rootFingerprint: null, organizationRef: null },
    });
  });

  it("refuses an expired package rather than trusting a stale root", async () => {
    const { store: subject } = store({
      estateName: "Northwind",
      joinImport: {
        parameters: {
          joinPackageEnc: joinPackage({
            expires_at: String(Math.floor(NOW.getTime() / 1000) - 1),
          }),
        },
        completedAt: NOW,
        createdAt: NOW,
      },
    });

    const resolution = await resolveOrganizationTrustAnchor(subject, { decrypt, now: NOW });

    expect(resolution.established).toBe(false);
    expect(resolution).toMatchObject({ reason: "package-expired" });
  });

  it("refuses when no join import exists at all", async () => {
    const { store: subject } = store({ estateName: "Northwind" });
    const resolution = await resolveOrganizationTrustAnchor(subject, { decrypt, now: NOW });
    expect(resolution).toMatchObject({ established: false, reason: "no-join-import" });
  });
});
