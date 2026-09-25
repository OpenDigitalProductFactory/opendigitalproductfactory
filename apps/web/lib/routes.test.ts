import { describe, it, expect } from "vitest";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROUTES, TOKEN_LINK_ROUTES, tokenLinkUrl, type RoutePath } from "./routes";

describe("ROUTES", () => {
  it("maps the high-frequency section roots to absolute paths", () => {
    expect(ROUTES.compliance).toBe("/compliance");
    expect(ROUTES.employee).toBe("/employee");
    expect(ROUTES.ops).toBe("/ops");
    expect(ROUTES.portfolio).toBe("/portfolio");
  });

  it("every value is a rooted path with no trailing slash", () => {
    for (const path of Object.values(ROUTES)) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.length).toBeGreaterThan(1);
      expect(path.endsWith("/")).toBe(false);
    }
  });

  it("has no duplicate path values (each constant is distinct)", () => {
    const values = Object.values(ROUTES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("exposes a RoutePath union usable as a typed argument", () => {
    const p: RoutePath = ROUTES.finance;
    expect(p).toBe("/finance");
  });
});

describe("TOKEN_LINK_ROUTES", () => {
  // Emailed token links are opened by people who may not be signed in, so a
  // wrong path is a silent 404 with no compile error (BI-1876D718, BI-451F6E1C).
  it("every token link resolves to a real [token] page", () => {
    for (const path of Object.values(TOKEN_LINK_ROUTES)) {
      const page = join(__dirname, "..", "app", "(storefront)", path, "[token]", "page.tsx");
      expect(existsSync(page), `${path}/[token] has no page.tsx`).toBe(true);
    }
  });

  it("builds an absolute, encoded link without doubling slashes", () => {
    expect(tokenLinkUrl("https://acme.example/", "billApproval", "a/b c")).toBe(
      "https://acme.example/s/approve/a%2Fb%20c",
    );
    expect(tokenLinkUrl("https://acme.example", "expenseApproval", "t1")).toBe(
      "https://acme.example/s/expense-approve/t1",
    );
    expect(tokenLinkUrl("https://acme.example", "invoicePayment", "t2")).toBe(
      "https://acme.example/s/pay/t2",
    );
  });

  it("the email senders build token links only through tokenLinkUrl", () => {
    for (const file of ["ap.ts", "expenses.ts", "dunning.ts", "finance.ts"]) {
      const source = readFileSync(join(__dirname, "actions", file), "utf8");
      expect(source, `${file} hand-builds an emailed link`).not.toMatch(/\$\{baseUrl\}\//);
    }
  });
});
