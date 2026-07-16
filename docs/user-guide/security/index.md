---
title: "Security Operations"
area: security
order: 1
---

## Overview

Security Operations is your platform's built-in SOC — a Security Operations Center that runs on your own infrastructure. It watches your estate for threats, turns raw activity into clear cases, and lets your AI coworkers do the triage work a team of human analysts would normally do. You stay in control of the decisions that matter: the AI proposes a response, and a person approves it.

Three things make it different from bolting a traditional SIEM onto the side of your business:

- **It runs where your data lives.** Raw logs never have to leave the machine that produced them. Only a small, normalized summary of a detection or case travels — even across an MSP boundary. Your sovereignty is the detection, not the log.
- **The AI coworkers _are_ the SOC team.** Triage, investigation, threat-hunting, and incident command are first-class governed agents, not a chat box bolted onto an analyst's screen.
- **Autonomy is governed, not blind.** Every action an AI coworker can take is checked by the platform's decision kernel. The kernel can only make a response _more_ cautious, never less, and it fails safe — if it is ever unsure, the action waits for a human.

You manage all of it from one screen: **Operations → Security → SOC Console** (`/ops/security`).

## The autonomous loop

The SOC works as a loop that runs on its own, every few minutes, without anyone watching:

1. **Collect.** Activity arrives from your sources — Windows security logs, AWS CloudTrail, firewall/IDS findings, and the platform's own audit trail (it watches itself from day one).
2. **Normalize.** Every event is mapped to a common schema ([OCSF](https://schema.ocsf.io/)), so detection logic does not care which vendor produced it.
3. **Detect.** A correlation sweep runs the normalized events against the detection rules and the threat-intelligence feed, and raises a **detection** when something matches.
4. **Group into a case.** Related detections (same asset, same kind of attack) are grouped into one **case**, so your coworkers triage a story, not a flood of single alerts.
5. **Triage.** An AI SOC coworker investigates the case, gathers evidence, and reaches a verdict (real threat, false positive, needs a human).
6. **Propose a response.** When containment is warranted, a coworker proposes an action. The decision kernel scores it; reversible, low-impact actions can be approved quickly, while anything irreversible or estate-wide is held for a human.
7. **Evidence it.** Cases that touch a regulated control automatically become compliance evidence, so your audit trail builds itself.

The only step that needs you is **approval of a response** — the one decision where judgment matters. Everything else runs hands-free.

## Key concepts

- **Source** — where activity comes from (a `sourceKind` like `windows.security`, `aws.cloudtrail`, `cef`, or the built-in `dpf.internal` self-monitoring). Adding a source is how you widen coverage.
- **Security event** — one normalized record of something that happened. Raw evidence stays at the edge; the event is the minimized, OCSF-shaped summary.
- **Detection rule** — the logic that decides what is worth flagging. Rules ship as a **kernel pack** that applies everywhere, and you can add or tune rules per customer without touching the shared pack.
- **Detection** — a single rule firing on a single event ("a Windows audit log was cleared on HOST-1").
- **Case** — a group of related detections, with a timeline, a severity, a verdict, and an assigned coworker. This is the unit your team actually works.
- **SOC coworkers** — the AI roster: a triage analyst, an investigator, a threat-hunter, and an incident-command lead. They have scoped tools and human-in-the-loop limits.
- **Governed response** — a proposed containment action, scored by the decision kernel and approved by a human before anything happens. Responses are always proposals; the platform never reaches into your estate on its own.
- **Federation** — for managed-service providers: a way to see detections and cases across many customers without ever pulling their raw logs.

## What you can do

- See your whole security posture at a glance: coverage, open detections, cases that need a decision, and whether you are improving.
- Connect new sources and confirm they are reporting.
- Tune which detections fire — globally or per customer — without code.
- Let AI coworkers triage and investigate cases, and review their work.
- Approve or decline proposed responses, with the kernel's reasoning in front of you.
- Produce compliance reports (NIST CSF, PCI DSS, HIPAA, SOC 2, CMMC, DORA) from real case evidence.
- For MSPs: monitor many customers from one place while their raw data stays on their own infrastructure.

## Where to go next

- **[Setting up the SOC](setup.md)** — get data flowing: what works out of the box, and how to connect your own sources.
- **[Operating the SOC](operating.md)** — the day-to-day: reading the console, working cases, tuning detections, approving responses, and running compliance reports.
