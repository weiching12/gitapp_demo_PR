import test from "node:test";
import assert from "node:assert/strict";
import { rememberPage, restorePage } from "../src/ui/page-session.js";

test("a reload restores only a known page within the current tab", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  rememberPage("favorites", storage);
  const state = { page: "market" };
  restorePage(state, storage);
  assert.equal(state.page, "favorites");
  rememberPage("sectors", storage);
  restorePage(state, storage);
  assert.equal(state.page, "sectors");
  rememberPage("unknown", storage);
  assert.equal([...values.values()][0], "sectors");
  values.set("stock-insight-current-page", "unknown");
  restorePage(state, storage);
  assert.equal(state.page, "sectors");
});
