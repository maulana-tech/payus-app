// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "../src/components/dashboard/Segmented";
import { DatePicker } from "../src/components/ui/date-picker";

function Controlled(props: {
  initial: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <DatePicker
      aria-label="Due"
      value={value}
      min={props.min}
      max={props.max}
      clearable={props.clearable}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
    />
  );
}

describe("DatePicker", () => {
  it("shows the value and picks a day from the calendar", async () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-10-28" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Due" });
    expect(trigger).toHaveTextContent("Oct 28, 2026");
    await userEvent.click(trigger);
    expect(screen.getByText("October 2026")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Wednesday, October 28, 2026" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      screen.getByRole("button", { name: "Saturday, October 31, 2026" }),
    );
    expect(onChange).toHaveBeenCalledWith("2026-10-31");
    expect(trigger).toHaveTextContent("Oct 31, 2026");
  });

  it("moves by keyboard across months and respects min/max", async () => {
    const onChange = vi.fn();
    render(
      <Controlled
        initial="2026-10-30"
        max="2026-11-05"
        min="2026-10-02"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Due" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAccessibleName(
      "Friday, November 6, 2026",
    );
    expect(screen.getByText("November 2026")).toBeTruthy();
    // Past max: disabled, so Enter does nothing.
    await userEvent.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowLeft}{Enter}");
    expect(onChange).toHaveBeenCalledWith("2026-11-05");
  });

  it("clears an optional filter", async () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-01-15" clearable onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Due" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("jumps to a month from the month view", async () => {
    render(<Controlled initial="2026-03-10" />);
    await userEvent.click(screen.getByRole("button", { name: "Due" }));
    await userEvent.click(
      screen.getByRole("button", { name: "March 2026, choose a month" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Aug" }));
    expect(screen.getByText("August 2026")).toBeTruthy();
  });
});

describe("Segmented", () => {
  it("marks the chosen option and reports changes", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        aria-label="Type"
        value="all"
        onChange={onChange}
        options={[
          { value: "all", label: "All" },
          { value: "sent", label: "Sent" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sent" }));
    expect(onChange).toHaveBeenCalledWith("sent");
  });
});
