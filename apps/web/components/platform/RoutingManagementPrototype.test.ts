// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(import.meta.dirname, "../../../../docs/ux-fit/2026-10-12-routing-management/routing-explorer.html"), "utf8");
const payload = '<img src=x data-injected="true">';
function preview(setup: string) {
  const fixture = document.implementation.createHTMLDocument("Routing preview");
  fixture.documentElement.innerHTML = html;
  const script = fixture.querySelector("script")!.textContent!;
  const observer = class { observe() {} unobserve() {} disconnect() {} };
  // Execute the actual standalone fixture in an isolated document. Inject only
  // test state before its private closure ends; no production export is needed.
  new Function("document", "ResizeObserver", script.replace(/\}\)\(\);\s*$/, `${setup}\n})();`))(fixture, observer);
  return fixture;
}

describe("routing prototype HTML boundaries", () => {
  it("renders assessment verdicts as text in the request overlay", () => {
    const fixture = preview(`state.feedback[records[0].id]={verdict:${JSON.stringify(payload)},note:'test'}; state.tab='Outcome & feedback'; document.getElementById('dialog-content').innerHTML=requestDetail(records[0]);`);
    const content = fixture.getElementById("dialog-content")!;
    expect(content.querySelector("[data-injected]")).toBeNull();
    expect(content.textContent).toContain(payload);
  });
  it("keeps override identifiers inside the revoke button attribute", () => {
    const id = 'preview-" data-injected="true';
    const fixture = preview(`state.overrides=[{id:${JSON.stringify(id)},provider:providers[0].id,levels:['internal'],reason:'Test rationale',expires:new Date(Date.now()+86_400_000).toISOString()}]; document.getElementById('settings-content').innerHTML=clearanceSettings(providers[0]);`);
    const content = fixture.getElementById("settings-content")!;
    expect(content.querySelector("[data-injected]")).toBeNull();
    expect(content.querySelector("[data-revoke-clearance]")?.getAttribute("data-revoke-clearance")).toBe(id);
  });
});
