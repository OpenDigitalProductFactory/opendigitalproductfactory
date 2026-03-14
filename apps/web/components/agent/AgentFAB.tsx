"use client";

type Props = {
  onClick: () => void;
};

export function AgentFAB({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open AI Co-worker"
      style={{
        position: "fixed",
        right: 16,
        top: "50%",
        transform: "translateY(-50%)",
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "rgba(124, 140, 248, 0.7)",
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(124, 140, 248, 0.3)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        zIndex: 50,
        transition: "transform 0.15s, opacity 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(1.1)";
        e.currentTarget.style.opacity = "0.9";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(-50%)";
        e.currentTarget.style.opacity = "1";
      }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full bg-green-400"
        style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)" }}
      />
    </button>
  );
}
