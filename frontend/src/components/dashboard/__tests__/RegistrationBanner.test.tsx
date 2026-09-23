import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegistrationBanner from "../RegistrationBanner";

const mockRegisterMutate = jest.fn();
jest.mock("@/hooks/useAccrual", () => ({
  useRegister: () => ({
    mutate: mockRegisterMutate,
    isPending: false,
  }),
}));

describe("RegistrationBanner Form Accessibility (#528)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with a visible, programmatically associated label", () => {
    render(<RegistrationBanner />);

    const input = screen.getByLabelText(/Username/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("associates input with help text via aria-describedby", () => {
    render(<RegistrationBanner />);

    const input = screen.getByLabelText(/Username/i);
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const helpText = screen.getByText(/Choose a public display name/i);
    expect(helpText).toBeInTheDocument();
    expect(helpText.id).toBe(describedBy);
  });

  it("shows disabled explanation when submit is disabled", () => {
    render(<RegistrationBanner />);

    const submitBtn = screen.getByRole("button", { name: /Register/i });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText(/Please enter a valid username/i)).toBeInTheDocument();
  });

  it("submits valid username", async () => {
    const onSuccess = jest.fn();
    render(<RegistrationBanner onRegisterSuccess={onSuccess} />);

    const input = screen.getByLabelText(/Username/i);
    await userEvent.type(input, "alice_stellar");

    const submitBtn = screen.getByRole("button", { name: /Register/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(mockRegisterMutate).toHaveBeenCalledWith(
      "alice_stellar",
      expect.any(Object)
    );
  });
});
