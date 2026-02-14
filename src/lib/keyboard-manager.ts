import * as blessed from 'blessed';

/**
 * Handler function for keyboard events.
 * Return false to indicate the key was not handled and should propagate to lower contexts.
 * Return void/true to indicate the key was handled and should not propagate.
 */
export interface KeyHandler {
  (ch: string, key: blessed.Widgets.Events.IKeyEventArg): void | boolean;
}

/**
 * Map of key names to handler functions.
 * Keys can be:
 * - Single characters: 'a', 'b', '1', '2'
 * - Special keys: 'enter', 'escape', 'tab', 'space'
 * - Modified keys: 'C-c' (Ctrl-c), 'M-x' (Alt-x)
 * - Arrow keys: 'up', 'down', 'left', 'right'
 */
export interface KeyHandlerMap {
  [key: string]: KeyHandler;
}

/**
 * A keyboard context represents a set of key handlers for a particular UI state.
 * Contexts are stacked, with the top-most context receiving keys first.
 */
interface KeyboardContext {
  /** Human-readable name for debugging */
  name: string;
  /** Map of key names to handler functions */
  handlers: KeyHandlerMap;
  /** If true, prevent keys from propagating to lower contexts (even if not handled) */
  blocking: boolean;
}

/**
 * KeyboardManager provides centralized keyboard event handling with a context stack.
 *
 * This solves several problems with blessed.js's event model:
 * 1. No built-in event.stopPropagation() mechanism
 * 2. Multiple handlers can fire for the same key
 * 3. Modal focus doesn't prevent screen handlers from executing
 * 4. Handler re-registration in render() causes races and state loss
 *
 * Usage pattern:
 * ```typescript
 * const keyboardManager = new KeyboardManager(screen);
 *
 * // Push main app context
 * keyboardManager.pushContext('main', {
 *   'escape': () => process.exit(0),
 *   'up': () => scrollUp(),
 *   'down': () => scrollDown(),
 * });
 *
 * // When opening a modal, push a blocking context
 * keyboardManager.pushContext('confirm-modal', {
 *   'enter': () => confirmAction(),
 *   'escape': () => closeModal(),
 * }, true); // blocking=true prevents main context from receiving keys
 *
 * // When closing the modal, pop the context
 * keyboardManager.popContext();
 *
 * // Now main context receives keys again
 * ```
 *
 * Context Stack Example:
 * ```
 * [top] modal-context (blocking)    <- Keys go here first
 *       main-context                <- Only receives keys if modal doesn't handle and is non-blocking
 * ```
 */
export class KeyboardManager {
  private contextStack: KeyboardContext[] = [];
  private screen: blessed.Widgets.Screen;
  private debugMode: boolean = false;

  /**
   * Create a new KeyboardManager.
   *
   * @param screen - blessed screen instance to intercept keys from
   * @param debugMode - If true, log key handling to stderr for debugging
   */
  constructor(screen: blessed.Widgets.Screen, debugMode = false) {
    this.screen = screen;
    this.debugMode = debugMode;
    this.interceptKeys();
  }

  /**
   * Intercept all keypresses at the screen level.
   * This is called BEFORE blessed's screen.key() handlers.
   */
  private interceptKeys(): void {
    this.screen.on('keypress', (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
      this.handleKeypress(ch, key);
    });
  }

  /**
   * Route keypress to the top-most context.
   * If context doesn't handle it and is non-blocking, pass to lower contexts.
   */
  private handleKeypress(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (this.debugMode) {
      const contextNames = this.contextStack.map(c => c.name).join(' -> ');
      console.error(`[KeyboardManager] Key: ${key.full || key.name} | Contexts: ${contextNames || '(none)'}`);
    }

    if (this.contextStack.length === 0) {
      if (this.debugMode) {
        console.error('[KeyboardManager] No contexts registered, key not handled');
      }
      return;
    }

    // Iterate from top of stack (most recent context) to bottom
    for (let i = this.contextStack.length - 1; i >= 0; i--) {
      const context = this.contextStack[i];
      const handled = this.tryContext(context, ch, key);

      if (handled) {
        // Event consumed by this context
        if (this.debugMode) {
          console.error(`[KeyboardManager] ✓ Handled by context: ${context.name}`);
        }
        return;
      }

      if (context.blocking) {
        // Context is blocking, don't pass to lower contexts
        if (this.debugMode) {
          console.error(`[KeyboardManager] ✗ Not handled, but blocked by: ${context.name}`);
        }
        return;
      }

      // Not handled and not blocking, continue to next context
      if (this.debugMode) {
        console.error(`[KeyboardManager] ↓ Not handled by ${context.name}, trying next context`);
      }
    }

    if (this.debugMode) {
      console.error('[KeyboardManager] Key not handled by any context');
    }
  }

