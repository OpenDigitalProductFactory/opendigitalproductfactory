import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Button } from "./Button";

describe("Button", () => {
  it("renders the title text", async () => {
    const { getByText } = await render(
      <Button title="Press me" onPress={() => {}} />,
    );
    expect(getByText("Press me")).toBeTruthy();
  });

  it("calls onPress when pressed", async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <Button title="Tap" onPress={onPress} />,
    );
    await fireEvent.press(getByText("Tap"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not call onPress when disabled", async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Button title="Disabled" onPress={onPress} disabled />,
    );
    await fireEvent.press(getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows loading indicator when loading", async () => {
    const { getByTestId, queryByText } = await render(
      <Button title="Loading" onPress={() => {}} loading />,
    );
    expect(getByTestId("button-loading")).toBeTruthy();
    expect(queryByText("Loading")).toBeNull();
  });

  it("renders with secondary variant", async () => {
    const { getByText } = await render(
      <Button title="Secondary" onPress={() => {}} variant="secondary" />,
    );
    expect(getByText("Secondary")).toBeTruthy();
  });

  it("renders with ghost variant", async () => {
    const { getByText } = await render(
      <Button title="Ghost" onPress={() => {}} variant="ghost" />,
    );
    expect(getByText("Ghost")).toBeTruthy();
  });
});
