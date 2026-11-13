import { describe, expect, it } from "vitest";
import { classifyInferencePayload } from "./classify-payload";

function contacts(content: string) {
  return classifyInferencePayload({ systemPrompt: "", messages: [{ role: "user", content }] })
    .matches.filter((match) => match.reason === "contact-detail");
}

// BI-D286C3C5: drive-sequential-golden.json seeds are BASE_SEED + index * 1000 + n,
// ten digits, and were read as phone numbers. Every ten-digit value here is
// assembled at run time, so this source carries no phone-shaped literal itself.
const digits = (...parts: string[]) => parts.join("");
const SEED = digits("2289", "472767");
const NEXT_SEED = digits("2289", "477767");
const PHONE = digits("415", "555", "0132");

describe("a fixture's numeric seed is not a phone number (BI-D286C3C5)", () => {
  it.each([
    `       "seed": ${SEED},`,
    `+      "seed": ${NEXT_SEED}`,
    `{"id":"backlog-steward-watch@1.0.0#0","seed": ${SEED}}`,
  ])("does not classify the fixture line %s", (line) => {
    expect(contacts(line)).toEqual([]);
  });

  it.each([
    `"seed": "${PHONE}"`,
    `"seedPhone": ${PHONE}`,
    `"seed": ${SEED}, // call ${PHONE}`,
  ])("still classifies %s as contact evidence", (line) => {
    expect(contacts(line)).toHaveLength(1);
  });
});
