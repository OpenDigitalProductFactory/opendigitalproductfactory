---
title: Incident management vs problem management (ITIL)
pageKind: entity
status: published
abstract: Incident management restores normal service as quickly as possible; problem management investigates and eliminates the underlying causes of recurring incidents. They are distinct, complementary practices.
professionCompetencyLevel: practitioner
sources:
  - itsm-tools/incident-vs-problem
---

## Definition

ITIL distinguishes two complementary service-management practices:

- **Incident management** restores normal service "as quickly as possible, with as little adverse impact as possible." It is first-response: get the user working again.
- **Problem management** eliminates recurring incidents and minimizes the impact of those it cannot prevent. It is investigative: find and remove the cause.

A **problem** is the cause (or potential cause) of one or more incidents. Incident management asks "how do we restore service now?"; problem management asks "why did this happen, and how do we stop it recurring?"

> Licensing note: ITIL 4 is a proprietary, licensed framework (PeopleCert/Axelos). This page uses an open explainer for the doctrine and does not reproduce ITIL specification text.

## Why The Distinction Matters

Treating every incident as a one-off (restore and move on) lets the same failure recur indefinitely. Treating every incident as a deep investigation paralyzes response. The two practices run in parallel: restore fast (incident), then investigate the cause (problem).

## How DPF Coworkers Use It

- Run incident management through the [[professions/operations/incident-response-lifecycle]].
- Feed recurring incidents into problem management; the [[professions/operations/blameless-postmortem]] is where cause analysis begins.

## See Also

- [[professions/operations/incident-response-lifecycle]]
- [[professions/operations/blameless-postmortem]]
