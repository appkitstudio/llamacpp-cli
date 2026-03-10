import * as blessed from 'blessed';
import { createOverlay } from './overlay-utils.js';
import { KeyboardManager } from '../../lib/keyboard-manager.js';

/**
 * Modal controller that properly isolates keyboard handling using KeyboardManager.
 *
 * Key features:
 * - Uses KeyboardManager context stack to prevent event propagation
 * - Pushes blocking context when modal opens
 * - Pops context when modal closes
 * - Prevents screen handlers from executing while modal is active
 * - Manages modal lifecycle with proper cleanup
 * - Provides consistent API for all modal types
 */
export class ModalController {
  private screen: blessed.Widgets.Screen;
  private modalStack: ModalContext[] = [];
  private keyboardManager: KeyboardManager;

  constructor(screen: blessed.Widgets.Screen, keyboardManager: KeyboardManager) {
    this.screen = screen;
    this.keyboardManager = keyboardManager;
  }

  /**
   * Check if any modal is currently open
   */
  isModalOpen(): boolean {
    return this.modalStack.length > 0;
  }

  /**
   * Create modal element with standard styling
   */
  private createModalElement(options: CreateModalOptions): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: options.width || '60%',
      height: options.height || 'shrink',
      border: { type: 'line' },
      style: {
        border: { fg: options.borderColor || 'cyan' },
        fg: 'white',
      },
      tags: true,
      label: ` ${options.title} `,
    });
  }


  /**
   * Show a simple error message modal
   */
  async showError(message: string, onClose: () => void): Promise<void> {
    return new Promise((resolve) => {

      const modal = this.createModalElement({
        title: 'Error',
        height: 8,
        borderColor: 'red',
        onClose,
      });

      modal.setContent(`\n  {red-fg}❌ ${message}{/red-fg}\n\n  {gray-fg}[Enter] Close{/gray-fg}`);

      const closeModal = () => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext(); // Pop keyboard context AFTER modal is destroyed
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve();
      };

      // Push keyboard context BEFORE showing modal (blocking=true prevents screen handlers)
      this.keyboardManager.pushContext('error-modal', {
        'enter': closeModal,
        'escape': closeModal,
      }, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      // Note: No need for modal.key() - KeyboardManager handles all keys
      this.screen.append(context.overlay);
      this.screen.append(modal);
      modal.focus();
      this.screen.render();
    });
  }

  /**
   * Show a simple success message modal
   */
  async showSuccess(message: string, onClose: () => void): Promise<void> {
    return new Promise((resolve) => {

      const modal = this.createModalElement({
        title: 'Success',
        height: 8,
        borderColor: 'green',
        onClose,
      });

      modal.setContent(`\n  {green-fg}✓ ${message}{/green-fg}\n\n  {gray-fg}[Enter] Close{/gray-fg}`);

      const closeModal = () => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve();
      };

      // Push keyboard context BEFORE showing modal
      this.keyboardManager.pushContext('success-modal', {
        'enter': closeModal,
        'escape': closeModal,
      }, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      this.screen.append(context.overlay);
      this.screen.append(modal);
      modal.focus();
      this.screen.render();
    });
  }

  /**
   * Show an unsaved changes dialog
   */
  async showUnsavedDialog(onClose: () => void): Promise<'save' | 'discard' | 'continue'> {
    return new Promise((resolve) => {

      const modal = this.createModalElement({
        title: 'Unsaved Changes',
        height: 10,
        onClose,
      });

      let selectedOption = 0;
      const options = [
        { key: 'save' as const, label: '[S]ave and exit' },
        { key: 'discard' as const, label: '[D]iscard changes' },
        { key: 'continue' as const, label: '[C]ontinue editing' },
      ];

      const renderDialog = () => {
        let content = '\n';
        for (let i = 0; i < options.length; i++) {
          const isSelected = i === selectedOption;
          if (isSelected) {
            content += `  {cyan-fg}► ${options[i].label}{/cyan-fg}\n`;
          } else {
            content += `    ${options[i].label}\n`;
          }
        }
        modal.setContent(content);
        this.screen.render();
      };

      const closeWithResult = (result: 'save' | 'discard' | 'continue') => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      // Push keyboard context with all handlers
      this.keyboardManager.pushContext('unsaved-dialog', {
        'up': () => {
          selectedOption = Math.max(0, selectedOption - 1);
          renderDialog();
        },
        'k': () => {
          selectedOption = Math.max(0, selectedOption - 1);
          renderDialog();
        },
        'down': () => {
          selectedOption = Math.min(options.length - 1, selectedOption + 1);
          renderDialog();
        },
        'j': () => {
          selectedOption = Math.min(options.length - 1, selectedOption + 1);
          renderDialog();
        },
        'enter': () => closeWithResult(options[selectedOption].key),
        's': () => closeWithResult('save'),
        'S': () => closeWithResult('save'),
        'd': () => closeWithResult('discard'),
        'D': () => closeWithResult('discard'),
        'c': () => closeWithResult('continue'),
        'C': () => closeWithResult('continue'),
        'escape': () => closeWithResult('continue'),
      }, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      this.screen.append(context.overlay);
      this.screen.append(modal);
      modal.focus();
      renderDialog();
    });
  }

  /**
   * Show a restart confirmation dialog
   */
  async showRestartDialog(serviceName: string, onClose: () => void): Promise<boolean> {
    return new Promise((resolve) => {

      const modal = this.createModalElement({
        title: `${serviceName} is Running`,
        height: 10,
        onClose,
      });

      let selectedOption = 0;
      const options = [
        { key: true, label: '[Y]es - Restart now' },
        { key: false, label: '[N]o - Apply later' },
      ];

      const renderDialog = () => {
        let content = '\n  Restart to apply changes?\n\n';
        for (let i = 0; i < options.length; i++) {
          const isSelected = i === selectedOption;
          if (isSelected) {
            content += `  {cyan-fg}► ${options[i].label}{/cyan-fg}\n`;
          } else {
            content += `    ${options[i].label}\n`;
          }
        }
        modal.setContent(content);
        this.screen.render();
      };

      const closeWithResult = (result: boolean) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      // Push keyboard context with all handlers
      this.keyboardManager.pushContext('restart-dialog', {
        'up': () => {
          selectedOption = Math.max(0, selectedOption - 1);
          renderDialog();
        },
        'k': () => {
          selectedOption = Math.max(0, selectedOption - 1);
          renderDialog();
        },
        'down': () => {
          selectedOption = Math.min(options.length - 1, selectedOption + 1);
          renderDialog();
        },
        'j': () => {
          selectedOption = Math.min(options.length - 1, selectedOption + 1);
          renderDialog();
        },
        'enter': () => closeWithResult(options[selectedOption].key),
        'y': () => closeWithResult(true),
        'Y': () => closeWithResult(true),
        'n': () => closeWithResult(false),
        'N': () => closeWithResult(false),
        'escape': () => closeWithResult(false),
      }, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      this.screen.append(context.overlay);
      this.screen.append(modal);
      modal.focus();
      renderDialog();
    });
  }

  /**
   * Show a number input modal
   */
  async showNumberInput(
    title: string,
    currentValue: number,
    validation: ((value: number) => string | null) | undefined,
    onClose: () => void
  ): Promise<number | null> {
    return new Promise((resolve) => {

      const modal = this.createModalElement({
        title: `Edit ${title}`,
        height: 10,
        onClose,
      });

      const infoText = blessed.text({
        parent: modal,
        top: 1,
        left: 2,
        content: `Current: ${currentValue}`,
        tags: true,
      });

      const inputBox = blessed.textbox({
        parent: modal,
        top: 3,
        left: 2,
        right: 2,
        height: 3,
        inputOnFocus: true,
        border: { type: 'line' },
        style: {
          border: { fg: 'white' },
          focus: { border: { fg: 'green' } },
        },
      });

      blessed.text({
        parent: modal,
        bottom: 1,
        left: 2,
        content: '{gray-fg}[Enter] Confirm  [ESC] Cancel{/gray-fg}',
        tags: true,
      });

      const closeWithResult = (result: number | null) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      // Push blocking context to prevent screen handlers from firing
      // Note: textbox handles its own keys internally, but this prevents ESC from reaching screen
      this.keyboardManager.pushContext('number-input-modal', {}, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      inputBox.setValue(String(currentValue));
      this.screen.append(context.overlay);
      this.screen.append(modal);
      this.screen.render();
      inputBox.focus();

      inputBox.on('submit', (value: string) => {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
          if (validation) {
            const error = validation(numValue);
            if (error) {
              infoText.setContent(`{red-fg}Error: ${error}{/red-fg}`);
              this.screen.render();
              inputBox.focus();
              return;
            }
          }
          closeWithResult(numValue);
        } else {
          closeWithResult(null);
        }
      });

      inputBox.on('cancel', () => {
        closeWithResult(null);
      });
    });
  }

  /**
   * Show a text input modal
   */
  async showTextInput(
    title: string,
    currentValue: string,
    validation: ((value: string) => Promise<string | null>) | undefined,
    onClose: () => void
  ): Promise<string | null> {
    return new Promise((resolve) => {

      const modal = this.createModalElement({
        title: `Edit ${title}`,
        height: 10,
        onClose,
      });

      const infoText = blessed.text({
        parent: modal,
        top: 1,
        left: 2,
        content: `Current: ${currentValue}`,
        tags: true,
      });

      const inputBox = blessed.textbox({
        parent: modal,
        top: 3,
        left: 2,
        right: 2,
        height: 3,
        inputOnFocus: true,
        border: { type: 'line' },
        style: {
          border: { fg: 'white' },
          focus: { border: { fg: 'green' } },
        },
      });

      blessed.text({
        parent: modal,
        bottom: 1,
        left: 2,
        content: '{gray-fg}[Enter] Confirm  [ESC] Cancel{/gray-fg}',
        tags: true,
      });

      const closeWithResult = (result: string | null) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      // Push blocking context to prevent screen handlers from firing
      this.keyboardManager.pushContext('text-input-modal', {}, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      inputBox.setValue(currentValue);
      this.screen.append(context.overlay);
      this.screen.append(modal);
      this.screen.render();
      inputBox.focus();

      inputBox.on('submit', async (value: string) => {
        if (validation) {
          const error = await validation(value);
          if (error) {
            infoText.setContent(`{red-fg}Error: ${error}{/red-fg}`);
            this.screen.render();
            inputBox.focus();
            return;
          }
        }
        closeWithResult(value);
      });

      inputBox.on('cancel', () => {
        closeWithResult(null);
      });
    });
  }

  /**
   * Show a select/toggle modal
   */
  async showSelect(
    title: string,
    options: string[],
    currentValue: string | boolean,
    isToggle: boolean,
    onClose: () => void,
    additionalInfo?: (selectedValue: string) => string
  ): Promise<string | boolean | null> {
    return new Promise((resolve) => {

      let selectedOption = isToggle
        ? (currentValue ? 1 : 0)
        : options.indexOf(String(currentValue));
      if (selectedOption < 0) selectedOption = 0;

      const modal = this.createModalElement({
        title,
        height: options.length + 6,
        onClose,
      });

      const renderOptions = () => {
        let content = '\n';
        for (let i = 0; i < options.length; i++) {
          const isSelected = i === selectedOption;
          const indicator = isSelected ? '●' : '○';
          if (isSelected) {
            content += `  {cyan-fg}${indicator} ${options[i]}{/cyan-fg}\n`;
          } else {
            content += `  {gray-fg}${indicator} ${options[i]}{/gray-fg}\n`;
          }
        }

        if (additionalInfo) {
          const info = additionalInfo(options[selectedOption]);
          if (info) {
            content += '\n' + info;
          }
        }

        content += '\n\n{gray-fg}  [↑/↓] Select  [Enter] Confirm  [ESC] Cancel{/gray-fg}';
        modal.setContent(content);
        this.screen.render();
      };

      const closeWithResult = (result: string | boolean | null) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        modal.destroy();
        context.overlay.destroy();
        this.modalStack.pop();
        this.keyboardManager.popContext();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      // Push keyboard context with all handlers
      this.keyboardManager.pushContext('select-modal', {
        'up': () => {
          selectedOption = Math.max(0, selectedOption - 1);
          renderOptions();
        },
        'k': () => {
          selectedOption = Math.max(0, selectedOption - 1);
          renderOptions();
        },
        'down': () => {
          selectedOption = Math.min(options.length - 1, selectedOption + 1);
          renderOptions();
        },
        'j': () => {
          selectedOption = Math.min(options.length - 1, selectedOption + 1);
          renderOptions();
        },
        'enter': () => {
          if (isToggle) {
            closeWithResult(selectedOption === 1);
          } else {
            closeWithResult(options[selectedOption]);
          }
        },
        'escape': () => {
          closeWithResult(null);
        },
      }, true);

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: createOverlay(this.screen),
      };

      this.modalStack.push(context);

      this.screen.append(context.overlay);
      this.screen.append(modal);
      modal.focus();
      renderOptions();
    });
  }

  /**
   * Show a progress modal (non-interactive)
   * Note: Progress modals don't use overlays since they're temporary
   */
  showProgress(message: string): blessed.Widgets.BoxElement {
    const modal = this.createModalElement({
      title: 'Working',
      height: 6,
      onClose: () => {},
    });

    modal.setContent(`\n  {cyan-fg}${message}{/cyan-fg}`);

    this.screen.append(modal);
    this.screen.render();

    return modal;
  }

  /**
   * Remove a progress modal
   */
  closeProgress(modal: blessed.Widgets.BoxElement): void {
    this.screen.remove(modal);
    modal.destroy();
    this.screen.render();
  }
}

// Types
interface CreateModalOptions {
  title: string;
  width?: string | number;
  height?: string | number;
  borderColor?: string;
  onClose: () => void;
}

interface ModalContext {
  element: blessed.Widgets.BoxElement;
  overlay: blessed.Widgets.BoxElement;
  handlers: Map<string, () => void>;
}
