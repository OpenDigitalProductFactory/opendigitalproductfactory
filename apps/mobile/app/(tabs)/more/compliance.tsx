import React, { useCallback, useEffect } from "react";
import {
  FlatList,
  SectionList,
  StyleSheet,
  Text,
  RefreshControl,
  ActivityIndicator,
  View,
} from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { useComplianceStore } from "@/src/features/compliance/compliance.store";

export default function ComplianceScreen() {
  const { alerts, incidents, isLoading, error, fetchAlerts, fetchIncidents } =
    useComplianceStore();

  const refresh = useCallback(async () => {
    await Promise.all([fetchAlerts(), fetchIncidents()]);
  }, [fetchAlerts, fetchIncidents]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sections = [
    { title: "Alerts", data: alerts },
    { title: "Incidents", data: incidents },
  ];

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item, index) =>
        (item as Record<string, unknown>).id
          ? String((item as Record<string, unknown>).id)
          : String(index)
      }
      renderItem={({ item }) => {
        const rec = item as Record<string, unknown>;
        return (
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {String(rec.title ?? rec.id ?? "Unknown")}
              </Text>
              {rec.severity ? (
                <Text
                  style={[
                    styles.severity,
                    rec.severity === "critical" && styles.severityCritical,
                    rec.severity === "high" && styles.severityHigh,
                  ]}
                >
                  {String(rec.severity)}
                </Text>
              ) : null}
            </View>
            {rec.status ? (
              <Text style={styles.status}>
                Status: {String(rec.status)}
              </Text>
            ) : null}
            {rec.createdAt ? (
              <Text style={styles.date}>
                {new Date(String(rec.createdAt)).toLocaleDateString()}
              </Text>
            ) : null}
          </Card>
        );
      }}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeading}>{section.title}</Text>
      )}
      renderSectionFooter={({ section }) =>
        section.data.length === 0 && !isLoading ? (
          <Text style={styles.emptyText}>No {section.title.toLowerCase()}</Text>
        ) : null
      }
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
          <Text style={styles.heading}>Compliance</Text>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        isLoading ? (
          <ActivityIndicator
            size="large"
            color={colors.primary}
            style={styles.loader}
          />
        ) : null
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
  sectionHeading: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  severity: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  severityCritical: {
    color: colors.error,
  },
  severityHigh: {
    color: colors.error,
  },
  status: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
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
    marginTop: spacing.md,
  },
  loader: {
    marginTop: spacing.xl,
  },
});
