import React from "react";
import { ScrollView, Text, ActivityIndicator, StyleSheet } from "react-native";
import type { DynamicViewSchema } from "@dpf/types";
import { colors, spacing } from "@/src/lib/theme";
import { widgetRegistry, type WidgetProps } from "./widgets";

interface ViewRendererProps {
  schema: DynamicViewSchema;
  data: Record<string, unknown>;
  isLoading?: boolean;
}

export function ViewRenderer({
  schema,
  data,
  isLoading,
}: ViewRendererProps) {
  if (isLoading) {
    return (
      <ActivityIndicator
        size="large"
        color={colors.primary}
        style={styles.loader}
        testID="view-loading"
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="view-renderer"
    >
      <Text style={styles.title}>{schema.title}</Text>
      {schema.layout.map((widget, index) => {
        const Component = widgetRegistry[widget.widget] as
          | React.ComponentType<WidgetProps>
          | undefined;
        if (!Component) return null;
        return <Component key={index} definition={widget} data={data} />;
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
