import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../Badge";

describe("Badge", () => {
  it("applies tone class", () => {
    render(<Badge tone="owner">Owner</Badge>);
    expect(screen.getByText("Owner")).toHaveClass("badge", "badge--owner");
  });
  it("defaults to member tone", () => {
    render(<Badge>Plain</Badge>);
    expect(screen.getByText("Plain")).toHaveClass("badge--member");
  });
});
