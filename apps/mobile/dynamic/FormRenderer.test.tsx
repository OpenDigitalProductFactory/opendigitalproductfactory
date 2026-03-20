import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { FormRenderer } from "./FormRenderer";
import type { DynamicFormSchema } from "@dpf/types";

const baseSchema: DynamicFormSchema = {
  formId: "test-form-1",
  title: "Test Form",
  version: 1,
  submitAction: "submit",
  offlineCapable: true,
  fields: [
    { key: "name", type: "text", label: "Name", required: true },
    {
      key: "category",
      type: "select",
      label: "Category",
      options: ["A", "B", "C"],
    },
    {
      key: "priority",
      type: "radio",
      label: "Priority",
      options: ["Low", "Medium", "High"],
    },
    { key: "due_date", type: "date", label: "Due Date" },
    { key: "notes", type: "textarea", label: "Notes", maxLength: 200 },
    { key: "count", type: "number", label: "Count" },
    {
      key: "tags",
      type: "multi-select",
      label: "Tags",
      options: ["urgent", "review", "done"],
    },
    { key: "photo", type: "camera", label: "Photo", maxCount: 3 },
    { key: "sign", type: "signature", label: "Signature" },
    { key: "loc", type: "location", label: "Location" },
    {
      key: "ref",
      type: "lookup",
      label: "Reference",
      source: "/api/v1/refs",
    },
    { key: "active", type: "toggle", label: "Active" },
  ],
};

describe("FormRenderer", () => {
  it("renders a field component for each known field type", () => {
    const { getByText } = render(
      <FormRenderer schema={baseSchema} onSubmit={() => {}} />,
    );

    expect(getByText("Name")).toBeTruthy();
    expect(getByText("Category")).toBeTruthy();
    expect(getByText("Priority")).toBeTruthy();
    expect(getByText("Due Date")).toBeTruthy();
    expect(getByText("Notes")).toBeTruthy();
    expect(getByText("Count")).toBeTruthy();
    expect(getByText("Tags")).toBeTruthy();
    expect(getByText("Photo")).toBeTruthy();
    expect(getByText("Signature")).toBeTruthy();
    expect(getByText("Location")).toBeTruthy();
    expect(getByText("Reference")).toBeTruthy();
    expect(getByText("Active")).toBeTruthy();
  });

  it("renders the Submit button", () => {
    const { getByText } = render(
      <FormRenderer schema={baseSchema} onSubmit={() => {}} />,
    );
    expect(getByText("Submit")).toBeTruthy();
  });

  it("validates required fields and shows errors", async () => {
    const onSubmit = jest.fn();
    const { getByText } = render(
      <FormRenderer schema={baseSchema} onSubmit={onSubmit} />,
    );

    fireEvent.press(getByText("Submit"));

    await waitFor(() => {
      expect(getByText("Name is required")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with values when validation passes", async () => {
    const onSubmit = jest.fn();
    const schema: DynamicFormSchema = {
      ...baseSchema,
      fields: [
        { key: "name", type: "text", label: "Name", required: true },
      ],
    };
    const { getByText, getByTestId } = render(
      <FormRenderer schema={schema} onSubmit={onSubmit} />,
    );

    fireEvent.changeText(getByTestId("field-name"), "Test Value");
    fireEvent.press(getByText("Submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "Test Value" });
    });
  });

  it("gracefully skips unknown field types", () => {
    const schema: DynamicFormSchema = {
      ...baseSchema,
      fields: [
        { key: "x", type: "unknown-type" as any, label: "Unknown" },
        { key: "name", type: "text", label: "Name" },
      ],
    };
    const { getByText, queryByText } = render(
      <FormRenderer schema={schema} onSubmit={() => {}} />,
    );
    expect(getByText("Name")).toBeTruthy();
    expect(queryByText("Unknown")).toBeNull();
  });

  it("shows loading indicator on Submit button when isSubmitting", () => {
    const { getByTestId } = render(
      <FormRenderer
        schema={baseSchema}
        onSubmit={() => {}}
        isSubmitting
      />,
    );
    expect(getByTestId("button-loading")).toBeTruthy();
  });
});
