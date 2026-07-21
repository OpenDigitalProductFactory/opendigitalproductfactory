---
title: Treat the client's stock as goods held in trust, not stock you own
pageKind: heuristic
status: published
abstract: In third-party warehousing the operator takes custody of goods it does not own (a bailment) and is liable for their safekeeping; each client's stock is segregated, counted honestly, and a discrepancy is flagged rather than absorbed, because the warehouse receipt is a document of title the client relies on.
professionCompetencyLevel: practitioner
professionArchetype:
  - warehousing-fulfilment
sources:
  - wikipedia/warehouse-receipt
---

## Heuristic

A **warehouse receipt** is "a document of title" issued by the operator acknowledging custody of a depositor's goods. The operator does not own the goods — it holds them under a **bailment** and is liable for their safekeeping (UCC Article 7 in the US).

For a custody operator:

- **Segregate stock by owning client.** One client's inventory must never be visible in, or picked against, another's — the multi-client separation is the liability boundary, not a UX nicety.
- **Count honestly and flag variances.** When a cycle count disagrees with the record, the discrepancy itself is the reportable event; absorbing a shortfall quietly is a breach of the trust the receipt represents.
- **Carry goods-in-trust insurance** sized to the value held, distinct from cover on the operator's own assets.

## Why it matters

The stock on the racks is the client's working capital and their promise to their own customers. A 3PL that treats it as its own stock — netting shortfalls, blending client inventory — is mishandling property it is only holding, and the warehouse receipt is the instrument that makes that liability explicit.

## Source

- *Warehouse receipt* (Wikipedia, CC BY-SA): https://en.wikipedia.org/wiki/Warehouse_receipt
