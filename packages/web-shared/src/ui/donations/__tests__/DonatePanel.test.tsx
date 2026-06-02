import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DonatePanel } from "../DonatePanel";

const defaultProps = {
  campaignId: "camp-1",
  defaultCurrency: "usd",
  action: "/donate",
};

function getAmountInput() {
  return screen.getByTestId("amount-input") as HTMLInputElement;
}
function getCadenceInput() {
  return screen.getByTestId("cadence-input") as HTMLInputElement;
}
function getContinueBtn() {
  return screen.getByRole("button", { name: /continue to donate/i });
}
function getCustomInput() {
  return screen.getByLabelText(/custom amount/i) as HTMLInputElement;
}

describe("DonatePanel", () => {
  it("clicking Monthly cadence then $25 chip sets hidden inputs correctly", () => {
    render(<DonatePanel {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /^monthly$/i }));
    expect(getCadenceInput().value).toBe("MONTHLY");

    fireEvent.click(screen.getByRole("button", { name: /^\$25$/ }));
    expect(getAmountInput().value).toBe("2500");
  });

  it("typing 37 into custom amount clears the $25 chip and sets amount to 3700", () => {
    render(<DonatePanel {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /^\$25$/ }));
    expect(screen.getByRole("button", { name: /^\$25$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(getCustomInput(), { target: { value: "37" } });

    expect(screen.getByRole("button", { name: /^\$25$/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(getAmountInput().value).toBe("3700");
  });

  it("typing 37 then clicking $50 clears the custom input and sets amount to 5000", () => {
    render(<DonatePanel {...defaultProps} />);

    fireEvent.change(getCustomInput(), { target: { value: "37" } });
    expect(getAmountInput().value).toBe("3700");

    fireEvent.click(screen.getByRole("button", { name: /^\$50$/ }));
    expect(getAmountInput().value).toBe("5000");
    expect(getCustomInput().value).toBe("");
  });

  it("Continue button is disabled when no amount has been selected", () => {
    render(<DonatePanel {...defaultProps} />);
    expect(getContinueBtn()).toBeDisabled();
  });

  it("Continue button is disabled when custom amount is under $1", () => {
    render(<DonatePanel {...defaultProps} />);
    fireEvent.change(getCustomInput(), { target: { value: "0.50" } });
    expect(getContinueBtn()).toBeDisabled();
    expect(getAmountInput().value).toBe("");
  });

  it("renders a polite live region when disabled and disabledReason are provided", () => {
    render(
      <DonatePanel
        {...defaultProps}
        disabled
        disabledReason="Campaign has ended"
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Campaign has ended");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("Continue button is enabled after selecting a valid chip amount", () => {
    render(<DonatePanel {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^\$10$/ }));
    expect(getContinueBtn()).not.toBeDisabled();
  });

  it("all amount chips start with aria-pressed=false", () => {
    render(<DonatePanel {...defaultProps} />);
    for (const label of ["$10", "$25", "$50", "$100"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^\\${label}$`) }),
      ).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("cadence selector group has an accessible name", () => {
    render(<DonatePanel {...defaultProps} />);
    expect(
      screen.getByRole("group", { name: /donation frequency/i }),
    ).toBeInTheDocument();
  });

  it("amount selector group has an accessible name", () => {
    render(<DonatePanel {...defaultProps} />);
    expect(
      screen.getByRole("group", { name: /donation amount/i }),
    ).toBeInTheDocument();
  });

  it("does not emit a campaignSlug hidden input", () => {
    const { container } = render(<DonatePanel {...defaultProps} />);
    expect(container.querySelector('input[name="campaignSlug"]')).toBeNull();
  });

  it("cent-safe parsing: 1.005 is rejected (donor would otherwise underpay)", () => {
    render(<DonatePanel {...defaultProps} />);
    fireEvent.change(getCustomInput(), { target: { value: "1.005" } });
    expect(getAmountInput().value).toBe("");
    expect(getContinueBtn()).toBeDisabled();
  });

  it("cent-safe parsing: 25.5 -> 2550 cents, 25.05 -> 2505 cents", () => {
    render(<DonatePanel {...defaultProps} />);
    fireEvent.change(getCustomInput(), { target: { value: "25.5" } });
    expect(getAmountInput().value).toBe("2550");
    fireEvent.change(getCustomInput(), { target: { value: "25.05" } });
    expect(getAmountInput().value).toBe("2505");
  });

  it("rejects pasted '$25' / non-numeric prefixes from the custom input", () => {
    render(<DonatePanel {...defaultProps} />);
    fireEvent.change(getCustomInput(), { target: { value: "$25" } });
    expect(getAmountInput().value).toBe("");
    expect(getContinueBtn()).toBeDisabled();
  });

  it("rejects scientific notation (1e3) — wins the principle of least surprise", () => {
    render(<DonatePanel {...defaultProps} />);
    fireEvent.change(getCustomInput(), { target: { value: "1e3" } });
    expect(getAmountInput().value).toBe("");
  });

  it("non-finite defaultAmountCents (NaN) is sanitized to undefined; submit stays disabled", () => {
    render(<DonatePanel {...defaultProps} defaultAmountCents={NaN} />);
    expect(getAmountInput().value).toBe("");
    expect(getContinueBtn()).toBeDisabled();
  });

  it("fractional defaultAmountCents (2500.5) is sanitized to undefined", () => {
    render(<DonatePanel {...defaultProps} defaultAmountCents={2500.5} />);
    expect(getAmountInput().value).toBe("");
    expect(getContinueBtn()).toBeDisabled();
  });

  it("sub-minimum defaultAmountCents (50) is sanitized to undefined", () => {
    render(<DonatePanel {...defaultProps} defaultAmountCents={50} />);
    expect(getAmountInput().value).toBe("");
    expect(getContinueBtn()).toBeDisabled();
  });

  it("out-of-safe-range defaultAmountCents (1e300) is sanitized to undefined", () => {
    render(<DonatePanel {...defaultProps} defaultAmountCents={1e300} />);
    expect(getAmountInput().value).toBe("");
    expect(getContinueBtn()).toBeDisabled();
  });

  it("valid defaultAmountCents (5000) selects the matching chip", () => {
    render(<DonatePanel {...defaultProps} defaultAmountCents={5000} />);
    expect(getAmountInput().value).toBe("5000");
    expect(screen.getByRole("button", { name: /^\$50$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("empty defaultCurrency falls back to '$' on chip labels", () => {
    render(<DonatePanel {...defaultProps} defaultCurrency="" />);
    for (const label of ["$10", "$25", "$50", "$100"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^\\${label}$`) }),
      ).toBeInTheDocument();
    }
  });

  it("non-USD defaultCurrency formats chips as '<CODE> <dollars>'", () => {
    render(<DonatePanel {...defaultProps} defaultCurrency="eur" />);
    expect(
      screen.getByRole("button", { name: /^EUR 25$/ }),
    ).toBeInTheDocument();
  });

  it("disabled panel disables cadence buttons and amount chips too", () => {
    render(<DonatePanel {...defaultProps} disabled disabledReason="closed" />);
    // The disabled fieldset propagates to descendant buttons via :disabled
    expect(
      screen.getByRole("button", { name: /^monthly$/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /^\$25$/ })).toBeDisabled();
    expect(getCustomInput()).toBeDisabled();
    expect(getContinueBtn()).toBeDisabled();
  });
});
