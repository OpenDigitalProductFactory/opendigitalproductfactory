import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

/**
 * Signature field placeholder. Shows a bordered area with "Tap to sign" text.
 * Full implementation will use a drawing canvas library.
 */
export function SignatureField({
  definition,
  value,
  onChange,
  error,
}: FieldProps) {
  const hasSigned = Boolean(value);

  function handleTap() {
    // Stub: mark as signed with a placeholder value
    onChange("signature_placeholder");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      <Pressable
        style={[styles.canvas, error ? styles.canvasError : null]}
        onPress={handleTap}
        accessibilityRole="button"
        accessibilityLabel={`Sign ${definition.label}`}
        testID={`field-${definition.key}`}
      >
        <Text style={styles.canvasText}>
          {hasSigned ? "Signed" : "Tap to sign"}
        </Text>
      </Pressable>
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
  canvas: {
    height: 120,
    backgroundColor: colors.surface1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  canvasError: {
    borderColor: colors.error,
  },
  canvasText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
