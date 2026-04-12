"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentSkill } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { can } from "@/lib/permissions";

type UserSkill = {
  skillId: string;
  name: string;
  intent: string;
  visibility: string;
  usageCount: number;
};

type MarketingSkillRule = { visible?: boolean; label?: string; reframe?: string };

type Props = {
  skills: AgentSkill[];
  userSkills: UserSkill[];
  userContext: UserContext;
  marketingSkillRules?: Record<string, MarketingSkillRule> | null;
  onSend: (prompt: string) => void;
  onCreateSkill: () => void;
};

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
};

const taskTypeIcons: Record<string, string> = {
  conversation: "",
  code_generation: "[code]",
  analysis: "[analysis]",
};

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

/** Apply archetype-driven skill rules: hide skills or relabel them. Exported for testing. */
export function applyMarketingSkillRules(
  skills: AgentSkill[],
  rules: Record<string, MarketingSkillRule> | null | undefined,
): AgentSkill[] {
  if (!rules) return skills;
  return skills
    .filter((s) => {
      if (!s.skillId) return true;
      const rule = rules[s.skillId];
      if (rule && rule.visible === false) return false;
      return true;
    })
    .map((s) => {
      if (!s.skillId) return s;
      const rule = rules[s.skillId];
      if (rule && rule.label && rule.reframe) {
        return {
          ...s,
          label: rule.label,
          prompt: `[ARCHETYPE CONTEXT: ${rule.reframe}]\n\n${s.prompt}`,
        };
      }
      return s;
    });
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--dpf-muted)",
  padding: "6px 12px 2px",
};

const skillButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "none",
  border: "none",
  padding: "8px 12px",
  cursor: "pointer",
  color: "var(--dpf-text)",
  fontSize: 12,
  lineHeight: 1.3,
};

function handleHoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "color-mix(in srgb, var(--dpf-accent) 15%, transparent)";
}

function handleHoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "none";
}

export function AgentSkillsDropdown({
  skills,
  userSkills,
  userContext,
  marketingSkillRules,
  onSend,
  onCreateSkill,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const filteredSkills = applyMarketingSkillRules(
    skills.filter((s) => s.capability === null || can(userContext, s.capability)),
    marketingSkillRules,
  );

  // Group skills by category for enriched display
  const coworkerSkills = filteredSkills.filter((s) => s.category && s.category !== "universal");
  const universalSkills = filteredSkills.filter((s) => s.category === "universal" || !s.category);

  const orgSkills = userSkills.filter((s) => s.visibility === "org");
  const teamSkills = userSkills.filter((s) => s.visibility === "team");
  const mySkills = userSkills.filter((s) => s.visibility === "personal");

  // Delayed close gives the mouse time to travel from trigger to dropdown
  function startClose() {
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  }

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function handleEnter() {
    cancelClose();
    setIsOpen(true);
  }

  function handleLeave() {
    startClose();
  }

  function renderUserSkillItem(skill: UserSkill) {
    return (
      <button
        key={skill.skillId}
        type="button"
        onClick={() => {
          onSend(skill.intent);
          setIsOpen(false);
        }}
        style={skillButtonStyle}
        onMouseEnter={handleHoverIn}
        onMouseLeave={handleHoverOut}
      >
        <div style={{ fontWeight: 600 }}>{skill.name}</div>
        <div
          style={{
            fontSize: 10,
            color: "var(--dpf-muted)",
            marginTop: 2,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{truncate(skill.intent, 60)}</span>
          <span style={{ opacity: 0.6, marginLeft: 6, flexShrink: 0 }}>
            {skill.usageCount}x
          </span>
        </div>
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <button
        type="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
        }}
        style={{
          background: "none",
          border: "none",
          color: "var(--dpf-muted)",
          fontSize: 10,
          cursor: "pointer",
          padding: "2px 4px",
          borderRadius: 3,
        }}
      >
        Skills ▼
      </button>

      {isOpen && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={handleLeave}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            minWidth: 220,
            maxWidth: 280,
            background: "color-mix(in srgb, var(--dpf-surface-1) 95%, transparent)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.15)",
            zIndex: 60,
            padding: "4px 0",
            paddingTop: 8,
            marginTop: 0,
          }}
        >
          {/* Coworker Skills section (route-specific) */}
          {coworkerSkills.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Coworker Skills</div>
              {coworkerSkills.map((skill) => (
                <button
                  key={skill.skillId ?? skill.prompt}
                  type="button"
                  onClick={() => {
                    onSend(skill.prompt);
                    setIsOpen(false);
                  }}
                  style={skillButtonStyle}
                  onMouseEnter={handleHoverIn}
                  onMouseLeave={handleHoverOut}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontWeight: 500 }}>{skill.label}</span>
                    {skill.taskType && skill.taskType !== "conversation" && (
                      <span style={{
                        fontSize: 8,
                        color: "var(--dpf-accent)",
                        border: "1px solid color-mix(in srgb, var(--dpf-accent) 40%, transparent)",
                        borderRadius: 3,
                        padding: "0 3px",
                        lineHeight: "14px",
                      }}>
                        {taskTypeIcons[skill.taskType] || skill.taskType}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--dpf-muted)",
                      marginTop: 2,
                    }}
                  >
                    {skill.description}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Universal Skills section */}
          {universalSkills.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Universal</div>
              {universalSkills.map((skill) => (
                <button
                  key={skill.skillId ?? skill.prompt}
                  type="button"
                  onClick={() => {
                    onSend(skill.prompt);
                    setIsOpen(false);
                  }}
                  style={skillButtonStyle}
                  onMouseEnter={handleHoverIn}
                  onMouseLeave={handleHoverOut}
                >
                  <div style={{ fontWeight: 500 }}>{skill.label}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--dpf-muted)",
                      marginTop: 2,
                    }}
                  >
                    {skill.description}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Org Skills section */}
          {orgSkills.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Org Skills</div>
              {orgSkills.map(renderUserSkillItem)}
            </>
          )}

          {/* Team Skills section */}
          {teamSkills.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Team Skills</div>
              {teamSkills.map(renderUserSkillItem)}
            </>
          )}

          {/* My Skills section */}
          {mySkills.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>My Skills</div>
              {mySkills.map(renderUserSkillItem)}
            </>
          )}

          {/* Create a skill action */}
          <div
            style={{
              borderTop: "1px solid var(--dpf-border)",
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                onCreateSkill();
                setIsOpen(false);
              }}
              style={{
                ...skillButtonStyle,
                color: "var(--dpf-accent)",
                fontSize: 11,
              }}
              onMouseEnter={handleHoverIn}
              onMouseLeave={handleHoverOut}
            >
              + Create a skill...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
