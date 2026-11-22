import {describe,expect,it} from "vitest";
import * as legacy_root from "./index";
import * as canonical_root from "@opendigitalproductfactory/dpf-scoped-judgment";
import * as legacy_scope from "../decision-scopes";
import * as canonical_scope from "@opendigitalproductfactory/dpf-scoped-judgment/decision-scopes";
import * as legacy_scopeBridge from "./scopes";
import * as canonical_scopeBridge from "@opendigitalproductfactory/dpf-scoped-judgment/decision-scopes";
import * as legacy_json from "../bounded-trusted-json";
import * as canonical_json from "@opendigitalproductfactory/dpf-scoped-judgment/bounded-trusted-json";
import * as legacy_scorer from "./option-scoring";
import * as canonical_scorer from "@opendigitalproductfactory/dpf-scoped-judgment/option-scoring";
import * as legacy_quality from "./mcda-quality-gates";
import * as canonical_quality from "@opendigitalproductfactory/dpf-scoped-judgment/quality-gates";
import * as legacy_identities from "./option-identities";
import * as canonical_identities from "@opendigitalproductfactory/dpf-scoped-judgment/option-identities";
import * as legacy_retry from "./uncertain-retry";
import * as canonical_retry from "@opendigitalproductfactory/dpf-scoped-judgment/uncertain-retry";
import * as legacy_advice from "./scoped-advice";
import * as canonical_advice from "@opendigitalproductfactory/dpf-scoped-judgment/scoped-advice";

const bridges = [
  ["./index",legacy_root,canonical_root],
  ["../decision-scopes",legacy_scope,canonical_scope],
  ["./scopes",legacy_scopeBridge,canonical_scopeBridge],
  ["../bounded-trusted-json",legacy_json,canonical_json],
  ["./option-scoring",legacy_scorer,canonical_scorer],
  ["./mcda-quality-gates",legacy_quality,canonical_quality],
  ["./option-identities",legacy_identities,canonical_identities],
  ["./uncertain-retry",legacy_retry,canonical_retry],
  ["./scoped-advice",legacy_advice,canonical_advice],
] as const;

describe.each(bridges)("shared judgment identity through %s",(_path,legacy,canonical)=>{
  it("preserves the complete public export set",()=>{
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(canonical).sort());
  });
  it("resolves every value to the canonical package instance",()=>{
    for(const key of Object.keys(canonical))
      expect((legacy as Record<string,unknown>)[key],key).toBe((canonical as Record<string,unknown>)[key]);
  });
});
