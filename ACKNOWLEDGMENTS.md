# Acknowledgments

The Open Digital Product Factory stands on the shoulders of decades of work from standards bodies, industry vendors, researchers, and authors. This document credits the sources that have shaped DPF's conceptual foundation.

Most of the materials listed below are proprietary to their respective rightsholders and are **not redistributed with this repository**. Please obtain them directly from the links provided.

This file is a companion to [NOTICE](NOTICE), which lists the open-source software dependencies and their required attribution. Code contributors are recorded in the git commit history; this file credits the ideas.

---

## Industry Standards

### IT4IT&trade; Reference Architecture

The Open Group's reference model for the IT value chain. DPF's value stream alignment, agent role taxonomy, and functional criteria structure are based on IT4IT.

- **Publisher**: The Open Group
- **Version referenced**: 3.0.1
- **Home**: <https://pubs.opengroup.org/it4it/3.0/standard/>
- **Licensing**: evaluation, member, and commercial licenses via The Open Group; the specification is not redistributable under any tier
- **Contributing author**: Mark Bodman (via The Open Group IT4IT Forum)

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

ServiceNow's conceptual model for CMDB-aligned service and product data. DPF's entity taxonomy for portfolio-to-configuration mapping draws on CSDM concepts.

- **Publisher**: ServiceNow, Inc.
- **White paper**: <https://www.servicenow.com/community/common-service-data-model/csdm-5-finally-get-the-csdm-5-white-paper-here/ta-p/3254967>
- **Licensing**: &copy; ServiceNow, all rights reserved; hosted on ServiceNow Community under ServiceNow's terms of use

### ServiceNow CMDB CI Classes

The canonical configuration item class hierarchy of the ServiceNow platform. DPF's CI class alignment patterns for portfolio inventory draw on this schema.

- **Publisher**: ServiceNow, Inc.
- **Home**: <https://www.servicenow.com/docs/>
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

The DPF taxonomy (see [packages/db/data/taxonomy_v3.json](packages/db/data/taxonomy_v3.json) and [docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx](docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx)) is original work by Mark Bodman, substantially transformed from study of the sources below. It is distributed under this repository's Apache License 2.0. A donation of the taxonomy to the TBM Council is in progress; once accepted, the relevant license will reflect that transfer.

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

Several documents previously included under [docs/Reference/](docs/Reference/) have been removed from version control to respect the copyrights of their owners. They remain important conceptual sources. Please obtain them from the original publishers at the links above.

All **original** content in this repository is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for the code license and [NOTICE](NOTICE) for required attributions of bundled open-source dependencies.
