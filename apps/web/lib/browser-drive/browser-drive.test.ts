import { describe, it, expect } from "vitest";
import {
  assertBrowserSessionBindingInvariants,
  type BrowserSessionBindingInput,
} from "./session-binding";
import { browserSessionIntegrationId, BROWSER_SESSION_PROVIDER } from "./credentials";
import { serviceAccountPrincipalId } from "./identity";
import { selectMeans, meansFeatures, type MeansSelectionTask } from "./select-means";
import { isDestructiveBrowserAction } from "./envelope";
import { M1DeterministicDriver, M3DelegatedDriver } from "./means-m2-plugin";

const base: BrowserSessionBindingInput = {
  sessionId: "sess-1",
  means: "plugin",
  engine: "chromium",
  profileRef: "/profiles/browser-svc:substack:default/substack/",
  profileKind: "service-account",
  attended: false,
  delegatingUserId: "user-1",
  actingPrincipalId: "browser-svc:substack:default",
  targetDomains: ["substack.com"],
};

describe("assertBrowserSessionBindingInvariants (EP-BROWSER-DRIVE §8.7)", () => {
  it("accepts a well-formed service-account session", () => {
    expect(() => assertBrowserSessionBindingInvariants(base)).not.toThrow();
  });

  it("accepts an attended operator-live session (no acting principal needed)", () => {
    expect(() =>
      assertBrowserSessionBindingInvariants({
        ...base,
        profileKind: "operator-live",
        attended: true,
        actingPrincipalId: null,
      }),
    ).not.toThrow();
  });

  it("rejects operator-live profiles that are not attended (Verdict 3)", () => {
    expect(() =>
      assertBrowserSessionBindingInvariants({
        ...base,
        profileKind: "operator-live",
        attended: false,
        actingPrincipalId: null,
      }),
    ).toThrow(/attended-only/);
  });

  it("rejects service-account profiles with no acting principal", () => {
    expect(() =>
      assertBrowserSessionBindingInvariants({ ...base, actingPrincipalId: null }),
    ).toThrow(/actingPrincipalId/);
  });

  it("rejects non-Chromium engines as undriveable (§4.10)", () => {
    expect(() =>
      assertBrowserSessionBindingInvariants({ ...base, engine: "safari" }),
    ).toThrow(/Chromium/);
    expect(() =>
      assertBrowserSessionBindingInvariants({ ...base, engine: "firefox" }),
    ).toThrow(/Chromium/);
  });
});

describe("deterministic identifiers (Q3 / §8.8)", () => {
  it("browserSessionIntegrationId is deterministic and namespaced per (principal, site)", () => {
    const id = browserSessionIntegrationId("browser-svc:substack:default", "substack");
    expect(id).toBe("browser-session:browser-svc:substack:default:substack");
    expect(id.startsWith(`${BROWSER_SESSION_PROVIDER}:`)).toBe(true);
    // distinct sites → distinct ids; same inputs → same id
    expect(browserSessionIntegrationId("p", "siteA")).not.toBe(
      browserSessionIntegrationId("p", "siteB"),
    );
    expect(browserSessionIntegrationId("p", "s")).toBe(browserSessionIntegrationId("p", "s"));
  });

  it("serviceAccountPrincipalId is deterministic per (site, account)", () => {
    expect(serviceAccountPrincipalId("substack", "default")).toBe("browser-svc:substack:default");
    expect(serviceAccountPrincipalId("substack", "a")).not.toBe(
      serviceAccountPrincipalId("substack", "b"),
    );
  });
});

const novelOperatorTask: MeansSelectionTask = {
  outwardSideEffect: 0.2,
  siteVolatility: 0.9,
  recurrence: 0.1,
  needsOperatorSession: 0.8,
  hasRecordedScript: false,
};

describe("selectMeans (Verdict 1 — per-task means selection)", () => {
  it("short-circuits to deterministic when a recorded script exists (no WWMD round-trip)", async () => {
    const result = await selectMeans(
      { ...novelOperatorTask, hasRecordedScript: true },
      {
        userId: "u",
        toolExecutor: async () => {
          throw new Error("principle_decide must NOT be called when a recorded script exists");
        },
      },
    );
    expect(result.means).toBe("deterministic");
    expect(result.status).toBe("shortcut-recorded");
  });

  it("returns the WWMD-recommended means + ledger, scoped to the means-select surface", async () => {
    const exec = async (tool: string, args: Record<string, unknown>) => {
      expect(tool).toBe("principle_decide");
      expect(args.callingSurface).toBe("browser-drive-means-select");
      expect(Array.isArray(args.options)).toBe(true);
      expect((args.options as unknown[]).length).toBe(3);
      return {
        success: true,
        data: {
          recommendation: { optionId: "plugin", confidence: "high", margin: 2.1 },
          scores: [{ optionId: "plugin" }],
          reasoning: "novel site, operator session available",
        },
      };
    };
    const result = await selectMeans(novelOperatorTask, { userId: "u", toolExecutor: exec });
    expect(result.means).toBe("plugin");
    expect(result.status).toBe("recommended");
    expect(result.margin).toBe(2.1);
    expect(result.ledger).toEqual([{ optionId: "plugin" }]);
  });

  it("flags needs-human when confidence is not high", async () => {
    const result = await selectMeans(novelOperatorTask, {
      userId: "u",
      toolExecutor: async () => ({
        success: true,
        data: { recommendation: { optionId: "delegated", confidence: "low", margin: 0.1 } },
      }),
    });
    expect(result.status).toBe("needs-human");
  });

  it("meansFeatures yields all three means with features bounded to 0..1", () => {
    const f = meansFeatures(novelOperatorTask);
    for (const means of ["deterministic", "plugin", "delegated"] as const) {
      expect(f[means]).toBeTruthy();
      for (const v of Object.values(f[means])) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("destructive-action classification + stub conformance", () => {
  it("classifies outward irreversible actions as destructive", () => {
    for (const a of ["publish", "submit", "send", "order", "configure"]) {
      expect(isDestructiveBrowserAction(a)).toBe(true);
    }
    for (const a of ["read", "extract", "navigate", "screenshot"]) {
      expect(isDestructiveBrowserAction(a)).toBe(false);
    }
  });

  it("M1/M3 stubs conform to BrowserDriver but throw not-implemented", async () => {
    expect(new M1DeterministicDriver().means).toBe("deterministic");
    expect(new M3DelegatedDriver().means).toBe("delegated");
    await expect(new M1DeterministicDriver().open()).rejects.toThrow(/not implemented/i);
    await expect(new M3DelegatedDriver().act()).rejects.toThrow(/not implemented/i);
  });
});
