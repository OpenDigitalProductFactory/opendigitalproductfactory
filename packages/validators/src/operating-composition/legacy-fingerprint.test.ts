import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveLegacyPromptClassRefs, legacyOperatingProfileMaterial, serializeLegacyMetadata } from "./legacy-fingerprint.js";

const hash = (value: unknown) => createHash("sha256").update(serializeLegacyMetadata(value)!).digest("hex");
const material = () => legacyOperatingProfileMaterial({ modelBinding: {
  default_model_id: null, pinned_provider_id: null, pinned_model_id: null, minimum_tier: null,
  budget_class: null, execution_type: null, temperature: null, max_tokens: null,
}, grantKeys: ["registry_read"], promptClassRefs: ["analysis:alias-skill"], hitlDefault: 2, sensitivity: "internal" });

describe("legacy issued fingerprint compatibility", () => {
  it("pins existing material and literal SHA-256 bytes", () => {
    expect(serializeLegacyMetadata(material())).toBe('{"hitl_default":2,"model_binding":{"budget_class":null,"default_model_id":null,"execution_type":null,"max_tokens":null,"minimum_tier":null,"pinned_model_id":null,"pinned_provider_id":null,"temperature":null},"prompt_class_refs":["analysis:alias-skill"],"sensitivity":"internal","tool_grants_sorted":["registry_read"]}');
    expect(hash(material())).toBe("bff4e251504d69ab780a31297588a6c5c1484d84b1234ce731b7e99b3af6b91c");
  });
  it("keeps JSON.stringify numeric keys, toJSON, omitted values and array ordering", () => {
    const value = { z: 1, "10": "ten", "2": "two", a: undefined,
      nested: { toJSON: () => ({ z: 2, a: 1 }) }, values: [undefined, NaN, -0] };
    expect(serializeLegacyMetadata(value)).toBe('{"2":"two","10":"ten","nested":{"a":1,"z":2},"values":[null,null,0],"z":1}');
    expect(serializeLegacyMetadata(undefined)).toBeUndefined();
    expect(() => hash(undefined)).toThrow();
  });
  it("preserves equivalent key ordering and material sorting without mutating caller arrays", () => {
    expect(hash({ a: 1, b: { d: 2, c: 3 } })).toBe(hash({ b: { c: 3, d: 2 }, a: 1 }));
    const grants = ["z", "a"], refs = ["z:prompt", "a:prompt"], base = material();
    const result = legacyOperatingProfileMaterial({ modelBinding: base.model_binding, grantKeys: grants,
      promptClassRefs: refs, hitlDefault: 2, sensitivity: "internal" });
    expect(result.tool_grants_sorted).toEqual(["a", "z"]);
    expect(result.prompt_class_refs).toEqual(["a:prompt", "z:prompt"]);
    expect(grants).toEqual(["z", "a"]); expect(refs).toEqual(["z:prompt", "a:prompt"]);
  });
  it("retains prompt label fallback, duplicates and empty task strings exactly", () => {
    expect(deriveLegacyPromptClassRefs([{ label: "b", taskType: null }, { label: "a", taskType: "" }, { label: "b", taskType: null }]))
      .toEqual([":a", "conversation:b", "conversation:b"]);
  });
  it.each(["hitl_default", "sensitivity", "tool_grants_sorted", "prompt_class_refs", "model_binding"] as const)("changes digest for material %s", field => {
    const original = material(), changed = { ...original, [field]: "changed" };
    expect(hash(changed)).not.toBe(hash(original));
  });
});
