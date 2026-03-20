import React from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { Notification } from "@dpf/types";

export interface NotificationItemProps {
  notification: Notification;
  onPress: (notification: Notification) => void;
}

export function NotificationItem({
  notification,
  onPress,
}: NotificationItemProps) {
  const timeAgo = formatTimeAgo(new Date(notification.createdAt));

  return (
    <Pressable
      onPress={() => onPress(notification)}
      style={({ pressed }) => [
        styles.container,
        !notification.read && styles.unread,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}${notification.read ? "" : ", unread"}`}
    >
      {!notification.read && <View style={styles.dot} />}
      <View style={styles.content}>
        <Text
          style={[styles.title, !notification.read && styles.titleUnread]}
          numberOfLines={1}
        >
          {notification.title}
        </Text>
        {notification.body ? (
          <Text style={styles.body} numberOfLines={2}>
            {notification.body}
          </Text>
        ) : null}
        <Text style={styles.timestamp}>{timeAgo}</Text>
      </View>
    </Pressable>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unread: {
    backgroundColor: colors.surface2 + "dd",
  },
  pressed: {
    opacity: 0.7,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
    marginRight: spacing.sm,
  },
  content: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    marginBottom: 2,
  },
  titleUnread: {
    fontWeight: "700",
  },
  body: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  timestamp: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
