import { expect, it } from "vitest";
import {
  isAuthOnlyPublicRoute,
  isProtectedRoute,
} from "../src/lib/auth-routes";

it("does not require login or redirect authenticated visitors on Verify", () => {
  expect(isProtectedRoute("/verify")).toBe(false);
  expect(isAuthOnlyPublicRoute("/verify")).toBe(false);
});
