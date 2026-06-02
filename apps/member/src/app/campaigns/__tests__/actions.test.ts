import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@organizer-hub/web-shared", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`api ${status}: ${body}`);
    }
  }
  class UnauthorizedError extends Error {}
  return { apiFetch: vi.fn(), ApiError, UnauthorizedError };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import { apiFetch, ApiError, UnauthorizedError } from "@organizer-hub/web-shared";
import { donateNow } from "../actions";

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("donateNow", () => {
  it("redirects to the Stripe URL on success", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      url: "https://stripe.test/cs_1",
      donationId: "don_1",
    });
    await expect(
      donateNow("s", undefined, fd({ campaignId: "c1", cadence: "ONCE", amountCents: "2500" })),
    ).rejects.toThrow("REDIRECT:https://stripe.test/cs_1");
  });

  it("redirects to /auth/login with next= preserving cadence + amount on UnauthorizedError", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new UnauthorizedError());
    await expect(
      donateNow("s", undefined, fd({ campaignId: "c1", cadence: "MONTHLY", amountCents: "2500" })),
    ).rejects.toThrow(/REDIRECT:\/auth\/login\?next=/);
  });

  it("redirects back to the campaign with a donor-safe message on ApiError", async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiError(409, "stripe internal: cus_xxx mismatch"),
    );
    await expect(
      donateNow("s", undefined, fd({ campaignId: "c1", cadence: "ONCE", amountCents: "2500" })),
    ).rejects.toThrow(/REDIRECT:\/campaigns\/s\?error=This%20campaign%20is%20not%20accepting%20donations%20right%20now\./);
  });

  it("redirects with Invalid amount when amountCents is below the min", async () => {
    await expect(
      donateNow("s", undefined, fd({ campaignId: "c1", cadence: "ONCE", amountCents: "50" })),
    ).rejects.toThrow(/REDIRECT:\/campaigns\/s\?error=Invalid%20amount/);
  });

  it("redirects back to errorPath instead of /campaigns/{slug} when provided", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(409, "x"));
    await expect(
      donateNow(
        "general-fund",
        "/donate",
        fd({ campaignId: "c1", cadence: "ONCE", amountCents: "2500" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/donate\?error=/);
  });

  it("ignores an unsafe errorPath (protocol-relative) and falls back to /campaigns/{slug}", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(409, "x"));
    await expect(
      donateNow(
        "general-fund",
        "//evil.example.com",
        fd({ campaignId: "c1", cadence: "ONCE", amountCents: "2500" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/campaigns\/general-fund\?error=/);
  });
});
