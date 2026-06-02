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
      donateNow("s", fd({ campaignId: "c1", cadence: "ONCE", amountCents: "2500" })),
    ).rejects.toThrow("REDIRECT:https://stripe.test/cs_1");
  });

  it("redirects to /auth/login with next= preserving cadence + amount on UnauthorizedError", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new UnauthorizedError());
    await expect(
      donateNow("s", fd({ campaignId: "c1", cadence: "MONTHLY", amountCents: "2500" })),
    ).rejects.toThrow(/REDIRECT:\/auth\/login\?next=/);
  });

  it("redirects back to the campaign with ?error on ApiError", async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiError(409, "campaign is not accepting donations"),
    );
    await expect(
      donateNow("s", fd({ campaignId: "c1", cadence: "ONCE", amountCents: "2500" })),
    ).rejects.toThrow(/REDIRECT:\/campaigns\/s\?error=/);
  });

  it("redirects with Invalid amount when amountCents is below the min", async () => {
    await expect(
      donateNow("s", fd({ campaignId: "c1", cadence: "ONCE", amountCents: "50" })),
    ).rejects.toThrow(/REDIRECT:\/campaigns\/s\?error=Invalid%20amount/);
  });
});
