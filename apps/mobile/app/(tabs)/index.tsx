import React, { useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { colors, spacing } from "@/src/lib/theme";
import { DashboardTile } from "@/src/components/DashboardTile";
import { useWorkspaceStore } from "@/src/features/workspace/workspace.store";
import type { ActivityItem, DashboardTile as TileType } from "@dpf/types";

function TilesGrid({ tiles }: { tiles: TileType[] }) {
  const rows: TileType[][] = [];
  for (let i = 0; i < tiles.length; i += 2) {
    rows.push(tiles.slice(i, i + 2));
  }

  return (
    <View style={styles.tilesContainer}>
      {rows.map((row, idx) => (
        <View key={idx} style={styles.tileRow}>
          {row.map((tile, tileIdx) => (
            <DashboardTile key={`${tile.area}-${tileIdx}`} tile={tile} />
          ))}
          {row.length === 1 ? <View style={styles.tilePlaceholder} /> : null}
        </View>
      ))}
    </View>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <View style={styles.activityRow}>
      <Text style={styles.activityAction}>{item.action}</Text>
      <Text style={styles.activityTarget} numberOfLines={1}>
        {item.target}
      </Text>
      <Text style={styles.activityActor}>{item.actor}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const {
    tiles,
    activityFeed,
    isLoading,
    error,
    lastSynced,
    fetchDashboard,
    fetchActivity,
  } = useWorkspaceStore();

  const refresh = useCallback(async () => {
    await Promise.all([fetchDashboard(), fetchActivity()]);
  }, [fetchDashboard, fetchActivity]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const lastSyncedText = lastSynced
    ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}`
    : null;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={activityFeed}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ActivityRow item={item} />}
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
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <TilesGrid tiles={tiles} />
          {lastSyncedText ? (
            <Text style={styles.lastSynced}>{lastSyncedText}</Text>
          ) : null}
          {activityFeed.length > 0 ? (
            <Text style={styles.sectionTitle}>Recent Activity</Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.emptyText}>No recent activity</Text>
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
  tilesContainer: {
    padding: spacing.sm,
  },
  tileRow: {
    flexDirection: "row",
  },
  tilePlaceholder: {
    flex: 1,
    margin: spacing.xs,
  },
  lastSynced: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
    marginVertical: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activityAction: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
    marginRight: spacing.sm,
  },
  activityTarget: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  activityActor: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: spacing.sm,
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
