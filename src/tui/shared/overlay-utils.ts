import * as blessed from "blessed";

/**
 * Create transparent overlay to block interaction with screen behind modal
 * Note: Caller must append to screen explicitly
 */
export function createOverlay(
  screen: blessed.Widgets.Screen,
): blessed.Widgets.BoxElement {
  return blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: {
      bg: "gray",
      transparent: true,
    },
  });
}
