// BOM Workforce surface manifest (BI-D5C9C3F7, EP-BOM-WIRING).
//
// Structural realization of the DOC-1996319D "Surface-to-DigitalProduct Matrix":
// the platform surfaces/functions the workforce operates ARE digital products the
// org uses internally, and belong under the `for_employees` (Workforce) portfolio.
// This manifest names the for_employees rows of that matrix so a projector can
// materialize them as DigitalProducts idempotently — no parallel surface-map
// table. BI-7B4E0D82 expands the original finance-heavy slice into the full
// top-level For Employees functional fan-out.
//
// Note: per-AI-coworker products are produced separately by the coworker projector
// (BI-8F9EDD6C). These are the SURFACE-level Workforce products (the operator/
// coworker tools + the finance/tax business function), not the coworkers.

/** One BOM Workforce surface to materialize as a for_employees DigitalProduct. */
export interface BomWorkforceSurface {
  /** Stable, deterministic product id (idempotent re-projection). */
  productId: string;
  name: string;
  description: string;
  /** Existing taxonomy nodeId string, or null to sit at the portfolio root. */
  taxonomyNodeId: string | null;
}

export const BOM_WORKFORCE_DOMAIN_PREFIX = "bom-domain-";

export const BOM_WORKFORCE_SURFACE_MANIFEST: BomWorkforceSurface[] = [
  {
    productId: "bom-domain-corporate-communication",
    name: "Corporate Communication Functionality",
    description:
      "For Employees functionality for internal and external corporate communication: messaging, community outreach, employee communications, and communications governance.",
    taxonomyNodeId: "for_employees/corporate_communication",
  },
  {
    productId: "bom-domain-vision-strategy",
    name: "Vision and Strategy Functionality",
    description:
      "For Employees functionality for developing vision, strategy, goals, and strategic direction that guides workforce and coworker activity.",
    taxonomyNodeId: "for_employees/develop_vision_and_strategy",
  },
  {
    productId: "bom-domain-business-capabilities",
    name: "Business Capability Management Functionality",
    description:
      "For Employees functionality for managing business capabilities, business processes, operating-model maturity, and capability gap closure.",
    taxonomyNodeId: "for_employees/develop_and_manage_business_capabilities",
  },
  {
    productId: "bom-domain-products-services-management",
    name: "Product and Service Management Functionality",
    description:
      "For Employees functionality for managing the internal work that shapes products and services: roadmaps, lifecycle, requirements, and service planning.",
    taxonomyNodeId: "for_employees/develop_and_manage_products_and_services",
  },
  {
    productId: "bom-domain-portfolio-investments",
    name: "Portfolio Investment Planning Functionality",
    description:
      "For Employees functionality for evaluating, prioritizing, and planning portfolio investments across human employees, AI coworkers, internal tools, and business outcomes.",
    taxonomyNodeId: "for_employees/evaluate_and_plan_portfolio_investments",
  },
  {
    productId: "bom-domain-financial-management",
    name: "Financial Management Functionality",
    description:
      "For Employees functionality for finance operations: accounting, payables, receivables, payroll, treasury, reporting, close, controls, and tax posture.",
    taxonomyNodeId: "for_employees/financial_management",
  },
  {
    productId: "bom-domain-hsse",
    name: "Health, Safety, Security, and Environmental Functionality",
    description:
      "For Employees functionality for workforce health, workplace safety, environmental practices, physical security, and HSSE compliance.",
    taxonomyNodeId: "for_employees/health_safety_security_and_environmental_services",
  },
  {
    productId: "bom-domain-legal",
    name: "Legal Functionality",
    description:
      "For Employees functionality for legal operations, contracts, claims, policy review, regulatory support, and legal service coordination.",
    taxonomyNodeId: "for_employees/legal",
  },
  {
    productId: "bom-domain-enterprise-risk-resiliency",
    name: "Enterprise Risk and Resiliency Functionality",
    description:
      "For Employees functionality for enterprise risk, compliance, remediation, resilience, continuity, and operational recovery planning.",
    taxonomyNodeId: "for_employees/manage_enterprise_risk_compliance_remediation_and_resiliency",
  },
  {
    productId: "bom-domain-external-relationships",
    name: "External Relationship Management Functionality",
    description:
      "For Employees functionality for managing partners, regulators, communities, vendors, alliances, and other external working relationships.",
    taxonomyNodeId: "for_employees/manage_external_relationships",
  },
  {
    productId: "bom-domain-organizational-direction",
    name: "Organizational Direction Setting Functionality",
    description:
      "For Employees functionality for leadership alignment, operating cadence, goal setting, accountability, and organization-wide direction.",
    taxonomyNodeId: "for_employees/organizational_direction_setting",
  },
  {
    productId: "bom-domain-productivity-services",
    name: "Productivity Services Functionality",
    description:
      "For Employees functionality for collaboration, knowledge work, productivity applications, service desk, end-user computing, and workplace enablement.",
    taxonomyNodeId: "for_employees/productivity_services",
  },
  {
    productId: "bom-domain-property-facility-services",
    name: "Property and Facility Services Functionality",
    description:
      "For Employees functionality for facilities, workplace operations, property services, space support, and physical workplace enablement.",
    taxonomyNodeId: "for_employees/property_and_facility_services",
  },
  {
    productId: "bom-domain-sales-marketing",
    name: "Sales and Marketing Functionality",
    description:
      "For Employees functionality for CRM, sales work, marketing operations, inquiry management, customer analytics, partner management, and sales-channel support.",
    taxonomyNodeId: "for_employees/sales_and_marketing",
  },
  {
    productId: "bom-domain-security-compliance",
    name: "Security and Compliance Functionality",
    description:
      "For Employees functionality for identity, access, cybersecurity operations, privacy, governance, risk, compliance, and security awareness.",
    taxonomyNodeId: "for_employees/security_and_compliance",
  },
  {
    productId: "bom-domain-vendor-procurement",
    name: "Vendor and Procurement Services Functionality",
    description:
      "For Employees functionality for sourcing, procurement, supplier management, contract management, and technology vendor management.",
    taxonomyNodeId: "for_employees/vendor_and_procurement_services",
  },
  {
    productId: "bom-domain-workforce-services",
    name: "Workforce Services Functionality",
    description:
      "For Employees functionality for human employees and AI coworkers: workforce planning, HR operations, talent, learning, employee relations, supervision, and parity governance.",
    taxonomyNodeId: "for_employees/workforce_services",
  },
  {
    productId: "bom-surface-ai-workforce-ops",
    name: "AI Workforce Operations",
    description:
      "The AI Workforce admin & operations surface (/platform/ai): coworker records, capability needs, tool grants, model/token budgets. The workforce-management product the org runs its AI coworkers on.",
    taxonomyNodeId: "for_employees/workforce_services",
  },
  {
    productId: "bom-surface-workforce-roster",
    name: "Workforce Roster",
    description:
      "The unified workforce roster spanning human employees and AI coworkers, with the coworker needs lens plus human-role parity anchor and approval/interface owner (DOC-7693D528).",
    taxonomyNodeId: "for_employees/workforce_services/workforce_planning_and_management",
  },
  {
    productId: "bom-surface-ai-coworker-services-catalog",
    name: "AI Coworker Services Catalog",
    description:
      "The catalog of AI coworker services and offers consumed internally — the CoworkerService / CoworkerOffer surface, linked to per-coworker Workforce products.",
    taxonomyNodeId: "for_employees/workforce_services",
  },
  {
    productId: "bom-surface-portfolio-management-cockpit",
    name: "Portfolio Management Cockpit",
    description:
      "The employee/coworker-facing tool for managing all four portfolios (/portfolio). A Workforce-facing management surface; the products it manages retain their own portfolios.",
    taxonomyNodeId: "for_employees/evaluate_and_plan_portfolio_investments",
  },
  {
    productId: "bom-surface-finance-operations-work-lane",
    name: "Finance Operations Work Lane",
    description:
      "The employee/accountant-coworker finance operations surface (financial management). Depends on Foundational accounting ledger, bank feeds, and identity.",
    taxonomyNodeId: "for_employees/financial_management",
  },
  {
    // DOC-1996319D Tax Remittance exemplar: a Workforce financial-management product.
    productId: "bom-surface-tax-remittance",
    name: "Tax Remittance / Paying Taxes",
    description:
      "Paying taxes / tax remittance as a Workforce financial-management product (consumers: finance employee, accountant coworker, operator). Depends on Foundational accounting/banking/identity and, where tax derives from sales, Goods and Services for Sale revenue records.",
    taxonomyNodeId: "for_employees/financial_management/manage_taxes",
  },
  {
    productId: "bom-surface-productivity-collaboration",
    name: "Employee Productivity and Collaboration",
    description:
      "The workforce-facing productivity and collaboration surface: communication, work management, knowledge work, and adoption workflows consumed by employees and AI coworkers.",
    taxonomyNodeId: "for_employees/productivity_services/work_and_collaboration_management",
  },
  {
    productId: "bom-surface-crm-sales-work-lane",
    name: "CRM and Sales Operations Work Lane",
    description:
      "The employee/coworker sales operations surface for CRM, opportunity work, customer sales evidence, and governed handoffs between sales employees and sales coworkers.",
    taxonomyNodeId: "for_employees/sales_and_marketing/customer_sales",
  },
  {
    productId: "bom-surface-marketing-operations-work-lane",
    name: "Marketing Operations Work Lane",
    description:
      "The employee/coworker marketing operations surface for campaign planning, content review, inquiry generation, and marketing coworker governance.",
    taxonomyNodeId: "for_employees/sales_and_marketing/marketing_and_advertising",
  },
  {
    productId: "bom-surface-procurement-vendor-work-lane",
    name: "Procurement and Vendor Operations Work Lane",
    description:
      "The workforce-facing procurement surface for sourcing, supplier management, purchase support, and vendor-governance handoffs.",
    taxonomyNodeId: "for_employees/vendor_and_procurement_services/sourcing_and_procurement",
  },
  {
    productId: "bom-surface-security-identity-compliance-work-lane",
    name: "Security, Identity, and Compliance Work Lane",
    description:
      "The employee/coworker security surface for access, compliance evidence, privacy controls, and security-aware workforce operations.",
    taxonomyNodeId: "for_employees/security_and_compliance/identity_and_access_management",
  },
  {
    productId: "bom-surface-legal-contract-operations",
    name: "Legal and Contract Operations",
    description:
      "The workforce-facing legal operations surface for contracts, policy review, claims, and legal handoffs.",
    taxonomyNodeId: "for_employees/legal",
  },
  {
    productId: "bom-surface-facilities-workplace-operations",
    name: "Facilities and Workplace Operations",
    description:
      "The workforce-facing facilities and workplace operations surface for physical workplace support, property services, and employee environment needs.",
    taxonomyNodeId: "for_employees/property_and_facility_services",
  },
];
