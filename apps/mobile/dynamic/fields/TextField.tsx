import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { colors, spacing, borderRadius } from "@/src/lib/theme";
import type { FieldProps } from "./index";

export function TextField({ definition, value, onChange, error }: FieldProps) {
  const isMultiline = definition.type === "textarea";
  const isNumeric = definition.type === "number";
  const textValue = value != null ? String(value) : "";

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{definition.label}</Text>
      <TextInput
        style={[
          styles.input,
          isMultiline && styles.multiline,
          error ? styles.inputError : null,
        ]}
        value={textValue}
        onChangeText={(text) => {
          if (isNumeric) {
            const num = text === "" ? "" : Number(text);
            onChange(num);
          } else {
            onChange(text);
          }
        }}
        placeholder={`Enter ${definition.label.toLowerCase()}`}
        placeholderTextColor={colors.textMuted}
        keyboardType={isNumeric ? "numeric" : "default"}
        multiline={isMultiline}
        numberOfLines={isMultiline ? 4 : 1}
        maxLength={definition.maxLength}
        accessibilityLabel={definition.label}
        testID={`field-${definition.key}`}
      />
      {definition.maxLength ? (
        <Text style={styles.counter}>
          {textValue.length}/{definition.maxLength}
        </Text>
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
  multiline: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  inputError: {
    borderColor: colors.error,
  },
  counter: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "right",
    marginTop: spacing.xs,
  },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
