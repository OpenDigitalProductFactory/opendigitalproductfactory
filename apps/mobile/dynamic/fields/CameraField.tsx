import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

/**
 * Camera field stub. Shows a "Take Photo" button and lists placeholder thumbnails.
 * Full implementation will integrate expo-image-picker or expo-camera.
 */
export function CameraField({ definition, value, onChange, error }: FieldProps) {
  const photos = Array.isArray(value) ? (value as string[]) : [];
  const maxCount = definition.maxCount ?? 5;
  const canAdd = photos.length < maxCount;

  function handleTakePhoto() {
    const placeholder = `photo_${Date.now()}.jpg`;
    onChange([...photos, placeholder]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      <View style={styles.photoRow}>
        {photos.map((photo, i) => (
          <View key={i} style={styles.thumbnail}>
            <Text style={styles.thumbnailText}>{i + 1}</Text>
          </View>
        ))}
      </View>
      {canAdd ? (
        <Pressable
          style={styles.button}
          onPress={handleTakePhoto}
          accessibilityRole="button"
          accessibilityLabel="Take Photo"
          testID={`field-${definition.key}`}
        >
          <Text style={styles.buttonText}>Take Photo</Text>
        </Pressable>
      ) : (
        <Text style={styles.limitText}>
          Maximum {maxCount} photos reached
        </Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
    marginBottom: spacing.xs,
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  thumbnail: {
    width: 60,
    height: 60,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbnailText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  button: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: "center",
  },
  buttonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  limitText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
