// apps/web/components/compliance/compliance-nav.ts
//
// Pure data module for the Compliance secondary nav. Lifted out of ComplianceTabNav.tsx
// (EP-NAV-COHERENCE P3/P5) so the navigation surface can ingest it without importing a
// client component — registered as a navigation source in lib/ea/domain-nav-sources.ts
// so the Compliance routes join the one navigation surface and leave the orphan set.

export type ComplianceFamily = {
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

export const COMPLIANCE_FAMILIES: ComplianceFamily[] = [
  {
    label: "Overview",
    href: "/compliance",
    description: "Scan posture, deadlines, and the latest alerts across the program.",
    matchPrefixes: ["/compliance"],
    subItems: [],
  },
  {
    label: "Licensing",
    href: "/compliance/licensing",
    description: "Operate licensing, permit, credential, fee, and display-readiness workflows across the business.",
    matchPrefixes: ["/compliance/licensing"],
    subItems: [{ label: "Licensing workspace", href: "/compliance/licensing" }],
  },
  {
    label: "Library",
    href: "/compliance/policies",
    description: "Manage the rules you are accountable to and the internal policy library around them.",
    matchPrefixes: ["/compliance/policies", "/compliance/regulations", "/compliance/obligations"],
    subItems: [
      { label: "Policies", href: "/compliance/policies" },
      { label: "Regulations", href: "/compliance/regulations" },
      { label: "Obligations", href: "/compliance/obligations" },
    ],
  },
  {
    label: "Controls",
    href: "/compliance/controls",
    description: "Track controls and the evidence that proves they are working.",
    matchPrefixes: ["/compliance/controls", "/compliance/evidence"],
    subItems: [
      { label: "Controls", href: "/compliance/controls" },
      { label: "Evidence", href: "/compliance/evidence" },
    ],
  },
  {
    label: "Assurance",
    href: "/compliance/audits",
    description: "Coordinate audits, submissions, and posture review activity.",
    matchPrefixes: ["/compliance/audits", "/compliance/submissions", "/compliance/posture"],
    subItems: [
      { label: "Audits", href: "/compliance/audits" },
      { label: "Submissions", href: "/compliance/submissions" },
      { label: "Posture", href: "/compliance/posture" },
    ],
  },
  {
    label: "Risk",
    href: "/compliance/risks",
    description: "Stay on top of risks, incidents, actions, and open gaps.",
    matchPrefixes: ["/compliance/risks", "/compliance/incidents", "/compliance/actions", "/compliance/gaps"],
    subItems: [
      { label: "Risks", href: "/compliance/risks" },
      { label: "Incidents", href: "/compliance/incidents" },
      { label: "Actions", href: "/compliance/actions" },
      { label: "Gaps", href: "/compliance/gaps" },
    ],
  },
  {
    label: "Operations",
    href: "/compliance/onboard",
    description: "Handle setup and guided onboarding into the compliance program.",
    matchPrefixes: ["/compliance/onboard"],
    subItems: [{ label: "Onboard", href: "/compliance/onboard" }],
  },
];
