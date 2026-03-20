import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { api } from "@/src/lib/apiClient";
import type { DynamicFormSchema, DynamicViewSchema } from "@dpf/types";

interface MenuItemProps {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

function MenuItem({ title, icon, onPress }: MenuItemProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={styles.menuText}>{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const [dynamicForms, setDynamicForms] = useState<DynamicFormSchema[]>([]);
  const [dynamicViews, setDynamicViews] = useState<DynamicViewSchema[]>([]);

  useEffect(() => {
    api.dynamic
      .listForms()
      .then((r) => setDynamicForms(r.data))
      .catch(() => {});
    api.dynamic
      .listViews()
      .then((r) => setDynamicViews(r.data))
      .catch(() => {});
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>More</Text>
      <MenuItem
        title="Approvals"
        icon="checkmark-circle-outline"
        onPress={() => router.push("/more/approvals")}
      />
      <MenuItem
        title="Compliance"
        icon="shield-checkmark-outline"
        onPress={() => router.push("/more/compliance")}
      />
      <MenuItem
        title="Notifications"
        icon="notifications-outline"
        onPress={() => router.push("/more/notifications")}
      />
      <MenuItem
        title="Profile"
        icon="person-outline"
        onPress={() => router.push("/more/profile")}
      />
      {dynamicForms.length > 0 || dynamicViews.length > 0 ? (
        <View style={styles.dynamicSection}>
          <Text style={styles.dynamicHeading}>Custom Content</Text>
          {dynamicForms.map((form) => (
            <MenuItem
              key={form.formId}
              title={form.title}
              icon="document-text-outline"
              onPress={() => {}}
            />
          ))}
          {dynamicViews.map((view) => (
            <MenuItem
              key={view.viewId}
              title={view.title}
              icon="bar-chart-outline"
              onPress={() => {}}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface1,
    paddingTop: spacing.md,
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuText: {
    color: colors.text,
    fontSize: 16,
    flex: 1,
    marginLeft: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  dynamicSection: {
    marginTop: spacing.md,
  },
  dynamicHeading: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
