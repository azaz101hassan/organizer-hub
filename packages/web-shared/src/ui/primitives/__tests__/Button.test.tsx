import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../Button";

describe("Button", () => {
  it("renders text content", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });
  it("applies primary variant class by default", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn", "btn--primary");
  });
  it("applies the requested variant", () => {
    render(<Button variant="ghost">Cancel</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn", "btn--ghost");
  });
  it("applies block prop", () => {
    render(<Button block>Wide</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn--block");
  });
  it("forwards disabled state", () => {
    render(<Button disabled>Off</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
