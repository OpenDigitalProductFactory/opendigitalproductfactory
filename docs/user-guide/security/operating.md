---
title: "Operating the SOC"
area: security
order: 3
---

This is the day-to-day guide: how to read the board, work a case, tune what fires, approve responses, and prove compliance. Most of the work is done by AI coworkers — your job is to set direction and approve the few decisions that matter.

## Reading the console

**Operations → Security → SOC Console** is the first screen every shift. It is built around four questions:

- **Are we covered?** — Connected sources. If a source you expect is missing or has gone stale, a collector is probably down.
- **Are we exposed?** — Open detections, broken down by severity.
- **What needs you?** — Cases awaiting a decision. This is your work queue.
- **Are we improving?** — Mean time to resolve and false-positive rate over time.

Below the tiles is the recent-cases list. Click a case to open its full timeline.

## Working a case

A case is a group of related detections about the same asset or the same kind of attack. It moves through a simple lifecycle:

| Status | Meaning |
|---|---|
| **New** | Just opened. Awaiting first triage. |
| **Triaging** | A coworker is doing first-pass assessment. |
| **Investigating** | Under active investigation — evidence being gathered. |
| **Contained** | A response has been applied; threat is held. |
| **Resolved / Closed** | Work finished. Resolved cases feed the MTTR metric. |

Each case also carries a **verdict** — the analytical conclusion (real threat, false positive, benign, or still unknown). The verdict is evidence, not a vote: it reflects what the investigation found, and it is what tunes your false-positive rate.

Cases form **two** ways, and both feed the same queue:

- **Automatically** — the correlation sweep groups new, un-triaged detections into a case so your coworkers always have something to work, even overnight.
- **By a coworker or you** — when someone decides a set of detections belongs together.

## Working with the AI SOC coworkers

The SOC ships with a roster of AI coworkers, each with a focused job and its own human-in-the-loop limits:

- **Triage analyst** — first-pass assessment: is this real, and how urgent?
- **Investigator** — digs into a case, pulls asset and identity context, and forms a verdict.
- **Threat-hunter** — looks for the things no rule caught yet.
- **Incident-command lead** — coordinates response on the serious cases and owns the human hand-off.

They escalate to each other along a defined path (triage → investigator → incident lead), and the most consequential steps require a human sign-off. You can read everything they did on the case timeline — nothing happens off the record.

## Tuning what fires

Good security operations is as much about silencing noise as catching threats.

- **Kernel rules** apply to every customer and are maintained centrally. You do not edit them directly; instead you tune their behavior per customer with an **overlay**.
- **Overlays** let you disable a rule, change its severity, or add a customer-specific rule — without touching the shared pack and without code.

A coworker can also **propose a tuning change** when it sees a rule producing false positives. The proposal is recorded for you to accept or decline — the system never quietly silences a rule on its own.

## Approving a response

This is the one place the platform always asks for a human. When containment is warranted, a coworker proposes an action (isolate a host, disable a key, block an address). Before anything happens, the **decision kernel** scores the proposal and shows you its reasoning:

- **Reversible, low-impact actions** in a confident posture can be approved quickly.
- **Irreversible or estate-wide actions** are held for explicit human approval, every time.
- The kernel can only make a response **more** cautious than your posture allows — never less.
- If the kernel cannot reach a confident decision, it **fails safe**: the action waits for a person.

You will see the proposed action, its risk class (is it reversible? how wide is the blast radius?), and the kernel's recommendation. You approve or decline. Approved actions are carried out by the customer's own runner — the platform proposes, your infrastructure executes. The platform never reaches into an estate unilaterally.

## Proving compliance

Every case that touches a regulated control becomes **compliance evidence** automatically — you do not assemble an audit trail by hand. From the compliance tools you can produce framework reports for:

- NIST Cybersecurity Framework (CSF 2.0)
- PCI DSS
- HIPAA
- SOC 2
- CMMC
- DORA

Each report maps your detection-and-response activity to the framework's Detect and Respond functions, backed by real cases. Security telemetry is retained under the platform's data-retention policy; cases that become legal or regulated records are kept rather than purged.

## Running many customers (MSP / managed service)

If you operate the SOC on behalf of several customers, federation lets you see across all of them **without ever pulling their raw logs**. Only a minimized summary of a detection or case crosses the link between you and a customer — the timeline, the evidence, and the raw telemetry stay on the customer's own infrastructure. You can prove coverage and coordinate response across the fleet while each customer keeps full sovereignty over their data.

## A healthy SOC, day to day

- Sources stay connected (no stale collectors).
- Detections fire on real activity and stay quiet on benign activity.
- Cases get triaged promptly — mostly by coworkers, with you approving the responses.
- MTTR trends down and the false-positive rate stays low.
- Compliance reports are a click, not a project.
