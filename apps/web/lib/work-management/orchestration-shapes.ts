// Value-stream orchestration shapes.
//
// Split from coworker-standing-shapes.ts, which is near the 800-line ceiling.
// Registered in SHAPE_SOURCE_FILES — the measure reads a fixed list and a guard
// fails when a work-management file names an accountable agent and is absent
// from it, which is how the second shape module went unread for a period.
//
// One shape per IT4IT value stream. They are near-identical by design: an
// orchestrator SURVEYS its stream, DELEGATES what belongs to a specialist, and
// hands the stream owner a decision. What differs per stream is what is
// surveyed and what the decision is about, which is exactly what the registry
// models with value_stream. Collapsing them into one shape would lose the
// per-stream accountability the lattice exists to express.
//
// An orchestrator never decides its own stream's direction. Every shape ends in
// a governed decision taken by a human role — coordination is delegated work,
// not delegated authority.

import type { WorkShapeDefinition } from "./work-shapes";

export const ORCHESTRATION_SHAPES: Record<string, WorkShapeDefinition> = {
  "evaluate-stream-orchestration": {
    key: "evaluate-stream-orchestration",
    version: "1.0.0",
    title: "Evaluate stream orchestration",
    description:
      "The evaluate orchestrator keeps sight of what is worth doing next: it surveys scored and ranked candidates, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the evaluate stream",
        accountablePrincipalRef: "agent:evaluate-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:evaluate-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:evaluate-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "evaluation-priority",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "explore-stream-orchestration": {
    key: "explore-stream-orchestration",
    version: "1.0.0",
    title: "Explore stream orchestration",
    description:
      "The explore orchestrator keeps sight of what options exist: it surveys researched options with their evidence, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the explore stream",
        accountablePrincipalRef: "agent:explore-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:explore-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:explore-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "exploration-direction",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "integrate-stream-orchestration": {
    key: "integrate-stream-orchestration",
    version: "1.0.0",
    title: "Integrate stream orchestration",
    description:
      "The integrate orchestrator keeps sight of what is being built: it surveys in-flight build work and its blockers, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the integrate stream",
        accountablePrincipalRef: "agent:integrate-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:integrate-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:integrate-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "integration-sequencing",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "deploy-stream-orchestration": {
    key: "deploy-stream-orchestration",
    version: "1.0.0",
    title: "Deploy stream orchestration",
    description:
      "The deploy orchestrator keeps sight of what is ready to promote: it surveys promotion candidates and their gate state, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the deploy stream",
        accountablePrincipalRef: "agent:deploy-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:deploy-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:deploy-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "promotion-readiness",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "release-stream-orchestration": {
    key: "release-stream-orchestration",
    version: "1.0.0",
    title: "Release stream orchestration",
    description:
      "The release orchestrator keeps sight of what is going out: it surveys release bundles and their validation state, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the release stream",
        accountablePrincipalRef: "agent:release-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:release-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:release-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "release-authorization",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "consume-stream-orchestration": {
    key: "consume-stream-orchestration",
    version: "1.0.0",
    title: "Consume stream orchestration",
    description:
      "The consume orchestrator keeps sight of what customers are receiving: it surveys customer-facing delivery and open demand, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the consume stream",
        accountablePrincipalRef: "agent:consume-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:consume-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:consume-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "demand-prioritization",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "operate-stream-orchestration": {
    key: "operate-stream-orchestration",
    version: "1.0.0",
    title: "Operate stream orchestration",
    description:
      "The operate orchestrator keeps sight of what is running and what is wrong: it surveys run-state, incidents, and service health, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the operate stream",
        accountablePrincipalRef: "agent:operate-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:operate-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:operate-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "operational-response",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "governance-stream-orchestration": {
    key: "governance-stream-orchestration",
    version: "1.0.0",
    title: "Governance stream orchestration",
    description:
      "The governance orchestrator keeps sight of what the platform owes and to whom: it surveys policy posture, compliance state, and open decisions, "
      + "delegates what belongs to a specialist, and puts the stream's direction to its owner. "
      + "It coordinates; it does not decide.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "survey",
        title: "Survey the governance stream",
        accountablePrincipalRef: "agent:governance-orchestrator",
        advance: {
          kind: "status-change",
          condition: "Every open item in the stream is read, and anything unreadable is named rather than omitted.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "delegate",
        title: "Delegate what belongs to a specialist",
        accountablePrincipalRef: "agent:governance-orchestrator",
        advance: {
          kind: "status-change",
          condition:
            "Work that belongs to a named specialist is routed to them with the context already gathered; "
            + "work with no owner is surfaced as unowned rather than silently retained.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "direct",
        title: "Set the stream's direction",
        accountablePrincipalRef: "role:governance-stream-owner",
        advance: {
          kind: "governed-decision",
          condition: "The stream owner accepts, reorders, or rejects the orchestrator's proposed direction.",
          decisionScope: "governance-position",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every open item in the stream is delegated, surfaced as unowned, or covered by an owner decision." },
      { kind: "failure", condition: "The stream's work cannot be read — the cycle reports and stops, rather than presenting an empty survey as a quiet stream." },
      { kind: "budget", condition: "More than 100 items in one cycle — the orchestrator escalates the volume rather than routing a queue nobody can absorb." },
    ],
    grants: ["tool:read", "tool:work_route_propose"],
    measures: [
      { key: "items-delegated", description: "Items routed to a named specialist in one cycle." },
      { key: "items-unowned", description: "Items with no owner — the number that should reach the stream owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "items" }],
    reviewPoint: { everyDays: 30, description: "Monthly. An orchestrator delegating nothing for a month is as likely to be blind as idle." },
    collaborationShape: "specialist-alignment",
  },


  "cross-cutting-finance-position": {
    key: "cross-cutting-finance-position",
    version: "1.0.0",
    title: "Cross-cutting finance position",
    description:
      "Standing read of the recorded money position across streams, reported to the owner with "
      + "what is unknown stated as unknown. It records nothing on its own.",
    triggers: ["cadence", "deadline-horizon"],
    stages: [
      {
        key: "read",
        title: "Read the recorded position",
        accountablePrincipalRef: "agent:finance-agent",
        advance: {
          kind: "status-change",
          condition:
            "Recorded invoices, bills, expenses and balances are read, and every figure that is NOT "
            + "measurable from them is named as unknown with what would have to be recorded.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "act",
        title: "Decide what to record or change",
        accountablePrincipalRef: "role:finance-owner",
        advance: {
          kind: "governed-decision",
          condition: "The owner decides what to record, correct, or accept as unknown for now.",
          decisionScope: "finance-position-response",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The position is reported with knowns and unknowns distinguished." },
      { kind: "failure", condition: "Finance records cannot be read — it reports that, and never presents an absent number as zero." },
      { kind: "budget", condition: "More than 50 findings in one run." },
    ],
    grants: ["tool:read"],
    measures: [{ key: "unknowns-named", description: "Figures reported as unknown with the record that would resolve them." }],
    budgets: [{ kind: "findings-per-run", limit: 50, unit: "findings" }],
    reviewPoint: { everyDays: 30, description: "Monthly." },
    collaborationShape: "approval-sign-off",
  },

  // ── COO (AGT-ORCH-000) — the cross-cutting orchestrator ───────────────────
  //
  // The eight shapes above are one per IT4IT value stream. This is the one that
  // sits ACROSS them. Grants: portfolio_read, registry_read, backlog_read,
  // backlog_write, agent_control_read, email_config, thread_write.
  //
  // Note what is absent: agent_control_read is READ. The COO can see what the
  // workforce is doing and can open work (backlog_write, thread_write); it
  // cannot start, stop or re-staff a coworker. So the shape is see the whole →
  // name what is not moving → the owner decides what changes. An orchestrator
  // that could also reassign would be deciding the organisation's priorities
  // rather than surfacing them.
  "cross-cutting-portfolio-standup": {
    key: "cross-cutting-portfolio-standup",
    version: "1.0.0",
    title: "Cross-cutting portfolio standup",
    description:
      "A standing read across every value stream: what is moving, what is stalled, and what is "
      + "unowned — reported to the owner with unknowns stated as unknown. It opens work; it does "
      + "not reprioritise the business or restaff anyone.",
    triggers: ["cadence"],
    stages: [
      {
        key: "read-across",
        title: "Read across the streams",
        accountablePrincipalRef: "agent:coo",
        advance: {
          kind: "status-change",
          condition:
            "Portfolio and backlog state is read across streams, and anything not measurable from "
            + "the record is named as unknown rather than estimated.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "name-the-stalls",
        title: "Name what is not moving, and what is unowned",
        accountablePrincipalRef: "agent:coo",
        advance: {
          kind: "status-change",
          condition:
            "Each stall is named with how long it has been stalled and who, if anyone, is "
            + "accountable. 'Unowned' is a finding, not a blank.",
        },
        evidence: ["backlog-items"],
      },
      {
        key: "owner-directs",
        title: "Decide what changes",
        // agent_control_read is read-only by design: seeing the workforce is
        // not authority over it. Reprioritising and restaffing are the owner's.
        accountablePrincipalRef: "role:owner",
        advance: {
          kind: "governed-decision",
          condition:
            "The owner decides what is reprioritised, restaffed, or accepted as stalled for now. "
            + "The COO records the decision; it does not make it.",
          decisionScope: "portfolio-direction",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every stall and unowned item has an owner decision, including a decision to accept it." },
      {
        kind: "failure",
        condition:
          "Portfolio or backlog state cannot be read. The standup reports that and never presents "
          + "an unread stream as a healthy one.",
      },
      {
        kind: "budget",
        condition:
          "More than 60 stalls in one run — stop and escalate. A standup that hands the owner "
          + "everything has told them nothing.",
      },
    ],
    grants: ["tool:portfolio_read", "tool:registry_read", "tool:backlog_read", "tool:backlog_write", "tool:agent_control_read"],
    measures: [
      { key: "stalls-resolved", description: "Stalls that moved after being named." },
      { key: "unowned-closed", description: "Items that gained an accountable owner." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 60, unit: "stalls" }],
    reviewPoint: {
      everyDays: 30,
      description:
        "Monthly. A standup that never names a stall is not evidence of health — it is the first "
        + "thing to check when the portfolio looks quiet.",
    },
    collaborationShape: "specialist-alignment",
  },
};
