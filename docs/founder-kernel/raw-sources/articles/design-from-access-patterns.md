---
sourceType: article
title: "NoSQL Data Modeling: Design From Your Access Patterns First"
authors:
  - Amazon Web Services
publishedAt: 2020-01-01
url: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html
license: third-party
abstract: |
  Canonical NoSQL design guidance. Unlike relational modeling, where you
  normalize first and query later, effective NoSQL modeling reverses the order:
  you enumerate the access patterns — the exact questions the system will be
  asked — before you decide how data is laid out, because the query shape
  dictates the storage shape. Popularized in AWS DynamoDB design practice and
  Rick Houlihan's "single-table design" re:Invent talks. The same discipline
  generalizes far beyond databases to any knowledge store: decide how it will be
  retrieved, then shape how it is stored. Abstract + locator per
  RAW-SOURCES-LICENSE.md.
---

## Why it's cited

The anchor for `[[principles/shape-knowledge-for-retrieval]]`. It is the rigorous, industry-proven statement of "start with the end in mind" for data: the retrieval question is the design input, not an afterthought. DPF applies it to its whole knowledge substrate — wiki page-kinds, memory tagging, code-graph projections, profession-corpus slugs — each shaped by how an agent will later query it.

## Key claims

- Enumerate access patterns (the questions) before modeling storage; the query shape drives the schema, not the reverse.
- A model designed without its retrieval pattern in mind forces expensive reshaping or full scans later.
- Storing the same data is cheap; storing it in the wrong shape for the dominant query is the real cost.

## See also

- Principle: `[[principles/shape-knowledge-for-retrieval]]`
- Principle: `[[principles/findability-is-part-of-capture]]`
