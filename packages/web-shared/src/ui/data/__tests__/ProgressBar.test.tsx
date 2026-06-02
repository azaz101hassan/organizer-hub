import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "../ProgressBar";

describe("ProgressBar", () => {
  it("renders raised/target width clamped to 100%", () => {
    render(<ProgressBar valueCents={7500} targetCents={5000} label="t" />);
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "100%" });
  });

  it("handles target = 0 without NaN", () => {
    render(<ProgressBar valueCents={0} targetCents={0} label="t" />);
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "0%" });
  });

  it("computes 30% for 3000/10000", () => {
    render(<ProgressBar valueCents={3000} targetCents={10000} label="t" />);
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "30%" });
  });

  it("clamps a negative raised value to 0%", () => {
    render(<ProgressBar valueCents={-500} targetCents={1000} label="t" />);
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "0%" });
  });

  it("exposes a progressbar role with aria values", () => {
    render(<ProgressBar valueCents={2500} targetCents={10000} label="Camp progress" />);
    const bar = screen.getByRole("progressbar", { name: "Camp progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("non-finite valueCents (NaN) is coerced to 0%, not NaN%", () => {
    render(<ProgressBar valueCents={NaN} targetCents={1000} label="t" />);
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "0%" });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("non-finite targetCents (Infinity) is coerced to 0%, not NaN%", () => {
    render(
      <ProgressBar valueCents={1000} targetCents={Infinity} label="t" />,
    );
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "0%" });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("non-finite both inputs land at 0% without NaN leaking into aria", () => {
    render(<ProgressBar valueCents={NaN} targetCents={NaN} label="t" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).not.toBe("NaN");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });
});
