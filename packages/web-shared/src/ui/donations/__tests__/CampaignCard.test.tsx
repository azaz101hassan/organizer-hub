import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampaignCard } from "../CampaignCard";

const baseProps = {
  slug: "save-the-bay",
  name: "Save the Bay",
  coverImageUrl: null,
  targetAmountCents: 100000,
  raisedCents: 25000,
  donorCount: 17,
  deadline: null,
  currency: "usd",
};

describe("CampaignCard", () => {
  it("renders raised + target + donor count", () => {
    render(<CampaignCard {...baseProps} />);
    expect(screen.getByText(/250 raised of \$1,000/)).toBeInTheDocument();
    expect(screen.getByText(/17 donors/)).toBeInTheDocument();
  });

  it("pluralizes donor label correctly when count is 1", () => {
    render(<CampaignCard {...baseProps} donorCount={1} />);
    expect(screen.getByText(/1 donor$/)).toBeInTheDocument();
  });

  it("renders an invalid-string deadline as no deadline tail (no 'NaN days')", () => {
    render(<CampaignCard {...baseProps} deadline="" />);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/days left/)).toBeNull();
  });

  it("renders 'not-a-date' deadline as no deadline tail", () => {
    render(<CampaignCard {...baseProps} deadline="not-a-date" />);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/days left/)).toBeNull();
  });

  it("renders a future deadline as 'N days left'", () => {
    const oneWeek = new Date(Date.now() + 7 * 86_400_000);
    render(<CampaignCard {...baseProps} deadline={oneWeek} />);
    expect(screen.getByText(/days left/)).toBeInTheDocument();
  });

  it("renders the progress bar with the correct aria-valuenow", () => {
    render(<CampaignCard {...baseProps} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
  });

  it("links to /campaigns/:slug", () => {
    render(<CampaignCard {...baseProps} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/campaigns/save-the-bay",
    );
  });
});
