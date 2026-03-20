import React from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { Card } from "@/src/components/ui/Card";
import { colors, spacing } from "@/src/lib/theme";
import type { WidgetProps } from "./index";

/**
 * Table-like list view. Renders column headers and data rows
 * from the widget definition's columns and data key.
 */
export function ListView({ definition, data }: WidgetProps) {
  const raw = data[definition.dataKey];
  const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];
  const columns = definition.columns ?? [];

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{definition.label}</Text>
      {/* Header row */}
      <View style={styles.headerRow}>
        {columns.map((col) => (
          <Text key={col} style={styles.headerCell}>
            {col}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No data</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={styles.dataRow}>
              {columns.map((col) => (
                <Text key={col} style={styles.dataCell}>
                  {item[col] != null ? String(item[col]) : "--"}
                </Text>
              ))}
            </View>
          )}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
    marginBottom: spacing.xs,
  },
  headerCell: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  dataRow: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + "44",
  },
  dataCell: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    padding: spacing.md,
  },
});
