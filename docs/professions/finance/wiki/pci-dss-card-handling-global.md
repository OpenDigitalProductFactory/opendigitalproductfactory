---
title: PCI DSS applies wherever you handle cards — globally, not by region
pageKind: heuristic
status: published
abstract: Any business that stores, processes, or transmits cardholder data must meet PCI DSS regardless of where it operates or sells. It is a global card-brand requirement enforced by contract, not a regional law, so it cannot be scoped away by jurisdiction.
professionCompetencyLevel: foundational
professionJurisdictionBasis: global
sources:
  - wikipedia/pci-dss
---

## Heuristic

"PCI DSS is a global data security standard that regulates how entities store, process, and transmit cardholder data." It is enforced by the card brands (Visa, Mastercard, Amex, Discover, JCB) through contract and penalties — **not** by a regional government. So unlike sales tax, marketing consent, or employment law, PCI does **not** depend on where the business operates, sells, or employs.

For any business that takes card payments:

- Treat PCI DSS as **always in scope** the moment cardholder data is stored, processed, or transmitted — there is no region where it does not apply.
- Protect stored account data and restrict access on a business need-to-know basis.
- Use strong cryptography to protect cardholder data **in transit** over public networks.
- The cleanest way to shrink scope is to **not** store card data — use a compliant processor/tokenization so the business never holds the PAN.

## Why it matters

Because PCI is contractual and global, "we're a small US shop" or "we only sell locally" does not exempt anyone. A breach of un-protected card data brings card-brand fines and loss of the ability to take cards — an existential operational risk, not a regional footnote.

## Source

- *Payment Card Industry Data Security Standard* (Wikipedia, CC BY-SA): https://en.wikipedia.org/wiki/Payment_Card_Industry_Data_Security_Standard
