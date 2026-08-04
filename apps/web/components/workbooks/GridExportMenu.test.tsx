// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GridExportMenu } from "./GridExportMenu";

afterEach(() => cleanup());

describe("GridExportMenu", () => {
  it("hides the format choices until the Export button is clicked", () => {
    render(<GridExportMenu onExportCsv={vi.fn()} onExportXlsx={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByText("Export"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText(/CSV \(\.csv\)/)).toBeTruthy();
    expect(screen.getByText(/Excel \(\.xlsx\)/)).toBeTruthy();
  });

  it("invokes the CSV handler and closes the menu", () => {
    const onExportCsv = vi.fn();
    const onExportXlsx = vi.fn();
    render(<GridExportMenu onExportCsv={onExportCsv} onExportXlsx={onExportXlsx} />);
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByText(/CSV \(\.csv\)/));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
    expect(onExportXlsx).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("invokes the Excel handler and closes the menu", () => {
    const onExportCsv = vi.fn();
    const onExportXlsx = vi.fn();
    render(<GridExportMenu onExportCsv={onExportCsv} onExportXlsx={onExportXlsx} />);
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByText(/Excel \(\.xlsx\)/));
    expect(onExportXlsx).toHaveBeenCalledTimes(1);
    expect(onExportCsv).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open when disabled", () => {
    render(<GridExportMenu disabled onExportCsv={vi.fn()} onExportXlsx={vi.fn()} />);
    fireEvent.click(screen.getByText("Export"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
