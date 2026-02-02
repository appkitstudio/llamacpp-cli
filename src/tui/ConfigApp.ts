import blessed from 'blessed';
import * as path from 'path';
import { ServerConfig, sanitizeModelName } from '../types/server-config.js';
import { stateManager } from '../lib/state-manager.js';
import { launchctlManager } from '../lib/launchctl-manager.js';
import { statusChecker } from '../lib/status-checker.js';
import { portManager } from '../lib/port-manager.js';
import { modelScanner } from '../lib/model-scanner.js';
import { ModelInfo } from '../types/model-info.js';
import { getLogsDir, getLaunchAgentsDir } from '../utils/file-utils.js';
import { autoRotateIfNeeded } from '../utils/log-utils.js';

interface ConfigField {
  key: string;
  label: string;
  type: 'model' | 'number' | 'text' | 'toggle' | 'select';
  value: any;
  originalValue: any;
  options?: string[];
  validation?: (value: any) => string | null; // Returns error message or null if valid
}

interface ConfigState {
  fields: ConfigField[];
  selectedIndex: number;
  hasChanges: boolean;
}

/**
 * Config screen TUI for editing server configuration
 */
export async function createConfigUI(
  screen: blessed.Widgets.Screen,
  server: ServerConfig,
  onBack: (updatedServer?: ServerConfig) => void
): Promise<void> {
  // Initialize state
  const state: ConfigState = {
    fields: [
      {
        key: 'model',
        label: 'Model',
        type: 'model',
        value: server.modelName,
        originalValue: server.modelName,
      },
      {
        key: 'host',
        label: 'Host',
        type: 'select',
        value: server.host || '127.0.0.1',
        originalValue: server.host || '127.0.0.1',
        options: ['127.0.0.1', '0.0.0.0'],
      },
      {
        key: 'port',
        label: 'Port',
        type: 'number',
        value: server.port,
        originalValue: server.port,
        validation: (value: number) => {
          if (value < 1024) return 'Port must be >= 1024';
          if (value > 65535) return 'Port must be <= 65535';
          return null;
        },
      },
      {
        key: 'threads',
        label: 'Threads',
        type: 'number',
        value: server.threads,
        originalValue: server.threads,
        validation: (value: number) => {
          if (value < 1) return 'Must be at least 1';
          if (value > 256) return 'Must be at most 256';
          return null;
        },
      },
      {
        key: 'ctxSize',
        label: 'Context Size',
        type: 'number',
        value: server.ctxSize,
        originalValue: server.ctxSize,
        validation: (value: number) => {
          if (value < 512) return 'Must be at least 512';
          if (value > 131072) return 'Must be at most 131072';
          return null;
        },
      },
      {
        key: 'gpuLayers',
        label: 'GPU Layers',
        type: 'number',
        value: server.gpuLayers,
        originalValue: server.gpuLayers,
        validation: (value: number) => {
          if (value < 0) return 'Must be at least 0';
          if (value > 999) return 'Must be at most 999';
          return null;
        },
      },
      {
        key: 'verbose',
        label: 'Verbose Logs',
        type: 'toggle',
        value: server.verbose,
        originalValue: server.verbose,
        options: ['Disabled', 'Enabled'],
      },
      {
        key: 'customFlags',
        label: 'Custom Flags',
        type: 'text',
        value: server.customFlags?.join(', ') || '',
        originalValue: server.customFlags?.join(', ') || '',
      },
    ],
    selectedIndex: 0,
    hasChanges: false,
  };

  // Create content box
  const contentBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: '█',
      style: { fg: 'blue' },
    },
  });
  screen.append(contentBox);

  // Check if any field has changed
  function updateHasChanges(): void {
    state.hasChanges = state.fields.some(f => {
      if (typeof f.value === 'string' && typeof f.originalValue === 'string') {
        return f.value.trim() !== f.originalValue.trim();
      }
      return f.value !== f.originalValue;
    });
  }

  // Format display value for a field
  function formatValue(field: ConfigField): string {
    if (field.type === 'toggle') {
      return field.value ? 'Enabled' : 'Disabled';
    }
    if (field.type === 'text' && !field.value) {
      return '(none)';
    }
    if (field.type === 'number') {
      // Don't use commas for port numbers
      if (field.key === 'port') {
        return String(field.value);
      }
      return field.value.toLocaleString();
    }
    return String(field.value);
  }

  // Render the main config screen
  function render(): void {
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += `{bold}{blue-fg}═══ Configure: ${server.id} (${server.port}){/blue-fg}{/bold}\n\n`;

    // Section header
    content += '{bold}Server Configuration{/bold}\n';
    content += divider + '\n';

    // Fields
    for (let i = 0; i < state.fields.length; i++) {
      const field = state.fields[i];
      const isSelected = i === state.selectedIndex;
      const hasChanged = field.value !== field.originalValue;

      const indicator = isSelected ? '►' : ' ';
      const label = field.label.padEnd(16);
      const value = formatValue(field);

      // Color coding: cyan for selected, yellow for changed
      let valueDisplay = value;
      if (hasChanged) {
        valueDisplay = `{yellow-fg}${value}{/yellow-fg}`;
      }

      if (isSelected) {
        content += `{cyan-bg}{15-fg}  ${indicator} ${label}${value}{/15-fg}{/cyan-bg}\n`;
      } else {
        content += `  ${indicator} ${label}${valueDisplay}\n`;
      }
    }

    content += divider + '\n\n';

    // Show changes summary if any
    if (state.hasChanges) {
      content += '{yellow-fg}* Unsaved Changes:{/yellow-fg}\n';
      for (const field of state.fields) {
        if (field.value !== field.originalValue) {
          const oldVal = field.type === 'toggle'
            ? (field.originalValue ? 'Enabled' : 'Disabled')
            : (field.originalValue || '(none)');
          const newVal = field.type === 'toggle'
            ? (field.value ? 'Enabled' : 'Disabled')
            : (field.value || '(none)');
          content += `  ${field.label}: ${oldVal} → {yellow-fg}${newVal}{/yellow-fg}\n`;
        }
      }
      content += '\n';
    }

    // Footer
    content += divider + '\n';
    content += '{gray-fg}[↑/↓] Navigate  [Enter] Edit  [S]ave  [ESC] Cancel{/gray-fg}';

    contentBox.setContent(content);
    screen.render();
  }

  // Create a centered modal box
  function createModal(title: string, height: number | string = 'shrink'): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        fg: 'white',
      },
      tags: true,
      label: ` ${title} `,
    });
  }

  // Number input modal
  async function editNumber(field: ConfigField): Promise<void> {
    unregisterHandlers();
    return new Promise((resolve) => {
      const modal = createModal(`Edit ${field.label}`, 10);

      const infoText = blessed.text({
        parent: modal,
        top: 1,
        left: 2,
        content: `Current: ${field.value}`,
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

      const helpText = blessed.text({
        parent: modal,
        bottom: 1,
        left: 2,
        content: '{gray-fg}[Enter] Confirm  [ESC] Cancel{/gray-fg}',
        tags: true,
      });

      inputBox.setValue(String(field.value));
      screen.render();
      inputBox.focus();

      inputBox.on('submit', (value: string) => {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
          if (field.validation) {
            const error = field.validation(numValue);
            if (error) {
              infoText.setContent(`{red-fg}Error: ${error}{/red-fg}`);
              screen.render();
              inputBox.focus();
              return;
            }
          }
          field.value = numValue;
          updateHasChanges();
        }
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });

      inputBox.on('cancel', () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });

      inputBox.key(['escape'], () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });
    });
  }

  // Toggle/select modal
  async function editSelect(field: ConfigField): Promise<void> {
    unregisterHandlers();
    return new Promise((resolve) => {
      const options = field.options || [];
      let selectedOption = field.type === 'toggle'
        ? (field.value ? 1 : 0)
        : options.indexOf(String(field.value));
      if (selectedOption < 0) selectedOption = 0;

      const modal = createModal(field.label, options.length + 6);

      function renderOptions(): void {
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

        // Add warning for 0.0.0.0
        if (field.key === 'host' && options[selectedOption] === '0.0.0.0') {
          content += '\n  {yellow-fg}⚠ Warning: Exposes server to network{/yellow-fg}';
        }

        content += '\n\n{gray-fg}  [↑/↓] Select  [Enter] Confirm  [ESC] Cancel{/gray-fg}';
        modal.setContent(content);
        screen.render();
      }

      renderOptions();
      modal.focus();

      modal.key(['up', 'k'], () => {
        selectedOption = Math.max(0, selectedOption - 1);
        renderOptions();
      });

      modal.key(['down', 'j'], () => {
        selectedOption = Math.min(options.length - 1, selectedOption + 1);
        renderOptions();
      });

      modal.key(['enter'], () => {
        if (field.type === 'toggle') {
          field.value = selectedOption === 1;
        } else {
          field.value = options[selectedOption];
        }
        updateHasChanges();
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });

      modal.key(['escape'], () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });
    });
  }

  // Text input modal
  async function editText(field: ConfigField): Promise<void> {
    unregisterHandlers();
    return new Promise((resolve) => {
      const modal = createModal(`Edit ${field.label}`, 10);

      const infoText = blessed.text({
        parent: modal,
        top: 1,
        left: 2,
        content: 'Enter comma-separated flags:',
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

      const helpText = blessed.text({
        parent: modal,
        bottom: 1,
        left: 2,
        content: '{gray-fg}[Enter] Confirm  [ESC] Cancel{/gray-fg}',
        tags: true,
      });

      inputBox.setValue(field.value || '');
      screen.render();
      inputBox.focus();

      inputBox.on('submit', (value: string) => {
        field.value = value.trim();
        updateHasChanges();
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });

      inputBox.on('cancel', () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });

      inputBox.key(['escape'], () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });
    });
  }

  // Model picker modal
  async function editModel(field: ConfigField): Promise<void> {
    unregisterHandlers();
    return new Promise(async (resolve) => {
      const models = await modelScanner.scanModels();
      if (models.length === 0) {
        // Show error modal
        const errorModal = createModal('Error', 7);
        errorModal.setContent('\n  {red-fg}No models found in ~/models{/red-fg}\n\n  {gray-fg}[ESC] Close{/gray-fg}');
        screen.render();
        errorModal.focus();
        errorModal.key(['escape', 'enter'], () => {
          screen.remove(errorModal);
          registerHandlers();
          render();
          resolve();
        });
        return;
      }

      let selectedIndex = models.findIndex(m => m.filename === field.value);
      if (selectedIndex < 0) selectedIndex = 0;
      let scrollOffset = 0;
      const maxVisible = 8;

      const modal = createModal('Select Model', maxVisible + 6);

      function renderModels(): void {
        // Adjust scroll offset
        if (selectedIndex < scrollOffset) {
          scrollOffset = selectedIndex;
        } else if (selectedIndex >= scrollOffset + maxVisible) {
          scrollOffset = selectedIndex - maxVisible + 1;
        }

        let content = '\n';
        const visibleModels = models.slice(scrollOffset, scrollOffset + maxVisible);

        for (let i = 0; i < visibleModels.length; i++) {
          const model = visibleModels[i];
          const actualIndex = scrollOffset + i;
          const isSelected = actualIndex === selectedIndex;
          const indicator = isSelected ? '►' : ' ';

          // Truncate filename if too long
          let displayName = model.filename;
          const maxLen = 40;
          if (displayName.length > maxLen) {
            displayName = displayName.substring(0, maxLen - 3) + '...';
          }
          displayName = displayName.padEnd(maxLen);

          const size = model.sizeFormatted.padStart(8);

          if (isSelected) {
            content += `  {cyan-bg}{15-fg}${indicator} ${displayName} ${size}{/15-fg}{/cyan-bg}\n`;
          } else {
            content += `  ${indicator} ${displayName} {gray-fg}${size}{/gray-fg}\n`;
          }
        }

        // Scroll indicator
        if (models.length > maxVisible) {
          const scrollInfo = `${selectedIndex + 1}/${models.length}`;
          content += `\n  {gray-fg}${scrollInfo}{/gray-fg}`;
        }

        content += '\n\n{gray-fg}  [↑/↓] Navigate  [Enter] Select  [ESC] Cancel{/gray-fg}';
        modal.setContent(content);
        screen.render();
      }

      renderModels();
      modal.focus();

      modal.key(['up', 'k'], () => {
        selectedIndex = Math.max(0, selectedIndex - 1);
        renderModels();
      });

      modal.key(['down', 'j'], () => {
        selectedIndex = Math.min(models.length - 1, selectedIndex + 1);
        renderModels();
      });

      modal.key(['enter'], () => {
        field.value = models[selectedIndex].filename;
        updateHasChanges();
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });

      modal.key(['escape'], () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });
    });
  }

  // Show unsaved changes dialog
  async function showUnsavedDialog(): Promise<'save' | 'discard' | 'continue'> {
    unregisterHandlers();
    return new Promise((resolve) => {
      const modal = createModal('Unsaved Changes', 10);

      let selectedOption = 0;
      const options = [
        { key: 'save', label: '[S]ave and exit' },
        { key: 'discard', label: '[D]iscard changes' },
        { key: 'continue', label: '[C]ontinue editing' },
      ];

      function renderDialog(): void {
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
        screen.render();
      }

      renderDialog();
      modal.focus();

      modal.key(['up', 'k'], () => {
        selectedOption = Math.max(0, selectedOption - 1);
        renderDialog();
      });

      modal.key(['down', 'j'], () => {
        selectedOption = Math.min(options.length - 1, selectedOption + 1);
        renderDialog();
      });

      modal.key(['enter'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve(options[selectedOption].key as 'save' | 'discard' | 'continue');
      });

      modal.key(['s', 'S'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve('save');
      });

      modal.key(['d', 'D'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve('discard');
      });

      modal.key(['c', 'C', 'escape'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve('continue');
      });
    });
  }

  // Show restart confirmation dialog
  async function showRestartDialog(): Promise<boolean> {
    unregisterHandlers();
    return new Promise((resolve) => {
      const modal = createModal('Server is Running', 10);

      let selectedOption = 0;
      const options = [
        { key: true, label: '[Y]es - Restart now' },
        { key: false, label: '[N]o - Apply later' },
      ];

      function renderDialog(): void {
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
        screen.render();
      }

      renderDialog();
      modal.focus();

      modal.key(['up', 'k'], () => {
        selectedOption = Math.max(0, selectedOption - 1);
        renderDialog();
      });

      modal.key(['down', 'j'], () => {
        selectedOption = Math.min(options.length - 1, selectedOption + 1);
        renderDialog();
      });

      modal.key(['enter'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve(options[selectedOption].key);
      });

      modal.key(['y', 'Y'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve(true);
      });

      modal.key(['n', 'N', 'escape'], () => {
        screen.remove(modal);
        registerHandlers();
        resolve(false);
      });
    });
  }

  // Show saving progress
  function showProgress(message: string): blessed.Widgets.BoxElement {
    const modal = createModal('Saving', 5);
    modal.setContent(`\n  {cyan-fg}⏳ ${message}{/cyan-fg}`);
    screen.render();
    return modal;
  }

  // Show error message
  async function showError(message: string): Promise<void> {
    unregisterHandlers();
    return new Promise((resolve) => {
      const modal = createModal('Error', 8);
      modal.setContent(`\n  {red-fg}❌ ${message}{/red-fg}\n\n  {gray-fg}[Enter] Close{/gray-fg}`);
      screen.render();
      modal.focus();
      modal.key(['enter', 'escape'], () => {
        screen.remove(modal);
        registerHandlers();
        render();
        resolve();
      });
    });
  }

  // Save changes
  async function saveChanges(): Promise<ServerConfig | null> {
    // Build updates object
    const modelField = state.fields.find(f => f.key === 'model')!;
    const hostField = state.fields.find(f => f.key === 'host')!;
    const portField = state.fields.find(f => f.key === 'port')!;
    const threadsField = state.fields.find(f => f.key === 'threads')!;
    const ctxSizeField = state.fields.find(f => f.key === 'ctxSize')!;
    const gpuLayersField = state.fields.find(f => f.key === 'gpuLayers')!;
    const verboseField = state.fields.find(f => f.key === 'verbose')!;
    const customFlagsField = state.fields.find(f => f.key === 'customFlags')!;

    // Check for port conflict if port changed
    if (portField.value !== portField.originalValue) {
      const hasConflict = await portManager.checkPortConflict(portField.value, server.id);
      if (hasConflict) {
        await showError(`Port ${portField.value} is already in use by another server`);
        return null;
      }
    }

    // Check if model changed (requires migration)
    let newModelPath: string | undefined;
    let newModelName: string | undefined;
    let newServerId: string | undefined;
    let isModelMigration = false;

    if (modelField.value !== modelField.originalValue) {
      const resolvedPath = await modelScanner.resolveModelPath(modelField.value);
      if (!resolvedPath) {
        await showError(`Model not found: ${modelField.value}`);
        return null;
      }
      newModelPath = resolvedPath;
      newModelName = modelField.value;
      newServerId = sanitizeModelName(modelField.value);

      if (newServerId !== server.id) {
        isModelMigration = true;
        const existingServer = await stateManager.loadServerConfig(newServerId);
        if (existingServer) {
          await showError(`Server ID "${newServerId}" already exists. Delete it first.`);
          return null;
        }
      }
    }

    // Check if server is running and prompt for restart
    const currentStatus = await statusChecker.updateServerStatus(server);
    const wasRunning = currentStatus.status === 'running';
    let shouldRestart = false;

    if (wasRunning) {
      shouldRestart = await showRestartDialog();
    }

    // Show progress
    const progressModal = showProgress('Saving configuration...');

    try {
      // Parse custom flags
      const customFlags = customFlagsField.value
        ? customFlagsField.value.split(',').map((f: string) => f.trim()).filter((f: string) => f.length > 0)
        : undefined;

      if (isModelMigration && newServerId && newModelPath && newModelName) {
        // Model migration path
        if (wasRunning) {
          progressModal.setContent('\n  {cyan-fg}⏳ Stopping old server...{/cyan-fg}');
          screen.render();
          await launchctlManager.unloadService(server.plistPath);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        progressModal.setContent('\n  {cyan-fg}⏳ Removing old configuration...{/cyan-fg}');
        screen.render();

        try {
          await launchctlManager.deletePlist(server.plistPath);
        } catch (err) {
          // Plist might not exist
        }
        await stateManager.deleteServerConfig(server.id);

        // Create new config with new ID
        const logsDir = getLogsDir();
        const plistDir = getLaunchAgentsDir();

        const newConfig: ServerConfig = {
          ...server,
          id: newServerId,
          modelPath: newModelPath,
          modelName: newModelName,
          host: hostField.value,
          port: portField.value,
          threads: threadsField.value,
          ctxSize: ctxSizeField.value,
          gpuLayers: gpuLayersField.value,
          verbose: verboseField.value,
          customFlags: customFlags && customFlags.length > 0 ? customFlags : undefined,
          label: `com.llama.${newServerId}`,
          plistPath: path.join(plistDir, `com.llama.${newServerId}.plist`),
          stdoutPath: path.join(logsDir, `${newServerId}.stdout`),
          stderrPath: path.join(logsDir, `${newServerId}.stderr`),
          status: 'stopped',
          pid: undefined,
          lastStopped: new Date().toISOString(),
        };

        progressModal.setContent('\n  {cyan-fg}⏳ Creating new configuration...{/cyan-fg}');
        screen.render();

        await stateManager.saveServerConfig(newConfig);
        await launchctlManager.createPlist(newConfig);

        if (shouldRestart) {
          progressModal.setContent('\n  {cyan-fg}⏳ Starting new server...{/cyan-fg}');
          screen.render();

          await launchctlManager.loadService(newConfig.plistPath);
          await launchctlManager.startService(newConfig.label);
          await new Promise(resolve => setTimeout(resolve, 2000));

          const finalStatus = await statusChecker.updateServerStatus(newConfig);
          screen.remove(progressModal);
          return finalStatus;
        }

        screen.remove(progressModal);
        return newConfig;
      } else {
        // Normal config update (no migration)
        if (wasRunning && shouldRestart) {
          progressModal.setContent('\n  {cyan-fg}⏳ Stopping server...{/cyan-fg}');
          screen.render();
          await launchctlManager.unloadService(server.plistPath);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const updatedConfig: Partial<ServerConfig> = {
          host: hostField.value,
          port: portField.value,
          threads: threadsField.value,
          ctxSize: ctxSizeField.value,
          gpuLayers: gpuLayersField.value,
          verbose: verboseField.value,
          customFlags: customFlags && customFlags.length > 0 ? customFlags : undefined,
        };

        if (newModelPath && newModelName) {
          updatedConfig.modelPath = newModelPath;
          updatedConfig.modelName = newModelName;
        }

        progressModal.setContent('\n  {cyan-fg}⏳ Updating configuration...{/cyan-fg}');
        screen.render();

        await stateManager.updateServerConfig(server.id, updatedConfig);

        // Regenerate plist
        const fullConfig = await stateManager.loadServerConfig(server.id);
        if (fullConfig) {
          await launchctlManager.createPlist(fullConfig);

          if (wasRunning && shouldRestart) {
            // Auto-rotate logs if needed
            try {
              await autoRotateIfNeeded(fullConfig.stdoutPath, fullConfig.stderrPath, 100);
            } catch (err) {
              // Non-fatal
            }

            progressModal.setContent('\n  {cyan-fg}⏳ Starting server...{/cyan-fg}');
            screen.render();

            await launchctlManager.loadService(fullConfig.plistPath);
            await launchctlManager.startService(fullConfig.label);
            await new Promise(resolve => setTimeout(resolve, 2000));

            const finalStatus = await statusChecker.updateServerStatus(fullConfig);
            screen.remove(progressModal);
            return finalStatus;
          }

          screen.remove(progressModal);
          return fullConfig;
        }
      }
    } catch (err) {
      screen.remove(progressModal);
      await showError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }

    screen.remove(progressModal);
    return null;
  }

  // Handle edit action for selected field
  async function handleEdit(): Promise<void> {
    const field = state.fields[state.selectedIndex];

    switch (field.type) {
      case 'number':
        await editNumber(field);
        break;
      case 'toggle':
      case 'select':
        await editSelect(field);
        break;
      case 'text':
        await editText(field);
        break;
      case 'model':
        await editModel(field);
        break;
    }
  }

  // Handle escape/cancel
  async function handleEscape(): Promise<void> {
    if (state.hasChanges) {
      const result = await showUnsavedDialog();
      if (result === 'save') {
        const updated = await saveChanges();
        cleanup();
        onBack(updated || undefined);
      } else if (result === 'discard') {
        cleanup();
        onBack();
      }
      // 'continue' - just return to config screen
      render();
    } else {
      cleanup();
      onBack();
    }
  }

  // Handle save
  async function handleSave(): Promise<void> {
    if (!state.hasChanges) {
      cleanup();
      onBack();
      return;
    }

    const updated = await saveChanges();
    if (updated) {
      cleanup();
      onBack(updated);
    } else {
      render();
    }
  }

  // Key handlers
  const keyHandlers = {
    up: () => {
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      render();
    },
    down: () => {
      state.selectedIndex = Math.min(state.fields.length - 1, state.selectedIndex + 1);
      render();
    },
    enter: () => {
      handleEdit();
    },
    save: () => {
      handleSave();
    },
    escape: () => {
      handleEscape();
    },
    quit: () => {
      screen.destroy();
      process.exit(0);
    },
  };

  // Unregister handlers (for modal dialogs)
  function unregisterHandlers(): void {
    screen.unkey('up', keyHandlers.up);
    screen.unkey('k', keyHandlers.up);
    screen.unkey('down', keyHandlers.down);
    screen.unkey('j', keyHandlers.down);
    screen.unkey('enter', keyHandlers.enter);
    screen.unkey('s', keyHandlers.save);
    screen.unkey('S', keyHandlers.save);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
  }

  // Register handlers
  function registerHandlers(): void {
    screen.key(['up', 'k'], keyHandlers.up);
    screen.key(['down', 'j'], keyHandlers.down);
    screen.key(['enter'], keyHandlers.enter);
    screen.key(['s', 'S'], keyHandlers.save);
    screen.key(['escape'], keyHandlers.escape);
    screen.key(['q', 'Q'], keyHandlers.quit);
  }

  // Cleanup function (for exiting config screen)
  function cleanup(): void {
    unregisterHandlers();
    screen.remove(contentBox);
  }

  // Initial registration
  registerHandlers();

  // Initial render
  render();
}
