---
title: "Setting up the SOC"
area: security
order: 2
---

## What works out of the box

You do not start from zero. The moment the platform is running, the SOC is already watching **itself**: every authorization decision and every tool call the platform makes is normalized into a security event and scanned for trouble. This is the built-in `dpf.internal` source, and it needs no setup.

On the first scan after install, the SOC also seeds its **kernel detection pack** — a starter set of rules covering the most common attack techniques (cleared audit logs, disabled cloud logging, MFA removal, new privileged accounts, and so on), each mapped to [MITRE ATT&CK](https://attack.mitre.org/). These apply to every customer automatically.

So a brand-new install already has:

- A live source (the platform's own audit trail).
- A working detection pack.
- A correlation sweep running every few minutes.
- The SOC Console at **Operations → Security → SOC Console**.

Open the console and you will see one connected source and a quiet board. That is the baseline. The rest of setup is about widening what you can see.

## Step 1 — Open the console and read the baseline

Go to **Operations → Security → SOC Console** (`/ops/security`).

The top row answers four questions:

- **Connected sources** — _are we covered?_ A fresh install shows `1` (the platform itself).
- **Open detections** — _are we exposed?_
- **Awaiting decision** — _what needs you?_
- **MTTR / false-positive rate** — _are we improving?_

An empty board is **not** treated as "all green" — if no source is reporting, the console says so, because silence usually means a broken collector, not safety.

## Step 2 — Connect your own sources

External activity reaches the SOC through **edge collectors** — small agents that run close to your systems, read native logs, and send a normalized summary to the platform. The raw log stays where it was produced; only the summary travels.

The platform ships reference collectors for:

| Source (`sourceKind`) | What it watches |
|---|---|
| `windows.security` | Windows Security event log — logons, account and group changes, audit-log tampering, service and scheduled-task creation. |
| `aws.cloudtrail` | AWS control-plane activity — logging tampering, IAM and MFA changes, access-key creation. |
| `cef` | Any product that emits ArcSight CEF over syslog — firewalls, IDS/IPS, and other security appliances. |

Broader collector coverage (endpoint/EDR, identity providers, more cloud platforms) expands over time; new sources plug into the same pipeline without changing anything downstream.

To connect a source:

1. **Enroll an edge node.** Under **Platform → Edge Nodes**, create a node for the site or customer you are collecting from. The platform issues a one-time enrollment token. This is the trust boundary — the node's identity, not the contents of any message, decides which customer the data belongs to.
2. **Run the collector on that node.** Point the reference collector at the log source and at your platform's events endpoint. It authenticates with the node's token and posts security events.
3. **Confirm it is reporting.** Back on the SOC Console, the **Connected sources** count goes up and the new `sourceKind` appears. If a source was reporting and then goes quiet, the console flags it as stale rather than hiding it.

> **Tenancy is set at the boundary, not in the message.** Because scope comes from the enrolled node, a collector cannot claim to be a different customer. This is what makes the multi-customer (MSP) model safe.

## Step 3 — Add threat intelligence (optional)

The SOC can match activity against known-bad indicators (IPs, domains, file hashes). Load your threat-intelligence indicators and the correlation sweep will raise a high-severity detection whenever an event's observable matches an active indicator. Indicators carry a validity window, so expired intel stops matching on its own.

## Step 4 — Decide your autonomy posture

The SOC's willingness to act on its own is **derived from your organization's risk posture**, set during onboarding — you do not configure a separate security autonomy dial. A cautious posture means more actions wait for human approval; a confident posture lets reversible, low-impact responses move faster. Either way, irreversible or estate-wide actions always need a person.

You can review and adjust the underlying posture in your organization's onboarding/risk settings; the SOC follows it automatically.

## What you should see when setup is done

- More than one connected source on the console.
- Detections appearing when something noteworthy happens (and **not** appearing when activity is benign — the detector is built to avoid crying wolf).
- Cases forming from related detections, ready for a coworker to triage.

From here, move on to **[Operating the SOC](operating)**.
