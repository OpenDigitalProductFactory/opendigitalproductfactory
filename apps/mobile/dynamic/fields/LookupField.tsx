import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

/**
 * Lookup field stub. Renders as a searchable TextInput.
 * Full implementation will fetch options from definition.source API endpoint.
 */
export function LookupField({
  definition,
  value,
  onChange,
  error,
}: FieldProps) {
  const textValue = value != null ? String(value) : "";

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={textValue}
        onChangeText={(text) => onChange(text)}
        placeholder={`Search ${definition.label.toLowerCase()}...`}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={definition.label}
        testID={`field-${definition.key}`}
      />
      {definition.source ? (
        <Text style={styles.sourceHint}>Source: {definition.source}</Text>
      ) : null}
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
  sourceHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
