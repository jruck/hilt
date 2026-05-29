import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initialMobileScrollChromeState,
  reduceMobileScrollChrome,
} from "./mobile-scroll-chrome";

describe("mobile scroll chrome reducer", () => {
  it("ignores tiny scroll jitter", () => {
    const state = initialMobileScrollChromeState(true, 40);
    const next = reduceMobileScrollChrome(state, { scrollTop: 40.4 });

    assert.equal(next.visible, true);
    assert.equal(next.accumulatedDown, 0);
    assert.equal(next.accumulatedUp, 0);
  });

  it("hides after a deliberate downward scroll past the top threshold", () => {
    let state = initialMobileScrollChromeState(true, 24);
    state = reduceMobileScrollChrome(state, { scrollTop: 31 });
    state = reduceMobileScrollChrome(state, { scrollTop: 39 });

    assert.equal(state.visible, false);
  });

  it("does not hide while still near the top", () => {
    let state = initialMobileScrollChromeState(true, 0);
    state = reduceMobileScrollChrome(state, { scrollTop: 8 });
    state = reduceMobileScrollChrome(state, { scrollTop: 16 });

    assert.equal(state.visible, true);
  });

  it("shows after a deliberate upward scroll", () => {
    let state = initialMobileScrollChromeState(false, 120);
    state = reduceMobileScrollChrome(state, { scrollTop: 114 });
    state = reduceMobileScrollChrome(state, { scrollTop: 108 });

    assert.equal(state.visible, true);
  });

  it("shows when returning to the top", () => {
    const state = initialMobileScrollChromeState(false, 40);
    const next = reduceMobileScrollChrome(state, { scrollTop: 3 });

    assert.equal(next.visible, true);
  });

  it("clamps overscroll before deciding", () => {
    const state = initialMobileScrollChromeState(false, 3);
    const next = reduceMobileScrollChrome(state, { scrollTop: -18 });

    assert.equal(next.visible, true);
    assert.equal(next.lastScrollTop, 0);
  });

  it("respects temporary visibility locks", () => {
    const state = initialMobileScrollChromeState(true, 30);
    const next = reduceMobileScrollChrome(state, { scrollTop: 50, canHide: false });

    assert.equal(next.visible, true);
  });
});
