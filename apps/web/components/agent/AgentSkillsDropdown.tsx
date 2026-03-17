"use client";

import { useRef, useState } from "react";
import type { AgentSkill } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { can } from "@/lib/permissions";

type Props = {
  skills: AgentSkill[];
  userContext: UserContext;
  onSend: (prompt: string) => void;
};

export function AgentSkillsDropdown({ skills, userContext, onSend }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredSkills = skills.filter(
    (s) => s.capability === null || can(userContext, s.capability),
  );

  if (filteredSkills.length === 0) return null;

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

  return (
    <div
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
        onKeyDown={(e) => { if (e.key === "Escape") setIsOpen(false); }}
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
            background: "rgba(26, 26, 46, 0.95)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(42, 42, 64, 0.6)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 60,
            padding: "4px 0",
            paddingTop: 8,
            marginTop: 0,
          }}
        >
          {filteredSkills.map((skill) => (
            <button
              key={skill.prompt}
              type="button"
              onClick={() => {
                onSend(skill.prompt);
                setIsOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "8px 12px",
                cursor: "pointer",
                color: "#e0e0ff",
                fontSize: 12,
                lineHeight: 1.3,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(124, 140, 248, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
              }}
            >
              <div style={{ fontWeight: 500 }}>{skill.label}</div>
              <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>
                {skill.description}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
