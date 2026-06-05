import { describe, it, expect } from "vitest";
import {
  assertBrowserSessionBindingInvariants,
  type BrowserSessionBindingInput,
} from "./session-binding";
import { browserSessionIntegrationId, BROWSER_SESSION_PROVIDER } from "./credentials";
import { serviceAccountPrincipalId } from "./identity";

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
