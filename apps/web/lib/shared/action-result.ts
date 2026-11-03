// BI-DBA1FE11: the canonical result contract lives in the portable validators
// package. Retain this import bridge for the existing app callers until their
// migration; there is no second implementation here.
export { err, ok } from "@dpf/validators/action-result";
export type { ActionFailure, ActionResult, ActionSuccess } from "@dpf/validators/action-result";
