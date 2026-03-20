import React, { useCallback, useEffect } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  RefreshControl,
  ActivityIndicator,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "@/src/lib/theme";
import { Button } from "@/src/components/ui/Button";
import { NotificationItem } from "@/src/components/NotificationItem";
import { useNotificationsStore } from "@/src/features/notifications/notifications.store";
import type { Notification } from "@dpf/types";

export default function NotificationsScreen() {
  const router = useRouter();
  const {
    notifications,
    isLoading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotificationsStore();

  const refresh = useCallback(() => {
    return fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePress = useCallback(
    (notification: Notification) => {
      markAsRead(notification.id);
      if (notification.deepLink) {
        router.push(notification.deepLink as any);
      }
    },
    [markAsRead, router],
  );

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <FlatList<Notification>
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={notifications}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <NotificationItem notification={item} onPress={handlePress} />
      )}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Notifications</Text>
            {hasUnread ? (
              <Button
                title="Mark all read"
                onPress={markAllAsRead}
                variant="ghost"
              />
            ) : null}
          </View>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.emptyText}>
            No notifications. You're all caught up!
          </Text>
        ) : (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.loader}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
  errorBanner: {
    backgroundColor: colors.error + "22",
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: 8,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  loader: {
    marginTop: spacing.xl,
  },
});
