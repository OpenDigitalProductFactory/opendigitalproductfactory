// The caller-input contract for a `principle_decide` option set (BI-9889566B).
//
// One home for "is this option set well-formed enough to score": identity
// first, then the dimension features. Both refusals existed for the same
// reason — `make-silent-failures-observable` — but only the feature half was
// enforced, and the pack held the wiring for it inline.
//
// THE DEFECT THIS CLOSES
// `required` in an MCP tool inputSchema is documentation, not enforcement:
// nothing on the call path validates it (`coerceMcpToolArgs` only reshapes
// values). So an option that carried its identity under some other key — a
// caller writing `key` where the schema says `id` — arrived with `id: ""`.
// Every such option then collapsed onto the same entry of the id-keyed feature
// map built in evidence-grounding.ts: one feature map survived, all options
// were scored with it, every composite came back byte-identical, `optionId`
// echoed back empty, and `margin` was 0.000.
//
// The damage is that the result still LOOKED governed. `signalQuality.usable`
// was true and `featureCoverage.minKeys` reported the surviving map's width,
// so the abstention path added by BI-E0151DB2 never fired — it correctly
// observed that features had arrived, just not that three of them had been
// thrown away. The tool reported "uncertain / low-margin", which reads as a
// genuine close call rather than as scoring that could not discriminate at all.
//
// Two things had to change and both live here or next door:
//   1. A missing, blank or duplicated `id` is REFUSED, the same fail-fast
//      posture `ringScope` and unknown feature keys already get.
//   2. The feature handoff in evidence-grounding.ts is keyed by POSITION, not
//      by the caller-supplied id (see groundOptionsFromParams). Identity the
//      caller controls cannot be trusted to be unique; a position always is.
//      The refusal keeps ids meaningful; the positional handoff keeps scoring
//      correct even if some future path skips the refusal.

import {
  validateOptionFeatures,
  featureErrorRemedy,
  type FeatureValidationError,
} from "@/lib/decision/dimension-catalog";

/**
 * The option records the scoring path will actually see, in caller order.
 *
 * Single home for this filter: the grounding pass and the DecisionOption build
 * must walk the SAME records in the SAME order, because the features they
 * exchange are handed over positionally. Two independent `.filter()` calls
 * that happen to agree today are a silent misalignment waiting to happen.
 */
export function readOptionRecords(optionsParam: unknown[]): Record<string, unknown>[] {
  return optionsParam.filter(
    (o): o is Record<string, unknown> => typeof o === "object" && o !== null,
  );
}

export type OptionIdentityError = {
  index: number;
  field: "id" | "description";
  detail: string;
};

/** A refusal ready to be spread onto a failed ToolResult. */
export type OptionInputRejection = { message: string; error: string };

/**
 * Validate the identity fields the tool's own inputSchema marks required.
 *
 * A duplicate id is refused on the same grounds as a missing one: it collapses
 * identically, and the caller cannot tell which option the surviving row
 * describes.
 */
export function validateOptionIdentities(optionsParam: unknown[]): OptionIdentityError[] {
  const errors: OptionIdentityError[] = [];
  const seen = new Map<string, number>();
  optionsParam.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      errors.push({
        index,
        field: "id",
        detail: `option ${index} is not an object, so it carries no identity.`,
      });
      return;
    }
    const o = raw as Record<string, unknown>;
    const id = typeof o["id"] === "string" ? o["id"].trim() : "";
    if (id === "") {
      errors.push({
        index,
        field: "id",
        detail:
          `option ${index} has no \`id\`. Every option needs a stable, distinct \`id\` — ` +
          `the scores, the recommendation and the evidence map are all keyed on it` +
          (Object.keys(o).length > 0 ? `. Keys present: ${Object.keys(o).join(", ")}.` : "."),
      });
    } else if (seen.has(id)) {
      errors.push({
        index,
        field: "id",
        detail: `option ${index} reuses the \`id\` "${id}" already used by option ${seen.get(id)}; ids must be distinct.`,
      });
    } else {
      seen.set(id, index);
    }
    if (typeof o["description"] !== "string" || o["description"].trim() === "") {
      errors.push({
        index,
        field: "description",
        detail:
          `option ${index}${id ? ` ("${id}")` : ""} has no \`description\`; it is what the ` +
          `semantic path scores when an option carries no features.`,
      });
    }
  });
  return errors;
}

/**
 * The whole option-set input check, in the order a caller should hear about
 * problems: an option with no identity cannot even be NAMED in a feature
 * error, so identity is reported first and alone.
 *
 * Returns null when the set is well-formed.
 */
export function validateOptionInputs(optionsParam: unknown[]): OptionInputRejection | null {
  const identityErrors = validateOptionIdentities(optionsParam);
  if (identityErrors.length > 0) {
    return {
      message:
        `principle_decide rejected ${identityErrors.length} option identity problem(s): ` +
        identityErrors.map((e) => e.detail).join(" ") +
        " Each entry in `options` must be an object with a non-empty `id` (distinct across " +
        "the set) and a non-empty `description`. Both are declared required by the tool schema.",
      error: "Invalid option identity",
    };
  }

  const featureErrors: FeatureValidationError[] = [];
  for (const o of readOptionRecords(optionsParam)) {
    const f = o["features"];
    if (typeof f !== "object" || f === null || Array.isArray(f)) continue;
    featureErrors.push(
      ...validateOptionFeatures(String(o["id"]), f as Record<string, unknown>),
    );
  }
  if (featureErrors.length > 0) {
    return {
      message:
        `principle_decide rejected ${featureErrors.length} option feature(s): ` +
        featureErrors.map((e) => `[${e.optionId}] ${e.detail}`).join(" ") +
        ` ${featureErrorRemedy()}`,
      error: "Invalid option features",
    };
  }
  return null;
}
