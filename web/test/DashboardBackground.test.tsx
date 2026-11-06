// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DashboardBackground,
  useDashboardMode,
} from "../src/components/dashboard/DashboardBackground";

const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
const dashboardCss = css.slice(css.indexOf("body:has(.dashboard-app) {"));

function ModeProbe() {
  const { mode, toggleMode } = useDashboardMode();
  return (
    <button type="button" onClick={toggleMode}>
      {mode}
    </button>
  );
}

describe("DashboardBackground", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.dashMode;
    window.localStorage.clear();
  });

  it("renders the dashboard canvas without a background image", () => {
    const { container } = render(
      <DashboardBackground>
        <p>Dashboard content</p>
      </DashboardBackground>,
    );

    expect(container.firstElementChild).toHaveClass(
      "theme-product",
      "dashboard-app",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("toggles between light and dark and remembers the choice", async () => {
    document.documentElement.dataset.dashMode = "light";
    render(<ModeProbe />);

    await userEvent.click(screen.getByRole("button", { name: "light" }));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(document.documentElement.dataset.dashMode).toBe("dark");
    expect(window.localStorage.getItem("payus.dashboard.mode")).toBe("dark");
  });

  // The landing's two grounds, swapped: #f5f3ea (--color-ed-cream) and
  // #20261a (--color-ed-dark-2). Dark mode is the landing's own pairing.
  it("uses ink on paper (and paper on ink in dark mode), without gradients", () => {
    expect(dashboardCss).toContain("--dash-bg: #f5f3ea;");
    expect(dashboardCss).toContain("--dash-fg: #20261a;");
    expect(dashboardCss).toMatch(
      /html\[data-dash-mode="dark"\] body:has\(\.dashboard-app\) \{[^}]*--dash-bg: #20261a;[^}]*--dash-fg: #f5f3ea;/,
    );
    expect(dashboardCss).not.toMatch(/gradient\(/);
  });

  // The canvas behind the page has to start from the page's own colour: a
  // base one shade off turns the whole dither visible as a grey field.
  it("paints the dither field from the same two colours as the page", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/components/dashboard/DashboardBackground.tsx"),
      "utf8",
    );
    expect(source).toContain('light: { light: "#f5f3ea"');
    expect(source).toContain('dark: { light: "#20261a"');
    // Marks in the dashboard are ink, never hue — the signal blue that used
    // to sit here showed as a texture behind body text.
    expect(source).not.toMatch(/#5ea6e5|#1c5f94/i);
  });
});
