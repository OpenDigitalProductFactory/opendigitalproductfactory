import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Input } from "./Input";

describe("Input", () => {
  it("renders with a label", () => {
    const { getByText } = render(
      <Input label="Email" value="" onChangeText={() => {}} />,
    );
    expect(getByText("Email")).toBeTruthy();
  });

  it("calls onChangeText when text changes", () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = render(
      <Input label="Email" value="" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByLabelText("Email"), "hello@test.com");
    expect(onChangeText).toHaveBeenCalledWith("hello@test.com");
  });

  it("displays error text when error prop is set", () => {
    const { getByText } = render(
      <Input
        label="Password"
        value=""
        onChangeText={() => {}}
        error="Required field"
      />,
    );
    expect(getByText("Required field")).toBeTruthy();
  });

  it("renders without label when label is omitted", () => {
    const { queryByText } = render(
      <Input value="test" onChangeText={() => {}} placeholder="Enter text" />,
    );
    expect(queryByText("Email")).toBeNull();
  });
});
