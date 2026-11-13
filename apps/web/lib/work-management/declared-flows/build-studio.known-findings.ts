import type { KnownFinding } from "@/lib/gpp/shape-language/known-findings";
import { BUILD_STUDIO_SANDBOX_STAGES } from "./build-studio.realization";

/** Actual first compile at ea62f5fb. DI-EFCFA7596534: eligible exact findings
 * only; keep severity, never silently widen this reviewed list. */
export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    "rule": "D-3",
    "elementId": "gate:plan",
    "tools": [
      "recover_sandbox"
    ],
    "reason": "The existing plan gate has no exact-action checkpoint for recover_sandbox; preserve current behavior (Phase5 design §5.3/§7.3).",
    "backlogItemId": "BI-F7BADDA2"
  },
  {
    "rule": "D-1",
    "elementId": "stage:build",
    "tools": [
      "record_semantic_review_exemption",
      "recover_sandbox",
      "release_nonprod_environment_lease"
    ],
    "reason": "The existing trigger/status transition has no typed owning gate covering these OAI capabilities; path-local runtime checks are not claimed as an equivalent declared gate (Phase5 design §7.3).",
    "backlogItemId": "BI-6854C1F4"
  },
  {
    "rule": "C-1",
    "elementId": "stage:ideate",
    "tools": [
      "release_nonprod_environment_lease"
    ],
    "reason": "The existing trigger/status transition has no typed owning gate covering these OAI capabilities; path-local runtime checks are not claimed as an equivalent declared gate (Phase5 design §7.3).",
    "backlogItemId": "BI-6854C1F4"
  },
  {
    "rule": "C-7",
    "code": "C-7/SANDBOX-CONTAINMENT",
    "elementId": "stage:ideate",
    "reason": "This stage acts in the sandbox but the existing offline declaration binds only build; no new containment is claimed (Phase5 design §7.5/§9).",
    "backlogItemId": "BI-59900E8E"
  },
  {
    "rule": "D-1",
    "elementId": "stage:ideate",
    "tools": [
      "release_nonprod_environment_lease"
    ],
    "reason": "The existing trigger/status transition has no typed owning gate covering these OAI capabilities; path-local runtime checks are not claimed as an equivalent declared gate (Phase5 design §7.3).",
    "backlogItemId": "BI-6854C1F4"
  },
  {
    "rule": "C-7",
    "code": "C-7/SANDBOX-CONTAINMENT",
    "elementId": "stage:review",
    "reason": "This stage acts in the sandbox but the existing offline declaration binds only build; no new containment is claimed (Phase5 design §7.5/§9).",
    "backlogItemId": "BI-59900E8E"
  },
  {
    "rule": "D-1",
    "elementId": "stage:review",
    "tools": [
      "contribute_to_hive",
      "create_portal_pr",
      "deploy_feature",
      "execute_promotion",
      "record_semantic_review_exemption",
      "recover_sandbox",
      "release_nonprod_environment_lease",
      "schedule_promotion"
    ],
    "reason": "The existing trigger/status transition has no typed owning gate covering these OAI capabilities; path-local runtime checks are not claimed as an equivalent declared gate (Phase5 design §7.3).",
    "backlogItemId": "BI-6854C1F4"
  }
];
export const SANDBOX_STAGES = BUILD_STUDIO_SANDBOX_STAGES;
