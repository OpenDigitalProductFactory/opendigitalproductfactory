import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Button } from "./Button";

describe("Button", () => {
  it("renders the title text", () => {
    const { getByText } = render(
      <Button title="Press me" onPress={() => {}} />,
    );
    expect(getByText("Press me")).toBeTruthy();
  });

  it("calls onPress when pressed", () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button title="Tap" onPress={onPress} />,
    );
    fireEvent.press(getByText("Tap"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not call onPress when disabled", () => {
    const onPress = jest.fn();
    const { getByRole } = render(
      <Button title="Disabled" onPress={onPress} disabled />,
    );
    fireEvent.press(getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows loading indicator when loading", () => {
    const { getByTestId, queryByText } = render(
      <Button title="Loading" onPress={() => {}} loading />,
    );
    expect(getByTestId("button-loading")).toBeTruthy();
    expect(queryByText("Loading")).toBeNull();
  });

  it("renders with secondary variant", () => {
    const { getByText } = render(
      <Button title="Secondary" onPress={() => {}} variant="secondary" />,
    );
    expect(getByText("Secondary")).toBeTruthy();
  });

  it("renders with ghost variant", () => {
    const { getByText } = render(
      <Button title="Ghost" onPress={() => {}} variant="ghost" />,
    );
    expect(getByText("Ghost")).toBeTruthy();
  });
});
