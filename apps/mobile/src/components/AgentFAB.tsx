import React, { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "@/src/lib/theme";
import { useAgentStore } from "@/src/features/agent/agent.store";
import { useAgentRouting } from "@/src/hooks/useAgentRouting";
import { AgentPanel } from "./AgentPanel";

/**
 * Floating action button for the agent co-worker. Renders globally when
 * authenticated, positioned absolutely above all content. Also mounts
 * the AgentPanel when opened.
 */
export function AgentFAB() {
  const { isOpen, togglePanel, setAgent } = useAgentStore();
  const agentId = useAgentRouting();

  // Sync the routed agent whenever the route changes
  useEffect(() => {
    setAgent(agentId);
  }, [agentId, setAgent]);

  return (
    <>
      {!isOpen ? (
        <Pressable
          onPress={togglePanel}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Open agent co-worker"
        >
          <Ionicons name="chatbubble-ellipses" size={28} color={colors.white} />
        </Pressable>
      ) : null}

      {isOpen ? <AgentPanel /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: spacing.xl + 60, // above tab bar
    right: spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 1000,
  },
  pressed: {
    opacity: 0.8,
  },
});
