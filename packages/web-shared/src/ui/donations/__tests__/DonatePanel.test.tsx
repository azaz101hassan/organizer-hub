import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DonatePanel } from "../DonatePanel";

const defaultProps = {
  campaignId: "camp-1",
  campaignSlug: "my-campaign",
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

    // First select $25
    fireEvent.click(screen.getByRole("button", { name: /^\$25$/ }));
    expect(screen.getByRole("button", { name: /^\$25$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Type custom amount
    fireEvent.change(screen.getByLabelText(/custom amount/i), {
      target: { value: "37" },
    });

    expect(screen.getByRole("button", { name: /^\$25$/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(getAmountInput().value).toBe("3700");
  });

  it("typing 37 then clicking $50 clears the custom input and sets amount to 5000", () => {
    render(<DonatePanel {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/custom amount/i), {
      target: { value: "37" },
    });
    expect(getAmountInput().value).toBe("3700");

    fireEvent.click(screen.getByRole("button", { name: /^\$50$/ }));
    expect(getAmountInput().value).toBe("5000");

    // Custom input should be cleared
    const customInput = screen.getByLabelText(/custom amount/i) as HTMLInputElement;
    expect(customInput.value).toBe("");
  });

  it("Continue button is disabled when no amount has been selected", () => {
    render(<DonatePanel {...defaultProps} />);
    expect(getContinueBtn()).toBeDisabled();
  });

  it("Continue button is disabled when custom amount is under $1 (e.g. 0.50)", () => {
    render(<DonatePanel {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/custom amount/i), {
      target: { value: "0.50" },
    });

    expect(getContinueBtn()).toBeDisabled();
  });

  it("renders a role=status message when disabled and disabledReason are provided", () => {
    render(
      <DonatePanel
        {...defaultProps}
        disabled
        disabledReason="Campaign has ended"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Campaign has ended");
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
});
