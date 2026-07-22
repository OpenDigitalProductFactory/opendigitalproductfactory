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

For restaurants, cafés, bakeries, and caterers (the **food-hospitality** archetype), the `/finance` overview opens with **"what money needs attention today?"** instead of an accountant-shaped dashboard. It foregrounds the money jobs an owner runs day to day:

- **Deposits & event balances** — booking deposits and catering/event balances still to collect
- **Order & ticket payments** — money coming in from orders, tickets, and covers
- **Overdue payments** — guest, catering, and event payments past their due date
- **Supplier bills** — food, drink, and supplier bills waiting to be paid
- **Payouts & reconciliation** — card payouts landing in the bank, matched back to sales
- **No-show & cancellation fees** — charge a fee when a guest no-shows or cancels late

Accounting internals — VAT/tax remittance, dunning reminders, payment runs, ledger and P&L reports, bank rules, and AI spend — are kept one tap away under a collapsed **"Accounting & admin"** section. Every other business type keeps the standard finance overview.

## Recording a payment run

A payment run (`/finance/payment-runs`) **records the selected approved bills as paid in DPF** and writes a matching outbound payment. It is **not a draft** and does **not** initiate a real bank transfer — pay your suppliers through your bank as usual, then use a payment run to keep your books settled. The action is labelled **"Record as Paid"** to make this explicit.

## Route Guide

- `/finance` — Finance overview workspace
- `/finance/spend` — spend hub for suppliers, bills, expenses, and AI spend summary
- `/finance/spend/ai` — dedicated AI supplier spend and utilization workspace
- `/finance/suppliers/[id]` — supplier detail, including AI finance context when the supplier is linked to a provider
