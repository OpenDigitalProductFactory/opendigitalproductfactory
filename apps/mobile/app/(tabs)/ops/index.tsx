import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  RefreshControl,
  ActivityIndicator,
  View,
  Pressable,
} from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { EpicCard } from "@/src/components/EpicCard";
import { useOpsStore } from "@/src/features/ops/ops.store";
import { api } from "@/src/lib/apiClient";
import type { Epic, DynamicFormSchema } from "@dpf/types";

export default function OpsScreen() {
  const { epics, isLoading, error, fetchEpics } = useOpsStore();
  const [dynamicForms, setDynamicForms] = useState<DynamicFormSchema[]>([]);

  const refresh = useCallback(() => {
    return fetchEpics();
  }, [fetchEpics]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    api.dynamic
      .listForms()
      .then((r) => setDynamicForms(r.data))
      .catch(() => {});
  }, []);

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
          {dynamicForms.length > 0 ? (
            <View style={styles.dynamicSection}>
              <Text style={styles.dynamicHeading}>Forms</Text>
              {dynamicForms.map((form) => (
                <Pressable
                  key={form.formId}
                  style={styles.dynamicItem}
                  accessibilityRole="button"
                >
                  <Text style={styles.dynamicItemText}>{form.title}</Text>
                </Pressable>
              ))}
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
  dynamicSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  dynamicHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  dynamicItem: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  dynamicItemText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "500",
  },
});
