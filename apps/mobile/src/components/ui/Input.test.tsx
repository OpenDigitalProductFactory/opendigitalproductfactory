import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Input } from "./Input";

describe("Input", () => {
  it("renders with a label", async () => {
    const { getByText } = await render(
      <Input label="Email" value="" onChangeText={() => {}} />,
    );
    expect(getByText("Email")).toBeTruthy();
  });

  it("calls onChangeText when text changes", async () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = await render(
      <Input label="Email" value="" onChangeText={onChangeText} />,
    );
    await fireEvent.changeText(getByLabelText("Email"), "hello@test.com");
    expect(onChangeText).toHaveBeenCalledWith("hello@test.com");
  });

  it("displays error text when error prop is set", async () => {
    const { getByText } = await render(
      <Input
        label="Password"
        value=""
        onChangeText={() => {}}
        error="Required field"
      />,
    );
    expect(getByText("Required field")).toBeTruthy();
  });

  it("renders without label when label is omitted", async () => {
    const { queryByText } = await render(
      <Input value="test" onChangeText={() => {}} placeholder="Enter text" />,
    );
    expect(queryByText("Email")).toBeNull();
  });
});
