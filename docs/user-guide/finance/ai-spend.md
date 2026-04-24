---
title: "AI Spend"
area: finance
order: 2
lastUpdated: 2026-04-24
updatedBy: Codex
---

## Overview

The AI Spend workspace brings AI providers into Finance as real supplier commitments.

Use `/finance/spend/ai` to review:

- which AI providers are linked to finance suppliers
- which contracts are fully configured versus still missing plan details
- committed monthly spend
- open work items raised by setup gaps or daily usage evaluation

This page is designed for Finance operations, not provider authentication. Provider credentials and technical setup still live in the AI Workforce provider detail pages.

## What You Can See

- **AI Suppliers** — count of finance-linked AI providers
- **Committed Spend** — current monthly commitment across linked provider contracts
- **Needs Setup** — finance profiles still missing commercial details
- **Open Work Items** — follow-up items raised for missing data or allowance thresholds

The workspace table shows supplier, provider, latest contract posture, utilization snapshot, and open item count.

## How It Gets Populated

When someone configures an AI provider successfully in the platform AI workspace:

1. the technical provider setup completes
2. the platform seeds a Finance bridge
3. the provider is linked to a finance supplier
4. a draft contract is created
5. missing plan details become explicit finance work items

This means Finance can take ownership even when the setup user does not know every commercial detail yet.

## Related Routes

- `/platform/ai/providers/[providerId]` — technical provider setup plus Finance Bridge panel
- `/finance/spend` — spend hub with the AI Spend summary card
- `/finance/suppliers/[id]` — supplier detail with AI provider finance context when linked

## Daily Evaluation

The platform can evaluate active AI contracts daily against their included allowances.

This supports:

- underuse follow-up for “use it or lose it” plans
- critical-low warnings for remaining included allowance
- future messaging and alerting integrations

In the current slice, these outcomes are surfaced as finance work items.
