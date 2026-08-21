// scripts/measure-doc-cadence-coverage.test.mjs
//
// Tests the DETECTION, not the current counts. The counts move every time a page
// is improved; what must not move is whether a signal fires on prose that
// genuinely answers the question and stays silent on prose that does not.
//
// The specific regression guarded here is real: the first cut of the boundary
// signal matched bare "never" and "cannot", which occur in ordinary prose, and
// scored 54 of 56 pages as answering a question almost none of them answered.
// An over-reporting checklist claims the work is done when it is not.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_ELEMENTS,
  detectElements,
  frontmatterArea,
  AUTOMATED_AREAS,
} from "./measure-doc-cadence-coverage.mjs";

test("frontmatterArea reads the area, quoted or bare", () => {
  assert.equal(frontmatterArea('---\ntitle: "X"\narea: compliance\n---\nbody'), "compliance");
  assert.equal(frontmatterArea('---\narea: "ai-workforce"\n---\nbody'), "ai-workforce");
});

test("frontmatterArea returns null without frontmatter", () => {
  assert.equal(frontmatterArea("# Just a heading\n"), null);
});

test("every contract element has a detector", () => {
  const found = detectElements("");
  assert.deepEqual(Object.keys(found).sort(), [...CONTRACT_ELEMENTS].sort());
});

test("empty prose answers nothing", () => {
  const f = detectElements("A page about screens and records.");
  for (const k of CONTRACT_ELEMENTS) assert.equal(f[k], false, `${k} fired on empty prose`);
});

test("boundary does NOT fire on ordinary prose containing never/cannot", () => {
  // The exact false positive that made the first measurement useless.
  const prose = "You can never be too careful. A view-only account cannot edit the record.";
  assert.equal(detectElements(prose).boundary, false);
});

test("boundary fires when the limit is attributed to the automation", () => {
  assert.equal(
    detectElements("The coworker does not renew a licence on your behalf.").boundary,
    true,
  );
  assert.equal(
    detectElements("Consequential actions require your approval before they run.").boundary,
    true,
  );
});

test("cadence fires on a stated frequency, not on the word schedule alone", () => {
  assert.equal(detectElements("The sweep runs nightly.").cadence, true);
  assert.equal(detectElements("Open the scheduling screen.").cadence, false);
});

test("currency fires on staying-current language", () => {
  assert.equal(
    detectElements("It watches for changes to the official source.").currency,
    true,
  );
});

test("humanStep does NOT fire on a bare 'confirm'", () => {
  // "confirm" appears in almost every workflow page; it is not a statement of
  // what the human must still do that no cadence removes.
  assert.equal(detectElements("Confirm the dialog to continue.").humanStep, false);
});

test("humanStep fires on an explicit human responsibility", () => {
  assert.equal(detectElements("You must own the renewal calendar.").humanStep, true);
});

test("automated areas are declared explicitly, never inferred", () => {
  // A wrong inference would demand cadence prose on a page documenting nothing
  // automatic, and a checklist full of rows that should not be on it gets ignored.
  assert.ok(Object.keys(AUTOMATED_AREAS).length > 0);
  for (const [area, why] of Object.entries(AUTOMATED_AREAS)) {
    assert.match(area, /^[a-z-]+$/);
    assert.ok(why.length > 10, `${area} must say what automates it`);
  }
});
