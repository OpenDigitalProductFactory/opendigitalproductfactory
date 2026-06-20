/**
 * Field-tech "Capture work done" screen.
 *
 * Reachable from the job detail screen between in-progress / completed and
 * the Draft invoice step. Lets the tech take one or more photos of the
 * finished work — each uploads to /api/v1/upload, the fileId appends to
 * WorkItem.evidence via /api/v1/work-items/:itemId/evidence, and the
 * running list updates in place. The Continue button hops to the existing
 * Draft invoice screen with the resolved work item.
 *
 * The actual image capture goes through a swap-in source (today: a stub
 * that returns a deterministic placeholder so the upload pipeline still
 * exercises the real path; tomorrow: expo-image-picker / expo-camera).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useJobEvidenceStore } from "@/src/features/job-evidence/job-evidence.store";

export default function CompleteJobScreen(): React.JSX.Element {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme.colors]);
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();

  const { evidence, isCapturing, error, begin, capturePhoto } =
    useJobEvidenceStore();
  const [caption, setCaption] = useState<string>("");

  useEffect(() => {
    if (itemId) begin(itemId);
  }, [itemId, begin]);

  const onCapture = async (): Promise<void> => {
    const photo = await capturePhoto(caption || undefined);
    if (photo) setCaption("");
  };

  const onContinue = (): void => {
    router.replace(`/jobs/${encodeURIComponent(itemId)}/invoice`);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>Capture work done</Text>
      <Text style={styles.help}>
        Photos persist to the job's evidence record and can be attached to the
        customer's invoice. Capture as many as you need before continuing.
      </Text>

      <Text style={styles.label}>Caption (optional)</Text>
      <TextInput
        value={caption}
        onChangeText={setCaption}
        style={styles.input}
        placeholder="e.g. before, after, model sticker"
        placeholderTextColor={theme.colors.textMuted}
        testID="evidence-caption"
      />

      <Pressable
        style={[styles.primary, isCapturing && styles.disabled]}
        disabled={isCapturing}
        onPress={onCapture}
        accessibilityRole="button"
        testID="evidence-capture"
      >
        {isCapturing ? (
          <ActivityIndicator color={theme.colors.white} />
        ) : (
          <Text style={styles.primaryText}>Add photo</Text>
        )}
      </Pressable>

      {error ? (
        <Text style={styles.error} testID="evidence-error">
          {error}
        </Text>
      ) : null}

      <Text style={[styles.h2, { marginTop: theme.spacing.lg }]}>
        Captured ({evidence.photos.length})
      </Text>
      {evidence.photos.length === 0 ? (
        <Text style={styles.empty}>No photos yet.</Text>
      ) : (
        evidence.photos.map((p, i) => (
          <View key={p.fileId} style={styles.row} testID={`photo-${i}`}>
            <View style={styles.thumbnail}>
              <Text style={styles.thumbnailText}>#{i + 1}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {p.caption ?? "Untitled photo"}
              </Text>
              <Text style={styles.rowMeta}>
                {new Date(p.capturedAt).toLocaleString()}
              </Text>
            </View>
          </View>
        ))
      )}

      <Pressable
        style={styles.secondary}
        onPress={onContinue}
        accessibilityRole="button"
        testID="evidence-continue"
      >
        <Text style={styles.secondaryText}>Continue to invoice</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles({ colors, spacing, borderRadius }: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface1 },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    h1: { color: colors.text, fontSize: 22, fontWeight: "700" },
    h2: { color: colors.text, fontSize: 16, fontWeight: "700" },
    help: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      textTransform: "uppercase",
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: colors.surface2,
      color: colors.text,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      fontSize: 15,
    },
    primary: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    disabled: { opacity: 0.6 },
    primaryText: { color: colors.white, fontSize: 16, fontWeight: "600" },
    secondary: {
      marginTop: spacing.lg,
      borderColor: colors.primary,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm + 4,
      alignItems: "center",
    },
    secondaryText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
    empty: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
    error: { color: colors.error, marginTop: spacing.sm, fontSize: 13 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface2,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    thumbnail: {
      width: 48,
      height: 48,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    thumbnailText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
    rowText: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
    rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  });
}