  /**
   * Try to handle key in the given context.
   * Returns true if handled, false otherwise.
   */
  private tryContext(
    context: KeyboardContext,
    ch: string,
    key: blessed.Widgets.Events.IKeyEventArg
  ): boolean {
    // Try full key name first (e.g., "C-c", "escape", "M-x")
    const fullKey = key.full || key.name;
    let handler = context.handlers[fullKey];

    if (!handler && key.name) {
      // Try just the key name (e.g., "c" instead of "C-c")
      handler = context.handlers[key.name];
    }

    if (!handler && ch) {
      // Try the character itself (e.g., "a", "1")
      handler = context.handlers[ch];
    }

    if (handler) {
      const result = handler(ch, key);
      // Handler can return false to indicate "not handled"
      return result !== false;
    }

    return false;
  }

  /**
   * Push a new keyboard context onto the stack.
   * This context will receive keys before lower contexts.
   *
   * @param name - Human-readable name for debugging
   * @param handlers - Map of key names to handler functions
   * @param blocking - If true, prevent keys from reaching lower contexts (default: true)
   *
   * @example
   * ```typescript
   * // Push a blocking modal context
   * keyboardManager.pushContext('error-modal', {
   *   'enter': () => closeModal(),
   *   'escape': () => closeModal(),
   * }, true);
   * ```
   */
  pushContext(name: string, handlers: KeyHandlerMap, blocking = true): void {
    if (this.debugMode) {
      console.error(`[KeyboardManager] ⬆ Push context: ${name} (blocking: ${blocking})`);
    }

    this.contextStack.push({
      name,
      handlers,
      blocking,
    });
  }

  /**
   * Pop the top keyboard context from the stack.
   * Previous context (if any) will now receive keys.
   *
   * @example
   * ```typescript
   * // Close modal and restore previous context
   * keyboardManager.popContext();
   * ```
   */
  popContext(): void {
    const context = this.contextStack.pop();
    if (this.debugMode && context) {
      console.error(`[KeyboardManager] ⬇ Pop context: ${context.name}`);
    }
  }

  /**
   * Update handlers for the current (top) context.
   * Useful for view mode changes without push/pop.
   *
   * @param handlers - New handler map for the current context
   *
   * @example
   * ```typescript
   * // Switch from list mode to detail mode handlers
   * keyboardManager.updateCurrentContext({
   *   'escape': () => backToList(),
   *   'h': () => showHistory(),
   *   'l': () => showLogs(),
   * });
   * ```
   */
  updateCurrentContext(handlers: KeyHandlerMap): void {
    if (this.contextStack.length === 0) {
      throw new Error('No context to update');
    }

    const current = this.contextStack[this.contextStack.length - 1];
    current.handlers = handlers;

    if (this.debugMode) {
      console.error(`[KeyboardManager] ↻ Updated context: ${current.name}`);
    }
  }

  /**
   * Get the current context name (for debugging).
   *
   * @returns Current context name, or null if no contexts
   */
  getCurrentContextName(): string | null {
    return this.contextStack.length > 0
      ? this.contextStack[this.contextStack.length - 1].name
      : null;
  }

  /**
   * Get the full context stack (for debugging).
   *
   * @returns Array of context names from bottom to top
   */
  getContextStack(): string[] {
    return this.contextStack.map(c => c.name);
  }

  /**
   * Clear all contexts (useful for cleanup).
   *
   * @example
   * ```typescript
   * // Cleanup on exit
   * keyboardManager.clearAll();
   * screen.destroy();
   * ```
   */
  clearAll(): void {
    if (this.debugMode) {
      console.error('[KeyboardManager] Clear all contexts');
    }
    this.contextStack = [];
  }

  /**
   * Enable or disable debug mode.
   * When enabled, logs key handling to stderr.
   *
   * @param enabled - True to enable debug logging
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    if (enabled) {
      console.error('[KeyboardManager] Debug mode enabled');
    }
  }
}
