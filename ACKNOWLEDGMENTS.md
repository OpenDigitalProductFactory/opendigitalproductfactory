# Acknowledgments

The Open Digital Product Factory stands on the shoulders of decades of work from standards bodies, industry vendors, researchers, and authors. This document credits the sources that have shaped DPF's conceptual foundation.

Most source publications are linked rather than copied. The repository also contains a legacy set of
tracked research artifacts, enumerated below. Their presence is not a representation that they are
Apache-2.0 material, licensed for generative-AI use, or cleared for continued distribution.

This file is a companion to [NOTICE](NOTICE), which lists the open-source software dependencies and their required attribution. Code contributors are recorded in the git commit history; this file credits the ideas.

---

## Industry Standards

### IT4IT&trade; Reference Architecture

The Open Group's reference architecture for managing the business of IT and DigitalProduct
lifecycles. DPF uses the public product record as a research target and maintains independently
expressed candidate mappings; exact standard content requires an authorized edition and a complete
source-use decision.

IT4IT&trade; is a trademark of The Open Group.

- **Publisher**: The Open Group
- **Version referenced**: 3.0.1
- **Home**: <https://publications.opengroup.org/c24a>
- **Licensing**: evaluation, member, and commercial terms via The Open Group; DPF does not redistribute or use the compiled publication as a generative-AI source
- **Mark Bodman provenance**: Mark attests that he is a named contributor to the works discussed and
  retains rights to his contributed material. The Open Group's
  [member profile](https://www.opengroup.org/member-spotlight/mark-bodman) independently documents
  involvement since the Forum's 2014 inception and an Adoption Forum chair role; it does not prove
  exact contribution boundaries or personal/member/employer title.

### Digital Product and Portfolio Publications

DPF's design lineage references two Open Group publications under different source-use decisions:

- **The Shift to Digital Product (W205, 2020)**: Mark is one of two identified authors. Its publication notice
  permits use for any purpose when copies retain the copyright and proprietary notices. The paper is
  conceptual lineage, not a formal standard.
- **Digital Product Portfolio Management in the Digital Enterprise (G252, 2025)**: Mark identifies
  the paper as design lineage, but this candidate does not use a contributor-credit locator from the
  restricted guide. The compiled guide is excluded as a generative-AI source under the PAAW
  decision, so DPF uses Mark's separately supplied direct statements and public bibliographic
  metadata rather than the guide's protected expression.

The governing distinction is documented in the
[PAAW source-use policy](docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md#1311-source-use-decisions-and-contributor-origin-material): contributor credit proves provenance,
while each separable contribution and each use still needs its own rights basis. It does not imply
that DPF, The Open Group, or any employer adopted or endorsed the other party's work.

### ArchiMate&reg; Specification

The Open Group's modeling language for enterprise architecture. DPF uses ArchiMate conventions for EA notation and metamodel structure.

- **Publisher**: The Open Group
- **Home**: <https://pubs.opengroup.org/architecture/archimate3-doc/>
- **Licensing**: evaluation, member, and commercial licenses; the specification is not redistributable

### ITIL&reg; 5

Service management practices. DPF's Digital Product lifecycle and service management concepts draw on ITIL's practice areas.

- **Publisher**: PeopleCert (formerly AXELOS)
- **Home**: <https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/ITIL-1>
- **Licensing**: proprietary; not redistributable

---

## Open-Source Reference Implementations

### Archi &mdash; ArchiMate Modelling Tool

MIT-licensed, cross-platform ArchiMate modelling tool. A freely usable implementation of the ArchiMate notation that provides a legal path for anyone to work with ArchiMate concepts without needing a TOG license for the specification itself. DPF may draw on Archi's icons, element metamodel, and serialization conventions where visual ArchiMate support is needed.

- **Project**: Archi
- **Home**: <https://www.archimatetool.com/>
- **Source**: <https://github.com/archimatetool/archi>
- **License**: MIT

---

## Vendor Frameworks and Data Models

### Common Service Data Model (CSDM) 5

ServiceNow's conceptual model for CMDB-aligned service and product data. DPF maintains independently
expressed portfolio-to-configuration profiles and links public CSDM pages only as implementation
orientation.

- **Publisher**: ServiceNow, Inc.
- **Research locator**: <https://www.servicenow.com/>; use site search for the page titled “CSDM 5 — Finally get the CSDM 5 white paper here”
- **Licensing**: &copy; ServiceNow, all rights reserved; hosted on ServiceNow Community under ServiceNow's terms of use
- **Mark Bodman provenance**: Mark attests that he originated CSDM as a ServiceNow internal standard and created several public CSDM pattern videos. DPF does not attribute any particular linked video to him without a separate enumerated record. This records design provenance only; it does not claim personal ownership of ServiceNow publications, figures, tables, class definitions, or trade dress.

### ServiceNow CMDB CI Classes

The configuration item class hierarchy of the ServiceNow platform. DPF's independently expressed CI
alignment patterns use public class names only as implementation orientation; exact schema use
requires its own permission and mapping record.

- **Publisher**: ServiceNow, Inc.
- **Research locator**: <https://www.servicenow.com/>; use the Documentation navigation
- **Licensing**: &copy; ServiceNow; proprietary

### Unified Data Model (UDM) &mdash; OpenText UCMDB

OpenText's (formerly HP / Micro Focus) universal CMDB class model. Referenced for CMDB class alignment patterns.

- **Publisher**: OpenText
- **Home**: <https://community.opentext.com/it-ops-cloud/ud-cmdb/>
- **Licensing**: &copy; OpenText

---

## Books and Academic Works

### *The Difference* / *The Hidden Factor* &mdash; Scott E. Page

Formal models of cognitive diversity, toolbox theory, superadditivity, and diversity-trumps-ability. DPF's AI-workforce diversity framework at [docs/Reference/diversity-of-thought-framework.md](docs/Reference/diversity-of-thought-framework.md) applies these ideas to agent assignment.

- **Author**: Scott E. Page (University of Michigan)
- **Works**: *The Difference: How the Power of Diversity Creates Better Groups, Firms, Schools, and Societies* (Princeton University Press, 2007); *The Hidden Factor: Why Thinking Differently Is Your Greatest Asset* (The Great Courses)
- **Licensing**: &copy; the respective publishers

---

## Taxonomies and Process Classifications

The DPF-maintained composite at
[packages/db/data/taxonomy_v3.json](packages/db/data/taxonomy_v3.json) is mechanically generated from
the V3 research workbook and includes fields marked as originating from TBM/APQC. Its per-field
authorship, transformation, license, and donation rights are therefore `undetermined` pending a
lineage audit. No blanket originality, Apache-2.0 sublicensing, or donation-rights claim is made for
inherited fields.

The research workbook
[docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx](docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx)
has a separate `undetermined` SourceUseDecision. It is reference-only, excluded as successor AI
evidence, and not covered by the originality, Apache-2.0, or donation statements above.

### Technology Business Management (TBM)

TBM Council's business-capability and cost-category frameworks informed the structure of the DPF taxonomy.

- **Publisher**: TBM Council
- **Home**: <https://www.tbmcouncil.org/>

### APQC Process Classification Framework (PCF)

APQC's cross-industry process taxonomy informed the process classification structure of the DPF taxonomy.

- **Publisher**: APQC
- **Home**: <https://www.apqc.org/process-performance-management/process-frameworks>

---

## A note on reference material

Several documents have been removed from version control, while the following material legacy
exceptions remain tracked. This inventory describes repository state; it does not grant permission.

| Tracked artifact or family | Current posture |
|---|---|
| `DigitaProductPortfolioManagement.pdf` and `digital_product_portfolio_mgmt.txt` | G252 compiled material; excluded from AI use and flagged for removal/quarantine or source-specific permission |
| `Shift to Digital Product.pdf` and `shift_to_digital_product.txt` | W205 third-party material with a retained-notice permission, but continued tracked-copy redistribution still awaits the independent acceptance required by PAAW §13.1.1 (`GAP-SOURCE-005`); not Apache-only content |
| `4_portfolio_Reworked_V2_Definitions_IT4IT.xlsx` and `4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx` | mixed-origin research workbooks; rights and per-cell provenance undetermined |
| `IT4IT_Functional_Criteria_Taxonomy.xlsx` | rights/provenance undetermined; current seeding and image distribution are an PAAW conformance gap |
| `BIAN_CSDM_Integration_v76-US-English - FINAL.pdf` and `Value-Delivery-Chain-1.jpg` | legacy third-party research artifacts; rights review pending |

Content is covered by Apache License 2.0 only where DPF holds the necessary rights or an applicable
grant says so. Third-party artifacts retain their own terms and are not relicensed merely by being
tracked. See [LICENSE](LICENSE), [NOTICE](NOTICE), and the PAAW source register.

---

## Founder Kernel

The platform ships with a "founder kernel" wiki at [docs/founder-kernel/](docs/founder-kernel/) &mdash; Mark Bodman's research, articles, and platform thinking, captured as a structured Karpathy-style wiki that every install gets as the platform's heart and that each customer organization extends with its own overlay.

The licensing approach for every bundled raw source is enumerated in
[docs/founder-kernel/RAW-SOURCES-LICENSE.md](docs/founder-kernel/RAW-SOURCES-LICENSE.md). In summary:
work for which Mark holds the necessary rights and has granted Apache-2.0 is bundled fully;
third-party or collective-work material is abstract + locator only, or pointer-only when
redistribution is restricted. Authorship or contributor credit alone never expands that grant.

Design spec: [docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md](docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md).
