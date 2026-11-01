// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallApp } from "../src/features/pwa/InstallApp";
import {
  clearInstallPrompt,
  getInstallPrompt,
  INSTALL_DISMISSED_KEY,
} from "../src/features/pwa/installPrompt";
import { ServiceWorkerRegistration } from "../src/features/pwa/ServiceWorkerRegistration";

const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
const register = vi.fn();
beforeEach(() => {
  clearInstallPrompt();
  localStorage.clear();
  register.mockReset().mockResolvedValue({});
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
});
afterEach(() => {
  if (original) Object.defineProperty(navigator, "serviceWorker", original);
  else Reflect.deleteProperty(navigator, "serviceWorker");
  vi.restoreAllMocks();
});

describe("PWA registration", () => {
  it("keeps the install offer received on landing for the dashboard", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    render(<ServiceWorkerRegistration />);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    fireEvent(window, event);
    render(<InstallApp />);
    expect(screen.getByRole("button", { name: "Install Payus" })).toBeVisible();
  });
  it("lets the browser show its own install banner once the card is dismissed", () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    render(<ServiceWorkerRegistration />);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
    expect(getInstallPrompt()).toBeNull();
  });
  it("registers the root worker without caching the worker script", () => {
    render(<ServiceWorkerRegistration />);
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });
  it("does not register on an insecure origin", () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    render(<ServiceWorkerRegistration />);
    expect(register).not.toHaveBeenCalled();
  });
  it("keeps the application usable when registration fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    register.mockRejectedValue(new Error("unsupported"));
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(warning).toHaveBeenCalledOnce());
  });
});
