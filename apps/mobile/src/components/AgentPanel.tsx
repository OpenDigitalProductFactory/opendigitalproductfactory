import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { useAgentStore, LocalMessage } from "@/src/features/agent/agent.store";

function MessageBubble({ message }: { message: LocalMessage }) {
  const isUser = message.role === "user";
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.bubbleUser : styles.bubbleAssistant,
      ]}
    >
      <Text
        style={[
          styles.bubbleText,
          isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
        ]}
      >
        {message.content}
      </Text>
    </View>
  );
}

export function AgentPanel() {
  const {
    messages,
    isStreaming,
    currentAgent,
    togglePanel,
    sendMessage,
    fetchThread,
  } = useAgentStore();
  const [input, setInput] = useState("");
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  }, [input, sendMessage]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.agentName}>{currentAgent}</Text>
        <Pressable
          onPress={togglePanel}
          accessibilityRole="button"
          accessibilityLabel="Close agent panel"
          hitSlop={8}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      {/* Messages */}
      <FlatList<LocalMessage>
        ref={listRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Start a conversation with your co-worker
          </Text>
        }
      />

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          editable={!isStreaming}
          accessibilityLabel="Message input"
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Pressable
          onPress={handleSend}
          disabled={!input.trim() || isStreaming}
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.sendPressed,
            (!input.trim() || isStreaming) && styles.sendDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Ionicons name="send" size={20} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "60%",
    backgroundColor: colors.surface1,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    zIndex: 1001,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  agentName: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  bubble: {
    maxWidth: "80%",
    padding: spacing.sm + 2,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.primary,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextUser: {
    color: colors.white,
  },
  bubbleTextAssistant: {
    color: colors.text,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 14,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: {
    opacity: 0.8,
  },
  sendDisabled: {
    opacity: 0.5,
  },
});
