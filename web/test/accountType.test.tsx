// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountTypeDialog } from "../src/components/AccountTypeDialog";
import { NAV_ITEMS } from "../src/components/dashboard/navItems";
import { ONBOARDING_STEPS } from "../src/components/onboarding/Steps";
import {
  ACCOUNT_TYPES,
  hiddenFor,
  navFor,
} from "../src/features/account/accountType";
import {
  DASHBOARD_PATH,
  DEVELOPERS_PATH,
  INVOICES_PATH,
  LINKS_PATH,
  SETTINGS_PATH,
  TRANSACTIONS_PATH,
} from "../src/lib/auth-routes";

const hrefs = (items: { href: string }[]) => items.map((i) => i.href);

describe("account type navigation", () => {
  it("shows everything before a type is chosen", () => {
    expect(hrefs(navFor(null, NAV_ITEMS))).toEqual(hrefs([...NAV_ITEMS]));
    expect(hiddenFor(null, NAV_ITEMS)).toEqual([]);
  });

  it("puts invoices first for a business", () => {
    const nav = hrefs(navFor("business", NAV_ITEMS));
    // The point is the order of the first few, not the whole list: adding a
    // page in the middle should not break this.
    expect(nav.slice(0, 3)).toEqual([
      DASHBOARD_PATH,
      INVOICES_PATH,
      TRANSACTIONS_PATH,
    ]);
    expect(nav).toContain(LINKS_PATH);
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
    render(
      <AccountTypeDialog
        open
        onChoose={onChoose}
        username="demo"
        recoveryMethod="pin"
      />,
    );
    const next = screen.getByRole("button", {
      name: /Finish and open my dashboard/,
    });
    expect(next).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /Business/ }));
    await userEvent.type(screen.getByLabelText(/Business name/), "Kopi Senja");
    await userEvent.click(next);
    expect(onChoose).toHaveBeenCalledWith("business", "Kopi Senja");
  });

  it("explains every type on its card, not just names it", () => {
    render(
      <AccountTypeDialog
        open
        onChoose={vi.fn()}
        username="demo"
        recoveryMethod="pin"
      />,
    );
    for (const type of ACCOUNT_TYPES) {
      const card = screen.getByRole("radio", { name: new RegExp(type.label) });
      expect(card).toHaveTextContent(type.summary);
      expect(card).toHaveTextContent(type.tools);
      expect(card).toHaveTextContent(type.goodIf);
    }
  });

  // Onboarding used to show three anonymous dashes and a count. Naming the
  // steps, and showing back what is already settled, is what tells someone
  // how much of this there is left.
  it("names every step and shows what is already decided", () => {
    render(
      <AccountTypeDialog
        open
        onChoose={vi.fn()}
        username="demo"
        recoveryMethod="pin"
      />,
    );
    // Scoped to the list: below `sm` the current step is also printed under
    // the track as an aria-hidden line, so the bare text appears twice.
    const steps = within(
      screen.getByRole("list", { name: "Onboarding steps" }),
    );
    for (const label of ONBOARDING_STEPS) {
      expect(steps.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("@demo")).toBeInTheDocument();
    expect(screen.getByText("A 6-digit PIN")).toBeInTheDocument();
  });

  it("asks no name for a personal account", async () => {
    const onChoose = vi.fn().mockResolvedValue(undefined);
    render(
      <AccountTypeDialog
        open
        onChoose={onChoose}
        username="demo"
        recoveryMethod="pin"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /Personal/ }));
    expect(screen.queryByLabelText(/Business name/)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: /Finish and open my dashboard/ }),
    );
    expect(onChoose).toHaveBeenCalledWith("personal", null);
  });
});
