#!/usr/bin/env node
/**
 * Fail when a covered-root *.test.mjs is neither policy-guard inventory nor
 * deliberately allowlisted (BI-812C676D).
 */
import { checkTestInventoryCoverage } from "./lib/ci-policy-test-inventory.mjs";

const result = checkTestInventoryCoverage(process.cwd());
if (!result.ok) {
  console.error(result.messages.join("\n"));
  process.exit(1);
}
console.log(
  `CI policy test inventory: ${result.discovered.length} discovered, ` +
    `${result.inventory.length} inventory-listed, ` +
    `${result.allowlisted.length} allowlisted — ok.`,
);
