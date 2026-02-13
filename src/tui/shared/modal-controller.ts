import * as blessed from 'blessed';

/**
 * Modal controller that properly isolates keyboard handling
 *
 * Key features:
 * - Completely disables screen keyboard handling while modal is open
 * - Prevents event bubbling from modal to screen
 * - Manages modal lifecycle with proper cleanup
 * - Provides consistent API for all modal types
 */
export class ModalController {
  private screen: blessed.Widgets.Screen;
  private modalStack: ModalContext[] = [];

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
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
   * Create semi-transparent overlay to block interaction with screen behind modal
   */
  private createOverlay(): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: {
        bg: 'black',
        transparent: true,
      },
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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeModal = () => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve();
      };

      modal.key(['enter', 'escape'], closeModal);

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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeModal = () => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve();
      };

      modal.key(['enter', 'escape'], closeModal);

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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeWithResult = (result: 'save' | 'discard' | 'continue') => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      modal.key(['up', 'k'], () => {
        selectedOption = Math.max(0, selectedOption - 1);
        renderDialog();
      });

      modal.key(['down', 'j'], () => {
        selectedOption = Math.min(options.length - 1, selectedOption + 1);
        renderDialog();
      });

      modal.key(['enter'], () => closeWithResult(options[selectedOption].key));
      modal.key(['s', 'S'], () => closeWithResult('save'));
      modal.key(['d', 'D'], () => closeWithResult('discard'));
      modal.key(['c', 'C', 'escape'], () => closeWithResult('continue'));

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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeWithResult = (result: boolean) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      modal.key(['up', 'k'], () => {
        selectedOption = Math.max(0, selectedOption - 1);
        renderDialog();
      });

      modal.key(['down', 'j'], () => {
        selectedOption = Math.min(options.length - 1, selectedOption + 1);
        renderDialog();
      });

      modal.key(['enter'], () => closeWithResult(options[selectedOption].key));
      modal.key(['y', 'Y'], () => closeWithResult(true));
      modal.key(['n', 'N', 'escape'], () => closeWithResult(false));

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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeWithResult = (result: number | null) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeWithResult = (result: string | null) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

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

      const context: ModalContext = {
        element: modal,
        handlers: new Map(),
        overlay: this.createOverlay(),
      };

      this.modalStack.push(context);

      const closeWithResult = (result: string | boolean | null) => {
        this.screen.remove(modal);
        this.screen.remove(context.overlay);
        this.modalStack.pop();
        this.screen.render();

        // Re-register handlers synchronously to prevent keyboard input loss
        if (this.modalStack.length === 0) {
          onClose();
        }

        // Resolve after handlers are registered
        resolve(result);
      };

      modal.key(['up', 'k'], () => {
        selectedOption = Math.max(0, selectedOption - 1);
        renderOptions();
      });

      modal.key(['down', 'j'], () => {
        selectedOption = Math.min(options.length - 1, selectedOption + 1);
        renderOptions();
      });

      modal.key(['enter'], () => {
        if (isToggle) {
          closeWithResult(selectedOption === 1);
        } else {
          closeWithResult(options[selectedOption]);
        }
      });

      modal.key(['escape'], () => {
        closeWithResult(null);
      });

      this.screen.append(context.overlay);
      this.screen.append(modal);
      modal.focus();
      renderOptions();
    });
  }

  /**
   * Show a progress modal (non-interactive)
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
