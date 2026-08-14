# Integrated Email & Communications

**Date:** 2026-08-14 · **Origin:** operator dogfood (customer 0) · **Owner ask:** operator/owner
**Status:** Initial spec for evaluation · **Epic:** EP-EMAIL-COMMS (see backlog)

## Why this exists

DPF's purpose is to replace the tools it takes to run a small company. Email is the most universal SMB tool and the one businesses most resent renting from Google/Microsoft — who read it, lock them in, and raise prices. Bringing email "home" (owned, on the customer's own infra) is a stronger expression of DPF's self-host / edge / data-sovereignty thesis, not a detour from it.

But email carries a hard truth that must shape the design: **companies didn't move to hosted Exchange/M365 for the software — they moved to offload the *burden and risk*** (server ops, uptime, patching, spam, security, backups, migration). So the design question is not "can DPF run a mail server" (commodity — yes: Stalwart, Mailcow, Mailu, Postal, Maddy are turnkey). It is:

> **Can DPF offload that burden as convincingly as Microsoft did, while keeping the mail on the customer's own turf?**

The answer, and the load-bearing bet of this spec, is: **the AI coworker is the mail admin.** DPF's email = *the burden-removal of hosted Exchange, minus the surrender of ownership*, because a coworker absorbs the administration that drove everyone to hosting in the first place.

## The burden, split honestly

The coworker can fully absorb one class of burden and only *help* with the other. The spec must be honest about which is which.

**A. Admin toil — the AI genuinely offloads this (the win):**
DNS + DKIM/SPF/DMARC setup and monitoring, spam/policy tuning, patching/upgrades, migration from M365/Google, retention/legal-hold configuration, blocklist monitoring and remediation. This is exactly what an operator-grade coworker is good at, and it recreates most of *why people went hosted*.

**B. Physics/infrastructure — the AI helps but cannot wave away:**
1. **Availability.** "Offload the risk" also meant Microsoft's redundancy + 99.9% SLA. A self-hosted box — even perfectly administered — is down when the box is down. Owned mail needs a real **redundancy / failover / backup** story or it offers *less* reliability than what the customer left. This is the honest counterweight to "email is a commodity."
2. **Outbound deliverability** to Gmail/Yahoo/Outlook. Reputation is earned by warm sending infrastructure, not configuration. A cold self-hosted IP silently spam-folders mail for weeks; VPS ranges are frequently pre-blocklisted. Configuration alone can't fix this.

## The segment decides the shape

Because burden B cannot be fully removed, the *right architecture depends on how email-dependent the customer is*:

- **Sovereignty-first SMBs** (value owning their data over five-nines): **AI-managed self-hosted mailbox stack + outbound relayed through a reputable sender.** DPF's core play.
- **"Email is our oxygen" businesses:** DPF **orchestrates** managed/redundant hosting (its own coworker provisions and configures it, potentially via a cloud/host partner) rather than running it on one box — the *conduit-not-broker* pattern already in DPF's operating model. DPF is honest that this tier is chosen for availability.

## Staged architecture (build the wedge once, ship value at tier 1)

### Tier 1 — Email *client* integration + relayed transactional send  *(now; lowest risk, highest immediate value)*
Connect the customer's **existing** mailbox (IMAP/SMTP/OAuth) into the workspace and Work Rooms: AI triage, drafting, reply, and outbound transactional mail (invoices, quotes, payment links, dunning, approvals, notifications) via a relay/provider.
- **Substrate already present:** `CommunicationChannelBinding` (channel/provider/account → verified `Principal`) and `CommunicationChannelSession` already route inbound email → `WorkItem` (see `docs/architecture/work-room-participation-and-channel-continuity.md`). The 3-tier `smtp-config.ts` (DB settings → env → relay) already exists for outbound.
- This gives DPF the entire email **UX + coworker surface** without owning a server. It is also exactly the path this operator install needs right now (SMTP2GO relay), so tier 1 is not throwaway.

### Tier 2 — AI-managed self-hosted mailbox hosting (hybrid deliverability)  *(next; the differentiator)*
Package a modern open-source mail server (Stalwart / Mailcow) as a **deployable DPF component** for storage + sovereignty (inbound, mailboxes, IMAP/JMAP, calendars/contacts), but **relay outbound through a reputable sender** so deliverability is *borrowed, not owned* (the hybrid pattern). The **AI mail-admin coworker** runs setup, DNS/DKIM, migration, spam, retention, and monitoring.
- **Gates (must pass before GA):** an availability story (redundancy/backup/failover) and the outbound-relay path. Do NOT ship owned-outbound-IP as the default.

### Tier 3 — Orchestrated managed email (conduit)  *(later; for the availability-critical segment)*
For businesses that cannot tolerate downtime, DPF's coworker provisions and configures **managed** email (via a cloud/host partner), orchestrating it rather than running it — DPF stays the conduit, the customer keeps the relationship.

## The load-bearing piece: the AI mail-admin coworker

A dedicated coworker (established via the coworker paved road) whose craft (WSID) is email administration: it configures and continuously monitors DNS/DKIM/SPF/DMARC + custom return-path, drives migration from M365/Google, tunes spam/policy, watches blocklists and remediates, manages retention/legal-hold, and reports availability/deliverability posture. It is valuable at **every** tier — it is what turns "self-hosted email" from a burden back into an offload — so it is built once at tier 1 and pays off immediately.

Consequential actions it takes (provisioning, DNS changes, retention policy, sending) route through the **WWWD-grounded governance gate** (EP-1C37C089) and the Work Room shape for the activity; humans stay in control of the consequential steps.

## Deliverability & availability foundations (any tier)
- **Send from a subdomain** (e.g. `mail.` / `billing.<domain>`), never the root, to protect the customer's human/corporate domain reputation; keep transactional separate from any marketing stream.
- **SPF + DKIM + DMARC** (`p=none` + `rua=` → tighten to quarantine/reject once aligned) — mandatory since the Google/Yahoo 2024 bulk-sender rules — plus a **custom return-path / MAIL FROM** for alignment.
- **Shared, provider-warmed IP** at SMB volume (a warm managed pool beats a cold dedicated IP); dedicated only at sustained tens-of-thousands/mo.
- **Availability:** backup + restore, and a failover story for tier-2 owned hosting.

## Existing substrate to extend (not rebuild)
- **Inbound channel:** `CommunicationChannelBinding` / `CommunicationChannelSession` → `WorkItem` (Work Room participation & channel continuity).
- **Outbound config:** `apps/web/lib/shared/smtp-config.ts` (DB → env → relay tiers), `smtp-presets.ts` (provider auto-detect), Admin → Settings → Email surface.
- **Work Rooms** (EP-WORKROOM-COMMS / EP-2984B02B) for the collaboration shape of each email activity.
- **Governance gate** (EP-1C37C089) for consequential email actions.
- **Coworker paved road** (establish_coworker) for the mail-admin coworker.

## Acceptance (tier 1, the shippable slice)
1. An operator connects an existing mailbox; inbound lands as Work Items; the coworker can triage/draft/reply from the Work Room.
2. Transactional mail sends via a verified-domain relay (SMTP2GO/Resend/SES) with SPF/DKIM/DMARC aligned; a failed test surfaces the real SMTP error inline (see BI-6AA848A7), not a crash.
3. The mail-admin coworker sets up DKIM/SPF/DMARC + return-path for a domain and reports posture.

## Non-goals
- Not building a new mail server (use commodity OSS).
- Not owning outbound IP reputation by default (relay/hybrid until warranted).
- Not promising five-nines on a single self-hosted box — availability tier is an explicit customer choice.
