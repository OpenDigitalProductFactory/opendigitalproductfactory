/**
 * SpaceSwitcher — picker for the multi-business ("Town") connection set.
 *
 * Shows the active space label as a press target; tap opens a modal with
 * every connected business (active first, then most-recently-used) plus
 * a "Connect another business" entry that routes to /connect. Switching
 * a space updates the registry; the rest of the app re-reads from the
 * spaces store on next mount.
 *
 * Compact (header-style) and full (More-tab section) variants share one
 * component so the visual stays consistent across surfaces.
 */
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useSpacesStore } from "@/src/stores/spaces";
import {
  orderSpacesForSwitcher,
  type SpaceDisplayRow,
} from "./spaceDisplay";

export interface SpaceSwitcherProps {
  /** Compact: a thin pill (use in headers); Full: a card with help text. */
  variant?: "compact" | "full";
  /** Override the connect destination (defaults to /connect). */
  connectHref?: string;
}

export function SpaceSwitcher({
  variant = "full",
  connectHref = "/connect",
}: SpaceSwitcherProps): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const spaces = useSpacesStore((s) => s.spaces);
  const activeSpaceId = useSpacesStore((s) => s.activeSpaceId);
  const switchSpace = useSpacesStore((s) => s.switchSpace);
  const removeSpace = useSpacesStore((s) => s.removeSpace);

  const rows = useMemo(
    () => orderSpacesForSwitcher({ spaces, activeSpaceId }),
    [spaces, activeSpaceId],
  );
  const active = rows.find((r) => r.isActive) ?? null;

  const onPick = (row: SpaceDisplayRow): void => {
    if (!row.isActive) switchSpace(row.spaceId);
    setOpen(false);
  };

  const onConnect = (): void => {
    setOpen(false);
    router.push(connectHref);
  };

  return (
    <View>
      <Pressable
        style={variant === "compact" ? styles.triggerCompact : styles.triggerFull}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch business"
        testID="space-switcher-trigger"
      >
        <View style={{ flex: 1 }}>
          {variant === "full" ? (
            <Text style={styles.label}>Current business</Text>
          ) : null}
          <Text style={styles.activeName}>
            {active?.label ?? "No business connected"}
          </Text>
          {variant === "full" && active ? (
            <Text style={styles.activeMeta}>{active.url}</Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Businesses</Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID="space-switcher-close"
              >
                <Text style={styles.modalClose}>Close</Text>
              </Pressable>
            </View>

            <FlatList
              data={rows}
              keyExtractor={(r) => r.spaceId}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.row, item.isActive && styles.rowActive]}
                  onPress={() => onPick(item)}
                  onLongPress={() => removeSpace(item.spaceId)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.isActive }}
                  testID={`space-row-${item.spaceId}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.label}</Text>
                    <Text style={styles.rowMeta}>{item.url}</Text>
                  </View>
                  {item.isActive ? (
                    <Text style={styles.rowActiveTag}>active</Text>
                  ) : null}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  You haven't connected any business yet.
                </Text>
              }
            />

            <Pressable
              style={styles.connectBtn}
              onPress={onConnect}
              accessibilityRole="button"
              testID="space-switcher-connect"
            >
              <Text style={styles.connectBtnText}>+ Connect another business</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    triggerFull: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
    },
    triggerCompact: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm - 2,
    },
    label: {
      color: colors.textMuted,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    activeName: { color: colors.text, fontSize: 15, fontWeight: "700" },
    activeMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    chevron: { color: colors.textMuted, fontSize: 18, marginLeft: spacing.sm },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    modalCard: {
      backgroundColor: colors.surface1,
      borderTopLeftRadius: borderRadius.lg,
      borderTopRightRadius: borderRadius.lg,
      padding: spacing.md,
      maxHeight: "75%",
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.sm,
    },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
    modalClose: { color: colors.primary, fontSize: 14, fontWeight: "600" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginVertical: spacing.xs,
    },
    rowActive: { borderColor: colors.primary },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
    rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowActiveTag: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    empty: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: "center",
      marginVertical: spacing.lg,
    },
    connectBtn: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    connectBtnText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  });
}
