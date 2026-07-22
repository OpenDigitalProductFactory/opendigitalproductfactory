// node --test — pure classifier coverage for the route-classification ratchet.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  routePath,
  routeGroup,
  isDynamicRoute,
  unclassifiedRoutes,
} from "./lib/route-classification.mjs";

test("routePath strips (route-group) segments and the page file", () => {
  assert.equal(routePath("apps/web/app/(shell)/finance/page.tsx"), "/finance");
  assert.equal(routePath("apps/web/app/(auth)/login/page.tsx"), "/login");
  assert.equal(routePath("apps/web/app/(shell)/page.tsx"), "/");
  assert.equal(
    routePath("apps/web/app/(storefront)/s/[slug]/book/[itemId]/page.tsx"),
    "/s/[slug]/book/[itemId]",
  );
});

test("routeGroup returns the leading (group) or (root)", () => {
  assert.equal(routeGroup("apps/web/app/(shell)/finance/page.tsx"), "(shell)");
  assert.equal(routeGroup("apps/web/app/page.tsx"), "(root)");
});

test("isDynamicRoute detects [param] segments", () => {
  assert.equal(isDynamicRoute("/s/[slug]/book/[itemId]"), true);
  assert.equal(isDynamicRoute("/finance"), false);
});

test("classify resolves in this precedence: nav-model > detail > legacy-redirect > unclassified", () => {
  const navModelPaths = new Set(["/finance"]);
  assert.equal(
    classify({ route: "/finance", dynamic: false, isRedirect: false, navModelPaths }),
    "nav-model",
  );
  // A dynamic route that is also in the model still resolves via the model.
  assert.equal(
    classify({ route: "/finance", dynamic: true, isRedirect: false, navModelPaths }),
    "nav-model",
  );
  assert.equal(
    classify({ route: "/s/[slug]", dynamic: true, isRedirect: false, navModelPaths }),
    "detail",
  );
  assert.equal(
    classify({ route: "/admin/storefront", dynamic: false, isRedirect: true, navModelPaths }),
    "legacy-redirect",
  );
  assert.equal(
    classify({ route: "/platform/some-orphan", dynamic: false, isRedirect: false, navModelPaths }),
    "unclassified",
  );
});

test("unclassifiedRoutes returns distinct sorted unclassified route paths", () => {
  const manifest = [
    { route: "/b", classification: "unclassified" },
    { route: "/a", classification: "unclassified" },
    { route: "/a", classification: "unclassified" },
    { route: "/c", classification: "nav-model" },
  ];
  assert.deepEqual(unclassifiedRoutes(manifest), ["/a", "/b"]);
});
