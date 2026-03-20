import React, { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import type { DynamicFormSchema } from "@dpf/types";
import { Button } from "@/src/components/ui/Button";
import { colors, spacing } from "@/src/lib/theme";
import { fieldRegistry, type FieldProps } from "./fields";

interface FormRendererProps {
  schema: DynamicFormSchema;
  onSubmit: (values: Record<string, unknown>) => void;
  isSubmitting?: boolean;
}

export function FormRenderer({
  schema,
  onSubmit,
  isSubmitting,
}: FormRendererProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    for (const field of schema.fields) {
      if (field.required && !values[field.key]) {
        newErrors[field.key] = `${field.label} is required`;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit() {
    if (validate()) {
      onSubmit(values);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="form-renderer"
    >
      {schema.fields.map((field) => {
        const Component = fieldRegistry[field.type] as
          | React.ComponentType<FieldProps>
          | undefined;
        if (!Component) return null;
        return (
          <Component
            key={field.key}
            definition={field}
            value={values[field.key]}
            onChange={(val) =>
              setValues((prev) => ({ ...prev, [field.key]: val }))
            }
            error={errors[field.key]}
          />
        );
      })}
      <Button
        title="Submit"
        onPress={handleSubmit}
        loading={isSubmitting}
      />
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
});
