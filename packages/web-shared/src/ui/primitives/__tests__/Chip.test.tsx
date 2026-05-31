import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "../Chip";

describe("Chip", () => {
  it("renders children", () => {
    render(<Chip>Music</Chip>);
    expect(screen.getByText("Music")).toBeInTheDocument();
  });
  it("applies active state classes when active", () => {
    render(<Chip active>All</Chip>);
    expect(screen.getByText("All")).toHaveClass("chip", "chip--active");
  });
  it("is a button when onClick is provided, a span otherwise", () => {
    const { rerender } = render(<Chip>Static</Chip>);
    expect(screen.getByText("Static").tagName).toBe("SPAN");
    rerender(<Chip onClick={() => {}}>Clickable</Chip>);
    expect(screen.getByText("Clickable").tagName).toBe("BUTTON");
  });
});
