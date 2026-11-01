// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountTypeDialog } from "../src/components/AccountTypeDialog";
import { NAV_ITEMS } from "../src/components/dashboard/navItems";
import { hiddenFor, navFor } from "../src/features/account/accountType";
import {
  DASHBOARD_PATH,
  DEVELOPERS_PATH,
  INVOICES_PATH,
  LINKS_PATH,
  SETTINGS_PATH,
} from "../src/lib/auth-routes";

const hrefs = (items: { href: string }[]) => items.map((i) => i.href);

describe("account type navigation", () => {
  it("shows everything before a type is chosen", () => {
    expect(hrefs(navFor(null, NAV_ITEMS))).toEqual(hrefs([...NAV_ITEMS]));
    expect(hiddenFor(null, NAV_ITEMS)).toEqual([]);
  });

  it("puts invoices first for a business", () => {
    const nav = hrefs(navFor("business", NAV_ITEMS));
    expect(nav.slice(0, 3)).toEqual([
      DASHBOARD_PATH,
      INVOICES_PATH,
      LINKS_PATH,
    ]);
    expect(nav).toContain(DEVELOPERS_PATH);
    expect(nav.at(-1)).toBe(SETTINGS_PATH);
  });

  it("keeps business tools out of a personal account, but reachable", () => {
    const nav = hrefs(navFor("personal", NAV_ITEMS));
    expect(nav).not.toContain(DEVELOPERS_PATH);
    const hidden = hrefs(hiddenFor("personal", NAV_ITEMS));
    expect(hidden).toEqual(expect.arrayContaining([DEVELOPERS_PATH]));
    // Every page is either in the navigation or under "Other tools".
    expect([...nav, ...hidden].sort()).toEqual(hrefs([...NAV_ITEMS]).sort());
  });
});

describe("AccountTypeDialog", () => {
  it("waits for a choice, then saves the business name with it", async () => {
    const onChoose = vi.fn().mockResolvedValue(undefined);
    render(<AccountTypeDialog open onChoose={onChoose} />);
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /Business/ }));
    await userEvent.type(screen.getByLabelText(/Business name/), "Kopi Senja");
    await userEvent.click(next);
    expect(onChoose).toHaveBeenCalledWith("business", "Kopi Senja");
  });

  it("asks no name for a personal account", async () => {
    const onChoose = vi.fn().mockResolvedValue(undefined);
    render(<AccountTypeDialog open onChoose={onChoose} />);
    await userEvent.click(screen.getByRole("radio", { name: /Personal/ }));
    expect(screen.queryByLabelText(/Business name/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onChoose).toHaveBeenCalledWith("personal", null);
  });
});
