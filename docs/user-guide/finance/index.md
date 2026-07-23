---
title: "Finance"
area: finance
order: 1
---

## Overview

The Finance area handles your organization's core financial operations: billing customers, managing supplier relationships, and processing purchases. It is not a full accounting system, but covers the transactional layer that connects to your products and services.

## Key Concepts

- **Invoice** — A billable document sent to a customer for products or services delivered. Invoices track their own status through draft, sent, and paid states.
- **Supplier** — An external party your organization purchases goods or services from. Supplier records hold contact details, payment terms, and transaction history.
- **Bill** — An incoming payable from a supplier. Bills are matched against purchase orders where applicable.
- **Purchase Order (PO)** — A formal request to a supplier to deliver goods or services at an agreed price. POs can be raised before the work starts and matched to the resulting bill.

## What You Can Do

- Create, send, and mark invoices as paid
- Manage your supplier directory and update payment terms
- Record incoming bills and match them to purchase orders
- Raise purchase orders and track their fulfillment status
- Review outstanding payables and receivables at a glance
- Monitor AI providers as finance-owned suppliers, including draft contracts, open setup work items, and linked billing/usage pages
- Review committed AI spend and setup gaps from the dedicated `/finance/spend/ai` workspace

## Owner-first overview (food & hospitality)

For restaurants, bakeries, and caterers (the **food-hospitality** archetype), the `/finance` overview opens with **"what money needs attention today?"** instead of an accountant-shaped dashboard, and the money jobs it shows are matched to your specific business.

**Restaurant**

- **Deposits & event balances** — booking deposits and private-dining balances still to collect
- **Order & ticket payments** — money coming in from table orders, tickets, and covers
- **Overdue payments** — guest and private-dining payments past their due date
- **Supplier bills** — food, drink, and supplier bills waiting to be paid
- **Payouts & reconciliation** — card payouts landing in the bank, matched back to sales
- **No-show & cancellation fees** — charge a fee when a guest no-shows or cancels late

**Catering**

- **Event deposits & balances** — deposits securing dates, and balances due after events are delivered
- **Event payments received** — money in from catering jobs and events
- **Overdue event payments** — corporate and event invoices past their due date
- **Ingredient & staffing bills** — food, drink, and staffing costs for upcoming events
- **Payouts & reconciliation**
- **Quote a catering job** — price a corporate, wedding, or private event before you commit

**Bakery**

- **Custom order deposits & balances** — deposits and balances on celebration and wedding cakes
- **Counter & order takings** — money in from counter sales and collected orders
- **Overdue order payments** — custom and wholesale orders past their due date
- **Ingredient & supplier bills** — flour, dairy, packaging, and supplier bills
- **Payouts & reconciliation**
- **Bill a custom order** — take a deposit on a celebration or wedding cake

A food-hospitality business that isn't one of those three sees a neutral food/drink set of the same jobs.

Accounting internals — VAT/tax remittance, dunning reminders, payment runs, ledger and P&L reports, bank rules, and AI spend — are kept one tap away under a collapsed **"Accounting & admin"** section. Every other business type keeps the standard finance overview.

### Readiness notes

**Draft readiness note** asks the Finance Specialist coworker to write up the position shown on the overview: 3–5 bullets covering what needs attention, why it matters, and the safest next action. The note is drafted from the figures on screen — the coworker is instructed not to invent numbers, and to omit anything it has no figure for.

It is a **draft for you to review**. Nothing is sent to anyone, no action is taken on your behalf, and the note will not claim money has been paid or moved — recording a payment in DPF is not a bank transfer. If your finances aren't set up yet, the note explains what to set up first instead.

## Recording a payment run

A payment run (`/finance/payment-runs`) **records the selected approved bills as paid in DPF** and writes a matching outbound payment. It is **not a draft** and does **not** initiate a real bank transfer — pay your suppliers through your bank as usual, then use a payment run to keep your books settled. The action is labelled **"Record as Paid"** to make this explicit.

## Route Guide

- `/finance` — Finance overview workspace
- `/finance/spend` — spend hub for suppliers, bills, expenses, and AI spend summary
- `/finance/spend/ai` — dedicated AI supplier spend and utilization workspace
- `/finance/suppliers/[id]` — supplier detail, including AI finance context when the supplier is linked to a provider
