// Superseded work-shape versions that live rooms may still pin (BI-CB5C0DCE).
//
// A room pins its activity shape as `key@version`. Bumping a shape used to stop
// every room on the old version, because the registry held one version per key.
// GPP §2.1.1 says a widening takes a new version and a fresh gate decision, so
// a pinned room must keep running on its version until its owner rebinds it.
//
// A bump therefore moves the old definition here, frozen, in the same change.
// It stays while any non-terminal room pins it. Rooms resolve against it; new
// rooms and claim adoption never may (normalizePersistedScope requires the
// current version). Spec: docs/superpowers/specs/2026-10-01-workroom-shape-rebind-design.md

import type { WorkShapeDefinition } from "./work-shapes";

// 1.0.0 of the four standing shapes that BI-EBF0F6EE widened to 1.1.0 (new
// read tools and grants), frozen exactly as they shipped. Rooms pinned here
// keep running until their owner rebinds them.
export const WORK_SHAPE_PRIOR_VERSIONS: readonly WorkShapeDefinition[] = [
  {
    "key": "pull-request-flow-watch",
    "version": "1.0.0",
    "title": "Pull-request flow watch",
    "description": "The change reviewer reads mechanical pull-request health, classifies each open change as stalled, conflicted, or awaiting review, and summarizes what needs a person. The merge decision stays human.",
    "triggers": [
      "cadence",
      "escalation"
    ],
    "stages": [
      {
        "key": "read",
        "title": "Read mechanical pull-request health",
        "accountablePrincipalRef": "agent:change-reviewer",
        "advance": {
          "kind": "status-change",
          "condition": "Every open pull request in scope has a mechanically-read health state — never a visual scan of some checks."
        },
        "evidence": [
          "assurance-run"
        ]
      },
      {
        "key": "classify",
        "title": "Classify and summarize what needs a person",
        "accountablePrincipalRef": "agent:change-reviewer",
        "advance": {
          "kind": "status-change",
          "condition": "Each open change is classified stalled, conflicted, awaiting-review, or ready, with the blocking reason named."
        },
        "evidence": [
          "assurance-finding"
        ]
      },
      {
        "key": "merge",
        "title": "Decide the merge",
        "accountablePrincipalRef": "role:change-approver",
        "advance": {
          "kind": "governed-decision",
          "condition": "The accountable approver merges, requests changes, or closes.",
          "decisionScope": "change-merge-decision"
        },
        "evidence": [
          "decision-record"
        ]
      }
    ],
    "stopConditions": [
      {
        "kind": "success",
        "condition": "Every open pull request carries a current classification and a named blocking reason.",
        "disposition": "proceed"
      },
      {
        "kind": "failure",
        "condition": "The forge is unreachable or returns no pull requests where the repository is known to have them — the run stops and reports rather than declaring the queue clear.",
        "disposition": "inconclusive"
      },
      {
        "kind": "budget",
        "condition": "More than 100 pull requests in one run — the run stops and escalates.",
        "disposition": "awaiting-person"
      }
    ],
    "grants": [
      "tool:read",
      "tool:workroom_evidence_write"
    ],
    "measures": [
      {
        "key": "changes-classified",
        "description": "Open pull requests classified in one run."
      },
      {
        "key": "stalled-changes",
        "description": "Changes found stalled past their threshold."
      }
    ],
    "budgets": [
      {
        "kind": "findings-per-run",
        "limit": 100,
        "unit": "pull requests"
      }
    ],
    "reviewPoint": {
      "everyDays": 30,
      "description": "Reviewed monthly whether or not it moved: an activity that has reported nothing for a month is as likely to be broken as to be reassuring."
    },
    "collaborationShape": "change-consequential"
  },
  {
    "key": "contributor-intake-watch",
    "version": "1.0.0",
    "title": "Contributor intake watch",
    "description": "The platform engineer keeps the contributor inventory current and flags missing sign-off or licence facts. Admitting a contributor is a human stage — it grants standing in the project.",
    "triggers": [
      "cadence"
    ],
    "stages": [
      {
        "key": "sync",
        "title": "Sync the contributor inventory",
        "accountablePrincipalRef": "agent:platform-engineer",
        "advance": {
          "kind": "status-change",
          "condition": "The recorded contributor inventory matches the observed contribution history."
        },
        "evidence": [
          "assurance-run"
        ]
      },
      {
        "key": "flag",
        "title": "Flag missing sign-off or licence facts",
        "accountablePrincipalRef": "agent:platform-engineer",
        "advance": {
          "kind": "status-change",
          "condition": "Every contributor missing a required sign-off or licence fact is flagged with what is missing."
        },
        "evidence": [
          "assurance-finding"
        ]
      },
      {
        "key": "admit",
        "title": "Admit the contributor",
        "accountablePrincipalRef": "role:contributor-owner",
        "advance": {
          "kind": "governed-decision",
          "condition": "The accountable owner admits the contributor or records what is still required.",
          "decisionScope": "contributor-admission"
        },
        "evidence": [
          "decision-record"
        ]
      }
    ],
    "stopConditions": [
      {
        "kind": "success",
        "condition": "Every observed contributor is recorded with their sign-off and licence status.",
        "disposition": "proceed"
      },
      {
        "kind": "failure",
        "condition": "The contribution history cannot be read — the run stops and reports, and never records a contributor it could not observe.",
        "disposition": "inconclusive"
      },
      {
        "kind": "budget",
        "condition": "More than 200 contributors reconciled in one run — the run stops and escalates.",
        "disposition": "awaiting-person"
      }
    ],
    "grants": [
      "tool:read",
      "tool:workroom_evidence_write"
    ],
    "measures": [
      {
        "key": "contributors-reconciled",
        "description": "Contributors reconciled against observed history."
      },
      {
        "key": "missing-signoff",
        "description": "Contributors flagged for a missing sign-off or licence fact."
      }
    ],
    "budgets": [
      {
        "kind": "findings-per-run",
        "limit": 200,
        "unit": "contributors"
      }
    ],
    "reviewPoint": {
      "everyDays": 30,
      "description": "Reviewed monthly whether or not it moved: an activity that has reported nothing for a month is as likely to be broken as to be reassuring."
    },
    "collaborationShape": "approval-sign-off"
  },
  {
    "key": "vendor-renewal-watch",
    "version": "1.0.0",
    "title": "Vendor and subscription renewal watch",
    "description": "The finance controller reports upcoming renewals and spend against recorded commitments. Renewing or cancelling is a human stage — both are outward commitments.",
    "triggers": [
      "deadline-horizon",
      "cadence"
    ],
    "stages": [
      {
        "key": "read",
        "title": "Read supplier agreements and spend",
        "accountablePrincipalRef": "agent:finance-controller",
        "advance": {
          "kind": "status-change",
          "condition": "Every recorded supplier agreement and its spend to date has been read."
        },
        "evidence": [
          "assurance-run"
        ]
      },
      {
        "key": "report",
        "title": "Report renewals and spend against commitment",
        "accountablePrincipalRef": "agent:finance-controller",
        "advance": {
          "kind": "status-change",
          "condition": "Each renewal inside the horizon is reported with spend against its commitment, and unknowns are named."
        },
        "evidence": [
          "assurance-finding"
        ]
      },
      {
        "key": "decide",
        "title": "Renew or cancel",
        "accountablePrincipalRef": "role:finance-owner",
        "advance": {
          "kind": "governed-decision",
          "condition": "The accountable owner renews, renegotiates, or cancels.",
          "decisionScope": "vendor-renewal-decision"
        },
        "evidence": [
          "decision-record"
        ]
      }
    ],
    "stopConditions": [
      {
        "kind": "success",
        "condition": "Every renewal inside the horizon is reported with its spend position.",
        "disposition": "proceed"
      },
      {
        "kind": "failure",
        "condition": "Supplier records cannot be read — the run stops and reports, and never infers a renewal from an unread agreement.",
        "disposition": "inconclusive"
      },
      {
        "kind": "budget",
        "condition": "More than 50 agreements assessed in one run — the run stops and escalates.",
        "disposition": "awaiting-person"
      }
    ],
    "grants": [
      "tool:read",
      "tool:workroom_evidence_write"
    ],
    "measures": [
      {
        "key": "agreements-read",
        "description": "Supplier agreements read in one run."
      },
      {
        "key": "renewals-in-horizon",
        "description": "Renewals falling inside the look-ahead window."
      }
    ],
    "budgets": [
      {
        "kind": "findings-per-run",
        "limit": 50,
        "unit": "agreements"
      }
    ],
    "reviewPoint": {
      "everyDays": 30,
      "description": "Reviewed monthly whether or not it moved: an activity that has reported nothing for a month is as likely to be broken as to be reassuring."
    },
    "collaborationShape": "approval-sign-off"
  },
  {
    "key": "payables-watch",
    "version": "1.0.0",
    "title": "Payables watch",
    "description": "The finance controller reports what falls due and what is not recorded at all. Paying is a human stage by construction — money movement is never an unattended act, and an absent bill is reported as unknown rather than as nothing owed.",
    "triggers": [
      "deadline-horizon",
      "cadence"
    ],
    "stages": [
      {
        "key": "read",
        "title": "Read recorded bills and recurring commitments",
        "accountablePrincipalRef": "agent:finance-controller",
        "advance": {
          "kind": "status-change",
          "condition": "Every recorded bill and recurring commitment inside the horizon has been read."
        },
        "evidence": [
          "assurance-run"
        ]
      },
      {
        "key": "report",
        "title": "Report what falls due and what is unrecorded",
        "accountablePrincipalRef": "agent:finance-controller",
        "advance": {
          "kind": "status-change",
          "condition": "Each obligation inside the horizon is reported, and gaps are named as unknown with what to record — never as zero."
        },
        "evidence": [
          "assurance-finding"
        ]
      },
      {
        "key": "pay",
        "title": "Pay the bill",
        "accountablePrincipalRef": "role:finance-owner",
        "advance": {
          "kind": "governed-decision",
          "condition": "The accountable owner pays, schedules, disputes, or defers with a date.",
          "decisionScope": "payables-disbursement"
        },
        "evidence": [
          "decision-record"
        ]
      }
    ],
    "stopConditions": [
      {
        "kind": "success",
        "condition": "Every recorded obligation inside the horizon is reported with a due date and an owner.",
        "disposition": "proceed"
      },
      {
        "kind": "failure",
        "condition": "The finance substrate cannot be read — the run stops and reports, and NEVER presents an absent amount as zero.",
        "disposition": "inconclusive"
      },
      {
        "kind": "budget",
        "condition": "More than 100 obligations reported in one run — the run stops and escalates.",
        "disposition": "awaiting-person"
      }
    ],
    "grants": [
      "tool:read",
      "tool:workroom_evidence_write"
    ],
    "measures": [
      {
        "key": "obligations-reported",
        "description": "Bills and commitments reported inside the horizon."
      },
      {
        "key": "unrecorded-gaps",
        "description": "Named gaps where an obligation is expected but not recorded."
      }
    ],
    "budgets": [
      {
        "kind": "findings-per-run",
        "limit": 100,
        "unit": "obligations"
      }
    ],
    "reviewPoint": {
      "everyDays": 30,
      "description": "Reviewed monthly whether or not it moved: an activity that has reported nothing for a month is as likely to be broken as to be reassuring."
    },
    "collaborationShape": "approval-sign-off"
  }
];
