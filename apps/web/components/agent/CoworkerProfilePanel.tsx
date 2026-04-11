"use client";

import { useState } from "react";
import type { AgentInfo, AgentSkill } from "@/lib/agent-coworker-types";

type Props = {
  agent: AgentInfo;
  onClose: () => void;
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--dpf-muted)",
  marginBottom: 6,
};

const tagStyle: React.CSSProperties = {
  fontSize: 9,
  color: "var(--dpf-text-secondary)",
  border: "1px solid var(--dpf-border)",
  borderRadius: 3,
  padding: "1px 5px",
  lineHeight: "14px",
  display: "inline-block",
};

function groupSkillsByCategory(skills: AgentSkill[]): Record<string, AgentSkill[]> {
  const groups: Record<string, AgentSkill[]> = {};
  for (const skill of skills) {
    const cat = skill.category || "general";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(skill);
  }
  return groups;
}

const categoryLabels: Record<string, string> = {
  universal: "Universal",
  portfolio: "Portfolio",
  inventory: "Inventory",
  ea: "Architecture",
  employee: "Employee",
  customer: "Customer",
  ops: "Operations",
  build: "Build Studio",
  platform: "Platform",
  admin: "Administration",
  compliance: "Compliance",
  storefront: "Storefront",
  workspace: "Workspace",
  docs: "Documentation",
  general: "General",
};

export function CoworkerProfilePanel({ agent, onClose }: Props) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const grouped = groupSkillsByCategory(agent.skills);

  // Separate skills from tools based on enriched data
  const skills = agent.skills.filter((s) => !s.allowedTools || s.allowedTools.length === 0 || s.taskType !== "tool");
  const toolSkills = agent.skills.filter((s) => s.allowedTools && s.allowedTools.length > 0);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--dpf-surface-1)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--dpf-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--dpf-success)]" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)" }}>
              {agent.agentName}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--dpf-text-secondary)", marginTop: 4, marginLeft: 14 }}>
            {agent.agentDescription}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6, marginLeft: 14 }}>
            <span style={{
              ...tagStyle,
              color: "var(--dpf-accent)",
              borderColor: "color-mix(in srgb, var(--dpf-accent) 40%, transparent)",
            }}>
              {agent.sensitivity}
            </span>
            <span style={tagStyle}>
              {agent.agentId}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--dpf-muted)",
            cursor: "pointer",
            fontSize: 14,
            padding: "2px 6px",
          }}
        >
          x
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px" }}>
        {/* Skills Section */}
        <div style={sectionStyle}>
          <div style={{ ...sectionHeaderStyle, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12 }}>Skills</span>
            <span style={{ fontSize: 9, color: "var(--dpf-muted)", fontWeight: 400 }}>
              What I know how to do
            </span>
          </div>

          {Object.entries(grouped).map(([category, catSkills]) => (
            <div key={category} style={{ marginBottom: 10 }}>
              <div style={{
                fontSize: 9,
                fontWeight: 500,
                color: "var(--dpf-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
              }}>
                {categoryLabels[category] || category}
              </div>
              {catSkills.map((skill) => {
                const id = skill.skillId || skill.label;
                const isExpanded = expandedSkill === id;
                return (
                  <div
                    key={id}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--dpf-border)",
                      marginBottom: 4,
                      cursor: "pointer",
                      background: isExpanded
                        ? "color-mix(in srgb, var(--dpf-accent) 8%, transparent)"
                        : "transparent",
                    }}
                    onClick={() => setExpandedSkill(isExpanded ? null : id)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--dpf-text)" }}>
                          {skill.label}
                        </span>
                        {skill.taskType && skill.taskType !== "conversation" && (
                          <span style={{
                            fontSize: 8,
                            color: "var(--dpf-accent)",
                            border: "1px solid color-mix(in srgb, var(--dpf-accent) 40%, transparent)",
                            borderRadius: 3,
                            padding: "0 3px",
                          }}>
                            {skill.taskType === "code_generation" ? "code" : skill.taskType}
                          </span>
                        )}
                        {skill.agentInvocable && (
                          <span style={{
                            fontSize: 8,
                            color: "var(--dpf-info)",
                            border: "1px solid color-mix(in srgb, var(--dpf-info) 40%, transparent)",
                            borderRadius: 3,
                            padding: "0 3px",
                          }}>
                            peer
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>
                        {isExpanded ? "-" : "+"}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>
                      {skill.description}
                    </div>

                    {isExpanded && (
                      <div style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: "1px solid var(--dpf-border)",
                        fontSize: 10,
                        color: "var(--dpf-text-secondary)",
                      }}>
                        {skill.capability && (
                          <div style={{ marginBottom: 4 }}>
                            <strong>Requires:</strong> {skill.capability}
                          </div>
                        )}
                        {skill.allowedTools && skill.allowedTools.length > 0 && (
                          <div style={{ marginBottom: 4 }}>
                            <strong>Tools:</strong> {skill.allowedTools.join(", ")}
                          </div>
                        )}
                        {skill.triggerPattern && (
                          <div style={{ marginBottom: 4 }}>
                            <strong>Triggers on:</strong> {skill.triggerPattern}
                          </div>
                        )}
                        {skill.riskBand && skill.riskBand !== "low" && (
                          <div>
                            <strong>Risk:</strong> {skill.riskBand}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Tools Section */}
        {toolSkills.length > 0 && (
          <div style={sectionStyle}>
            <div style={{ ...sectionHeaderStyle, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12 }}>Tools</span>
              <span style={{ fontSize: 9, color: "var(--dpf-muted)", fontWeight: 400 }}>
                What I can connect to
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {[...new Set(toolSkills.flatMap((s) => s.allowedTools || []))].map((tool) => (
                <span key={tool} style={{
                  ...tagStyle,
                  fontSize: 10,
                  padding: "2px 6px",
                }}>
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Model Requirements */}
        {agent.modelRequirements && (
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>Model Configuration</div>
            <div style={{ fontSize: 10, color: "var(--dpf-text-secondary)", lineHeight: 1.6 }}>
              {agent.modelRequirements.defaultMinimumTier && (
                <div>Tier: {agent.modelRequirements.defaultMinimumTier}</div>
              )}
              {agent.modelRequirements.defaultBudgetClass && (
                <div>Budget: {agent.modelRequirements.defaultBudgetClass}</div>
              )}
              {agent.modelRequirements.defaultEffort && (
                <div>Effort: {agent.modelRequirements.defaultEffort}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
