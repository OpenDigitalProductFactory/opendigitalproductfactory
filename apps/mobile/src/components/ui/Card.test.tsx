import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children", async () => {
    const { getByText } = await render(
      <Card>
        <Text>Card content</Text>
      </Card>,
    );
    expect(getByText("Card content")).toBeTruthy();
  });

  it("accepts custom style", async () => {
    const { toJSON } = await render(
      <Card style={{ marginTop: 10 }}>
        <Text>Styled</Text>
      </Card>,
    );
    expect(toJSON()).toBeTruthy();
  });
});
