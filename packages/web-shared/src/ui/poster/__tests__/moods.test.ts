import { describe, expect, it } from "vitest";
import { monogram } from "../moods";

describe("monogram", () => {
  it("uses the first significant word's initial", () => {
    expect(monogram("An Evening with the Astrid Quartet")).toBe("E");
  });
  it("skips short/stop words", () => {
    expect(monogram("The Cellar Door — A Natural Wine Salon")).toBe("C");
  });
  it("uppercases", () => {
    expect(monogram("midnight garden")).toBe("M");
  });
});
