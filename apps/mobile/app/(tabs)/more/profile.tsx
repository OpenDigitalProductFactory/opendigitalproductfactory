import React from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import { Card } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { useAuthStore } from "@/src/features/auth/auth.store";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login" as any);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Profile</Text>

      <Card style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email ?? "—"}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Platform Role</Text>
          <Text style={styles.value}>{user?.platformRole ?? "—"}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>User ID</Text>
          <Text style={styles.valueMono}>{user?.id ?? "—"}</Text>
        </View>
      </Card>

      <View style={styles.logoutContainer}>
        <Button title="Logout" onPress={handleLogout} variant="secondary" />
      </View>
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
  card: {
    marginHorizontal: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  value: {
    color: colors.text,
    fontSize: 16,
  },
  valueMono: {
    color: colors.text,
    fontSize: 14,
    fontFamily: "monospace",
  },
  logoutContainer: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
});
