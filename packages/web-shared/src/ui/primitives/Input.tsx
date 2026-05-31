import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return (
      <input ref={ref} className={["input", className].filter(Boolean).join(" ")} {...rest} />
    );
  },
);
