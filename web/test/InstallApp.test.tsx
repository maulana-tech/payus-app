// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallApp } from "../src/features/pwa/InstallApp";
import { clearInstallPrompt } from "../src/features/pwa/installPrompt";

beforeEach(() => {
  clearInstallPrompt();
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Android Chrome",
  });
  Object.defineProperty(navigator, "standalone", {
    configurable: true,
    value: false,
  });
});

function installEvent(prompt = vi.fn(async () => {}), outcome = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  fireEvent(window, event);
  return { event, prompt };
}

describe("Install Payus", () => {
  it("offers the browser prompt only after it becomes available", async () => {
    render(<InstallApp />);
    expect(
      screen.queryByRole("button", { name: "Install Payus" }),
    ).not.toBeInTheDocument();
    const { event, prompt } = installEvent();
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Install Payus" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Install Payus" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("remembers dismissal without saving account or payment data", () => {
    const view = render(<InstallApp />);
    installEvent();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss install suggestion" }),
    );
    view.unmount();
    render(<InstallApp />);
    installEvent();
    expect(
      screen.queryByRole("button", { name: "Install Payus" }),
    ).not.toBeInTheDocument();
    expect(Object.keys(localStorage)).toEqual(["payus:pwa-install-dismissed"]);
  });
  it("shows manual iPhone installation instructions", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "iPhone Safari",
    });
    render(<InstallApp />);
    expect(screen.getByText(/Add to Home Screen/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Install Payus" }),
    ).not.toBeInTheDocument();
  });
  it("hides installation suggestions in standalone mode", () => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    });
    render(<InstallApp />);
    installEvent();
    expect(
      screen.queryByText("Payus on your home screen"),
    ).not.toBeInTheDocument();
  });
  it("recovers from a rejected browser prompt", async () => {
    render(<InstallApp />);
    installEvent(
      vi.fn(async () => {
        throw new Error("not allowed");
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Install Payus" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/browser menu/);
    expect(screen.getByRole("button", { name: "Install Payus" })).toBeEnabled();
  });
});
