import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

/**
 * Date field using a TextInput with YYYY-MM-DD format validation.
 * A native date picker integration can replace this later.
 */
export function DateField({ definition, value, onChange, error }: FieldProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const textValue = value != null ? String(value) : "";

  function handleChange(text: string) {
    onChange(text);
    if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      setLocalError("Use YYYY-MM-DD format");
    } else {
      setLocalError(null);
    }
  }

  const displayError = error || localError;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      <TextInput
        style={[styles.input, displayError ? styles.inputError : null]}
        value={textValue}
        onChangeText={handleChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={definition.label}
        testID={`field-${definition.key}`}
      />
      {displayError ? (
        <Text style={styles.error}>{displayError}</Text>
      ) : null}
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
  input: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  inputError: {
    borderColor: colors.error,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
