// Run: node --test scripts/ci-change-scope.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyChangedFiles } from "./ci-change-scope.mjs";

test("docs-only changes skip heavy and mobile CI", () => {
  assert.deepEqual(classifyChangedFiles(["docs/user-guide/mobile.md", "README.md"]), {
    heavy: false,
    mobile: false,
    docsOnly: true,
    mobileOnly: false,
  });
});

for (const executableStandardPath of [
  "docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md",
  "docs/architecture/four-portfolio-archetype-standard-profile-catalog.md",
]) {
  test(`${executableStandardPath} requires heavy workspace CI`, () => {
    assert.deepEqual(classifyChangedFiles([executableStandardPath]), {
      heavy: true,
      mobile: false,
      docsOnly: false,
      mobileOnly: false,
    });
  });
}

test("mobile app-only changes skip heavy CI and run mobile CI", () => {
  assert.deepEqual(classifyChangedFiles(["apps/mobile/src/session.ts", "apps/mobile/__tests__/session.test.ts"]), {
    heavy: false,
    mobile: true,
    docsOnly: false,
    mobileOnly: true,
  });
});

test("mobile app changes may include documentation without becoming heavy", () => {
  assert.deepEqual(classifyChangedFiles(["apps/mobile/app/index.tsx", "docs/user-guide/mobile-app.md"]), {
    heavy: false,
    mobile: true,
    docsOnly: false,
    mobileOnly: true,
  });
});

test("shared package changes run full CI and the mobile lane", () => {
  assert.deepEqual(classifyChangedFiles(["packages/types/src/mobile-manifest.ts"]), {
    heavy: true,
    mobile: true,
    docsOnly: false,
    mobileOnly: false,
  });
});

test("web changes run full CI without the mobile lane", () => {
  assert.deepEqual(classifyChangedFiles(["apps/web/components/admin/Panel.tsx"]), {
    heavy: true,
    mobile: false,
    docsOnly: false,
    mobileOnly: false,
  });
});

test("empty diff fails safe to full and mobile CI", () => {
  assert.deepEqual(classifyChangedFiles([]), {
    heavy: true,
    mobile: true,
    docsOnly: false,
    mobileOnly: false,
  });
});
