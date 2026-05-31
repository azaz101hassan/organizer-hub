import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "../Field";
import { Input } from "../Input";

describe("Field", () => {
  it("associates label with control via htmlFor", () => {
    render(
      <Field label="Email" htmlFor="email">
        <Input id="email" />
      </Field>
    );
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
  });
});
