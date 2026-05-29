export interface MobileScrollChromeOptions {
  hideDelta: number;
  showDelta: number;
  hideAfterTop: number;
  showAtTop: number;
  minDelta: number;
}

export interface MobileScrollChromeState {
  visible: boolean;
  lastScrollTop: number;
  accumulatedDown: number;
  accumulatedUp: number;
}

export interface MobileScrollChromeInput {
  scrollTop: number;
  canHide?: boolean;
}

export const MOBILE_SCROLL_CHROME_DEFAULTS: MobileScrollChromeOptions = {
  hideDelta: 14,
  showDelta: 10,
  hideAfterTop: 24,
  showAtTop: 4,
  minDelta: 1,
};

export function initialMobileScrollChromeState(visible = true, scrollTop = 0): MobileScrollChromeState {
  return {
    visible,
    lastScrollTop: Math.max(0, scrollTop),
    accumulatedDown: 0,
    accumulatedUp: 0,
  };
}

export function reduceMobileScrollChrome(
  state: MobileScrollChromeState,
  input: MobileScrollChromeInput,
  options: MobileScrollChromeOptions = MOBILE_SCROLL_CHROME_DEFAULTS,
): MobileScrollChromeState {
  const scrollTop = Math.max(0, input.scrollTop);
  const delta = scrollTop - state.lastScrollTop;

  if (scrollTop <= options.showAtTop) {
    return {
      visible: true,
      lastScrollTop: scrollTop,
      accumulatedDown: 0,
      accumulatedUp: 0,
    };
  }

  if (Math.abs(delta) < options.minDelta) {
    return {
      ...state,
      lastScrollTop: scrollTop,
    };
  }

  if (delta > 0) {
    const accumulatedDown = state.accumulatedDown + delta;
    const shouldHide = Boolean(input.canHide ?? true)
      && scrollTop > options.hideAfterTop
      && accumulatedDown >= options.hideDelta;

    return {
      visible: shouldHide ? false : state.visible,
      lastScrollTop: scrollTop,
      accumulatedDown,
      accumulatedUp: 0,
    };
  }

  const accumulatedUp = state.accumulatedUp + Math.abs(delta);
  return {
    visible: accumulatedUp >= options.showDelta ? true : state.visible,
    lastScrollTop: scrollTop,
    accumulatedDown: 0,
    accumulatedUp,
  };
}
