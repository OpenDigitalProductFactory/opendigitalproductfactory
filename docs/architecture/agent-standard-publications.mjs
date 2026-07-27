import { join, resolve } from "node:path";

const ARCH_DIR = resolve(import.meta.dirname);

export const AGENT_STANDARD_PUBLICATIONS = Object.freeze({
  tak: {
    markdownPath: join(ARCH_DIR, "trusted-ai-kernel.md"),
    outputPath: join(ARCH_DIR, "Trusted-AI-Kernel-Architecture.docx"),
    title: "Trusted AI Kernel",
    subtitle: "Normative Runtime Governance Standard",
    headerTitle: "Trusted AI Kernel (TAK)",
    diagramsDir: join(ARCH_DIR, "tak-diagrams"),
  },
  gaid: {
    markdownPath: join(ARCH_DIR, "GAID.md"),
    outputPath: join(ARCH_DIR, "GAID.docx"),
    title: "Global AI Agent Identification and Governance",
    subtitle: "Normative Identity, Badging, and Chain-of-Custody Standard",
    headerTitle: "Global AI Agent Identification and Governance (GAID)",
    diagramsDir: join(ARCH_DIR, "gaid-diagrams"),
  },
  jsi: {
    markdownPath: join(ARCH_DIR, "job-specific-intelligence.md"),
    outputPath: join(ARCH_DIR, "Job-Specific-Intelligence.docx"),
    title: "Job-Specific Intelligence",
    subtitle: "TAK Profile for Job Qualification, Autonomy, and Revalidation",
    headerTitle: "Job-Specific Intelligence (TAK-JSI)",
    diagramsDir: join(ARCH_DIR, "jsi-diagrams"),
  },
  "white-paper": {
    markdownPath: join(ARCH_DIR, "2026-04-18-trusted-ai-agent-governance-white-paper.md"),
    outputPath: join(ARCH_DIR, "Trusted-AI-Agent-Governance-White-Paper.docx"),
    title: "Trusted AI Agent Governance",
    subtitle: "Why TAK, GAID, and TAK-JSI Are Needed Now",
    headerTitle: "Trusted AI Agent Governance White Paper",
    diagramsDir: join(ARCH_DIR, "gaid-diagrams"),
  },
});

export function publicationKeys() {
  return Object.keys(AGENT_STANDARD_PUBLICATIONS);
}

export function publicationConfig(key) {
  const config = AGENT_STANDARD_PUBLICATIONS[key];
  if (!config) {
    throw new Error(
      `Unknown agent-standard publication "${key}". Expected one of: ${publicationKeys().join(", ")}`,
    );
  }
  return config;
}
