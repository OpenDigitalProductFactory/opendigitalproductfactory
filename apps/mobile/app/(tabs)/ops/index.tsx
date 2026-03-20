import React, { useCallback, useEffect } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  RefreshControl,
  ActivityIndicator,
  View,
} from "react-native";
import { colors, spacing } from "@/src/lib/theme";
import { EpicCard } from "@/src/components/EpicCard";
import { useOpsStore } from "@/src/features/ops/ops.store";
import type { Epic } from "@dpf/types";

export default function OpsScreen() {
  const { epics, isLoading, error, fetchEpics } = useOpsStore();

  const refresh = useCallback(() => {
    return fetchEpics();
  }, [fetchEpics]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <FlatList<Epic>
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={epics}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <EpicCard epic={item} />}
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
          <Text style={styles.heading}>Epics</Text>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !isLoading ? (
          <Text style={styles.emptyText}>No epics found</Text>
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
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
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
