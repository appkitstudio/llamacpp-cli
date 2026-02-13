import blessed from 'blessed';
import { RouterConfig } from '../types/router-config.js';
import { routerManager } from '../lib/router-manager.js';
import { fileExists, getLogsDir } from '../utils/file-utils.js';
import { getFileSize, formatFileSize } from '../utils/log-utils.js';
import { ModalController } from './shared/modal-controller.js';

type RouterView = 'status' | 'config' | 'logs';

interface ConfigField {
  key: keyof RouterConfig;
  label: string;
  type: 'number' | 'text' | 'toggle' | 'select';
  value: any;
  originalValue: any;
  options?: string[];
  validation?: (value: any) => string | null;
}

interface RouterState {
  config: RouterConfig | null;
  view: RouterView;
  fields: ConfigField[];
  selectedIndex: number;
  hasChanges: boolean;
  isRunning: boolean;
  pid: number | null;
  logType: 'stdout' | 'stderr';
  logsLastUpdated: Date | null;
  logsRefreshInterval: NodeJS.Timeout | null;
}

/**
 * Router management TUI
 */
export async function createRouterUI(
  screen: blessed.Widgets.Screen,
  onBack: () => void
): Promise<void> {
  // Load initial config
  const initialConfig = await routerManager.loadConfig();
  const initialStatus = initialConfig
    ? await routerManager.getServiceStatus(initialConfig.label)
    : null;

  // Initialize state
  const state: RouterState = {
    config: initialConfig,
    view: 'status',
    fields: [],
    selectedIndex: 0,
    hasChanges: false,
    isRunning: initialStatus?.isRunning || false,
    pid: initialStatus?.pid || null,
    logType: 'stdout',
    logsLastUpdated: null,
    logsRefreshInterval: null,
  };

  // Modal controller for centralized keyboard handling
  const modalController = new ModalController(screen);

  // Initialize fields from config
  if (initialConfig) {
    state.fields = [
      {
        key: 'port',
        label: 'Port',
        type: 'number',
        value: initialConfig.port,
        originalValue: initialConfig.port,
        validation: (value: number) => {
          if (value < 1024) return 'Port must be >= 1024';
          if (value > 65535) return 'Port must be <= 65535';
          return null;
        },
      },
      {
        key: 'host',
        label: 'Host',
        type: 'select',
        value: initialConfig.host,
        originalValue: initialConfig.host,
        options: ['127.0.0.1', '0.0.0.0'],
      },
      {
        key: 'verbose',
        label: 'Verbose Logs',
        type: 'toggle',
        value: initialConfig.verbose,
        originalValue: initialConfig.verbose,
        options: ['Disabled', 'Enabled'],
      },
      {
        key: 'healthCheckInterval',
        label: 'Health Check (ms)',
        type: 'number',
        value: initialConfig.healthCheckInterval,
        originalValue: initialConfig.healthCheckInterval,
        validation: (value: number) => {
          if (value < 1000) return 'Must be at least 1000ms';
          if (value > 60000) return 'Must be at most 60000ms';
          return null;
        },
      },
      {
        key: 'requestTimeout',
        label: 'Request Timeout (ms)',
        type: 'number',
        value: initialConfig.requestTimeout,
        originalValue: initialConfig.requestTimeout,
        validation: (value: number) => {
          if (value < 5000) return 'Must be at least 5000ms';
          if (value > 600000) return 'Must be at most 600000ms';
          return null;
        },
      },
    ];
  }

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

  // Refresh status
  async function refreshStatus(): Promise<void> {
    const config = await routerManager.loadConfig();
    state.config = config;
    if (config) {
      const status = await routerManager.getServiceStatus(config.label);
      state.isRunning = status.isRunning;
      state.pid = status.pid;
    }
  }

  // Check if any field has changed
  function updateHasChanges(): void {
    state.hasChanges = state.fields.some(f => f.value !== f.originalValue);
  }

  // Format display value for a field
  function formatValue(field: ConfigField): string {
    if (field.type === 'toggle') {
      return field.value ? 'Enabled' : 'Disabled';
    }
    if (field.type === 'number') {
      // Port numbers should not have thousand separators
      if (field.key === 'port') {
        return String(field.value);
      }
      // Intervals and timeouts can have commas for readability
      return field.value.toLocaleString();
    }
    return String(field.value);
  }

  // Render status view
  function renderStatus(): void {
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += `{bold}{blue-fg}═══ Router Management{/blue-fg}{/bold}\n\n`;

    if (!state.config) {
      content += '{yellow-fg}Router not configured{/yellow-fg}\n';
      content += 'Use [S]tart to create router configuration\n\n';
      content += divider + '\n';
      content += '{gray-fg}[S]tart [ESC] Back [Q]uit{/gray-fg}';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Status section
    content += '{bold}Status{/bold}\n';
    content += divider + '\n';

    const statusColor = state.isRunning ? 'green' : 'gray';
    const statusText = state.isRunning ? 'RUNNING' : 'STOPPED';
    content += `Status:          {${statusColor}-fg}${statusText}{/${statusColor}-fg}\n`;

    if (state.pid) {
      content += `PID:             ${state.pid}\n`;
    }

    content += `URL:             http://${state.config.host}:${state.config.port}\n`;

    if (state.config.lastStarted) {
      const lastStarted = new Date(state.config.lastStarted);
      content += `Last Started:    ${lastStarted.toLocaleString()}\n`;
    }

    if (state.config.lastStopped) {
      const lastStopped = new Date(state.config.lastStopped);
      content += `Last Stopped:    ${lastStopped.toLocaleString()}\n`;
    }

    content += '\n';

    // Configuration summary (read-only)
    content += '{bold}Configuration{/bold}\n';
    content += divider + '\n';
    content += `Port:                    ${state.config.port}\n`;
    content += `Host:                    ${state.config.host}\n`;
    content += `Verbose Logs:            ${state.config.verbose ? 'Enabled' : 'Disabled'}\n`;
    content += `Health Check Interval:   ${state.config.healthCheckInterval.toLocaleString()}ms\n`;
    content += `Request Timeout:         ${state.config.requestTimeout.toLocaleString()}ms\n`;
    content += '\n';

    // Show unsaved changes warning if any
    if (state.hasChanges) {
      content += '{yellow-fg}⚠ Configuration has unsaved changes{/yellow-fg}\n';
      content += 'Press [C]onfig to review and save\n\n';
    }

    // Footer
    content += divider + '\n';
    if (state.isRunning) {
      content += '{gray-fg}[S]top [R]estart [C]onfig [L]ogs [ESC] Back [Q]uit{/gray-fg}';
    } else {
      content += '{gray-fg}[S]tart [C]onfig [L]ogs [ESC] Back [Q]uit{/gray-fg}';
    }

    contentBox.setContent(content);
    screen.render();
  }

  // Render config view
  function renderConfig(): void {
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += `{bold}{blue-fg}═══ Router Configuration{/blue-fg}{/bold}\n\n`;

    // Configuration fields
    for (let i = 0; i < state.fields.length; i++) {
      const field = state.fields[i];
      const isSelected = i === state.selectedIndex;
      const hasChanged = field.value !== field.originalValue;

      const indicator = isSelected ? '►' : ' ';
      const label = field.label.padEnd(20);
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

    content += '\n';

    // Show changes summary if any
    if (state.hasChanges) {
      content += '{yellow-fg}* Unsaved Changes:{/yellow-fg}\n';
      for (const field of state.fields) {
        if (field.value !== field.originalValue) {
          const oldVal = field.type === 'toggle'
            ? (field.originalValue ? 'Enabled' : 'Disabled')
            : field.originalValue;
          const newVal = field.type === 'toggle'
            ? (field.value ? 'Enabled' : 'Disabled')
            : field.value;
          content += `  ${field.label}: ${oldVal} → {yellow-fg}${newVal}{/yellow-fg}\n`;
        }
      }
      content += '\n';
    }

    // Footer
    content += divider + '\n';
    content += '{gray-fg}[↑/↓] Navigate [Enter] Edit [S]ave [ESC] Back [Q]uit{/gray-fg}';

    contentBox.setContent(content);
    screen.render();
  }

  // Render logs view
  async function renderLogs(): Promise<void> {
    if (!state.config) return;

    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    const logTypeLabel = state.logType === 'stdout' ? 'Activity' : 'System';
    content += `{bold}{blue-fg}═══ Router Logs (${logTypeLabel}){/blue-fg}{/bold}\n`;

    // Show last updated time and refresh status
    if (state.logsLastUpdated) {
      const timeStr = state.logsLastUpdated.toLocaleTimeString();
      const refreshStatus = state.logsRefreshInterval ? 'ON' : 'OFF';
      const refreshColor = state.logsRefreshInterval ? 'green' : 'gray';
      content += `{gray-fg}Last updated: ${timeStr} | Auto-refresh: {/${refreshColor}-fg}${refreshStatus}{/${refreshColor}-fg}{/gray-fg}\n\n`;
    } else {
      content += '\n';
    }

    const logPath = state.logType === 'stdout' ? state.config.stdoutPath : state.config.stderrPath;

    // Check if log exists
    if (!(await fileExists(logPath))) {
      content += '{yellow-fg}No logs found{/yellow-fg}\n';
      content += `Log file: ${logPath}\n\n`;
      content += divider + '\n';
      content += '{gray-fg}[T]oggle stdout/stderr [R]efresh [ESC] Back{/gray-fg}';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Show log size
    const size = await getFileSize(logPath);
    content += `File: ${logPath}\n`;
    content += `Size: ${formatFileSize(size)}\n\n`;

    // Show last 30 lines (truncate to fit terminal width)
    try {
      const { execSync } = require('child_process');
      const output = execSync(`tail -n 30 "${logPath}"`, { encoding: 'utf-8' });
      const lines = output.split('\n');

      content += divider + '\n';

      // Calculate max width for log lines (account for borders and padding)
      const maxWidth = termWidth - 4;

      for (const line of lines) {
        if (!line) continue;

        // Remove ANSI color codes to calculate visible length
        const visibleLine = line.replace(/\x1b\[[0-9;]*m/g, '');

        if (visibleLine.length > maxWidth) {
          // Truncate and add ellipsis
          // Keep ANSI codes by truncating the original line at the right position
          let visibleLen = 0;
          let truncated = '';
          for (let i = 0; i < line.length && visibleLen < maxWidth - 3; i++) {
            truncated += line[i];
            // Only count visible characters
            if (line[i] !== '\x1b' && !line.slice(i).match(/^\x1b\[[0-9;]*m/)) {
              visibleLen++;
            } else if (line.slice(i).match(/^\x1b\[[0-9;]*m/)) {
              // Skip the rest of the ANSI code
              const match = line.slice(i).match(/^\x1b\[[0-9;]*m/);
              if (match) {
                truncated += match[0].slice(1);
                i += match[0].length - 1;
              }
            }
          }
          content += truncated + '...\n';
        } else {
          content += line + '\n';
        }
      }

      content += divider + '\n';
    } catch (err) {
      content += '{red-fg}Failed to read logs{/red-fg}\n';
    }

    const toggleRefreshText = state.logsRefreshInterval ? '[F] Pause auto-refresh' : '[F] Resume auto-refresh';
    content += `{gray-fg}[T]oggle stdout/stderr [R]efresh ${toggleRefreshText} [ESC] Back{/gray-fg}`;

    // Update last updated time
    state.logsLastUpdated = new Date();

    contentBox.setContent(content);
    screen.render();
  }

  // Start logs auto-refresh
  function startLogsAutoRefresh(): void {
    // Clear any existing interval
    if (state.logsRefreshInterval) {
      clearInterval(state.logsRefreshInterval);
    }

    // Set up auto-refresh every 3 seconds
    state.logsRefreshInterval = setInterval(() => {
      if (state.view === 'logs') {
        renderLogs();
      }
    }, 3000);
  }

  // Stop logs auto-refresh
  function stopLogsAutoRefresh(): void {
    if (state.logsRefreshInterval) {
      clearInterval(state.logsRefreshInterval);
      state.logsRefreshInterval = null;
    }
  }

  // Render current view
  async function render(): Promise<void> {
    // Re-register handlers based on current view (for context-sensitive keys)
    unregisterHandlers();
    registerHandlers();

    if (state.view === 'status') {
      stopLogsAutoRefresh();
      renderStatus();
    } else if (state.view === 'config') {
      stopLogsAutoRefresh();
      renderConfig();
    } else if (state.view === 'logs') {
      await renderLogs();
      startLogsAutoRefresh();
    }
  }

  // Create a centered modal box
  // Modal helper functions now use ModalController
  /**
   * Show error modal
   * @param message - Error message to display
   * @param onClose - Optional callback when modal closes. Defaults to registering handlers + render.
   *                  Pass empty function for complex flows where outer function manages handlers.
   */
  async function showError(message: string, onClose?: () => void): Promise<void> {
    await modalController.showError(message, onClose || (() => {
      registerHandlers();
      render();
    }));
  }

  /**
   * Show success modal
   * @param message - Success message to display
   * @param onClose - Optional callback when modal closes. Defaults to registering handlers + render.
   *                  Pass empty function for complex flows where outer function manages handlers.
   */
  async function showSuccess(message: string, onClose?: () => void): Promise<void> {
    await modalController.showSuccess(message, onClose || (() => {
      registerHandlers();
      render();
    }));
  }

  // Number input modal
  async function editNumber(field: ConfigField): Promise<void> {
    unregisterHandlers(); // Remove screen handlers before modal opens
    const result = await modalController.showNumberInput(
      field.label,
      field.value as number,
      field.validation as ((value: number) => string | null) | undefined,
      () => {
        registerHandlers();
        render();
      }
    );

    if (result !== null) {
      field.value = result;
      updateHasChanges();
      await render();
    }
  }

  // Toggle/select modal
  async function editSelect(field: ConfigField): Promise<void> {
    unregisterHandlers(); // Remove screen handlers before modal opens
    const options = field.options || [];
    const isToggle = field.type === 'toggle';

    const additionalInfo = (selectedValue: string) => {
      if (field.key === 'host' && selectedValue === '0.0.0.0') {
        return '  {yellow-fg}⚠ Warning: Exposes router to network{/yellow-fg}';
      }
      return '';
    };

    const result = await modalController.showSelect(
      field.label,
      options,
      field.value as string | boolean,
      isToggle,
      () => {
        registerHandlers();
        render();
      },
      additionalInfo
    );

    if (result !== null) {
      field.value = result;
      updateHasChanges();
      await render();
    }
  }

  /**
   * Show unsaved changes dialog
   * @param onClose - Optional callback when modal closes. Defaults to registering handlers + render.
   *                  Pass empty function for complex flows where outer function manages handlers.
   */
  async function showUnsavedDialog(onClose?: () => void): Promise<'save' | 'discard' | 'continue'> {
    return modalController.showUnsavedDialog(onClose || (() => {
      registerHandlers();
      render();
    }));
  }

  /**
   * Show restart confirmation dialog
   * @param onClose - Optional callback when modal closes. Defaults to registering handlers + render.
   *                  Pass empty function for complex flows where outer function manages handlers.
   */
  async function showRestartDialog(onClose?: () => void): Promise<boolean> {
    return modalController.showRestartDialog('Router', onClose || (() => {
      registerHandlers();
      render();
    }));
  }

  // Save changes
  async function saveChanges(): Promise<void> {
    if (!state.config) return;

    // Unregister handlers before showing any modals
    unregisterHandlers();

    // Check if router is running and prompt for restart
    const wasRunning = state.isRunning;
    let shouldRestart = false;

    if (wasRunning) {
      // Pass empty onClose - saveChanges() manages handler registration for entire flow
      shouldRestart = await showRestartDialog(() => {});
    }

    // Show progress
    const progressModal = modalController.showProgress('Saving configuration...');

    try {
      // Build updates
      const updates: Partial<RouterConfig> = {};
      for (const field of state.fields) {
        if (field.value !== field.originalValue) {
          (updates as any)[field.key] = field.value;
        }
      }

      if (Object.keys(updates).length > 0) {
        await routerManager.updateConfig(updates);
      }

      if (wasRunning && shouldRestart) {
        progressModal.setContent('\n  {cyan-fg}Restarting router...{/cyan-fg}');
        screen.render();
        await routerManager.restart();
      }

      // Refresh state
      await refreshStatus();

      // Update original values
      for (const field of state.fields) {
        field.originalValue = field.value;
      }
      state.hasChanges = false;

      modalController.closeProgress(progressModal);
      // Pass empty onClose - saveChanges() manages handler registration for entire flow
      await showSuccess('Configuration saved', () => {});
    } catch (err) {
      modalController.closeProgress(progressModal);
      // Pass empty onClose - saveChanges() manages handler registration for entire flow
      await showError(err instanceof Error ? err.message : 'Unknown error', () => {});
    }

    // Re-register handlers after all modals are closed
    registerHandlers();
    render();
  }

  // Start router
  async function startRouter(): Promise<void> {
    const progressModal = modalController.showProgress('Starting router...');

    try {
      await routerManager.start();
      await refreshStatus();

      // Update modal to show success
      progressModal.setContent('\n  {green-fg}✓ Router started{/green-fg}');
      screen.render();
      await new Promise(resolve => setTimeout(resolve, 1000));

      modalController.closeProgress(progressModal);
      render();
    } catch (err) {
      modalController.closeProgress(progressModal);
      await showError(err instanceof Error ? err.message : 'Failed to start router');
    }
  }

  // Stop router
  async function stopRouter(): Promise<void> {
    const progressModal = modalController.showProgress('Stopping router...');

    try {
      await routerManager.stop();
      await refreshStatus();

      // Update modal to show success
      progressModal.setContent('\n  {green-fg}✓ Router stopped{/green-fg}');
      screen.render();
      await new Promise(resolve => setTimeout(resolve, 1000));

      modalController.closeProgress(progressModal);
      render();
    } catch (err) {
      modalController.closeProgress(progressModal);
      await showError(err instanceof Error ? err.message : 'Failed to stop router');
    }
  }

  // Restart router
  async function restartRouter(): Promise<void> {
    const progressModal = modalController.showProgress('Restarting router...');

    try {
      await routerManager.restart();
      await refreshStatus();

      // Update modal to show success
      progressModal.setContent('\n  {green-fg}✓ Router restarted{/green-fg}');
      screen.render();
      await new Promise(resolve => setTimeout(resolve, 1000));

      modalController.closeProgress(progressModal);
      render();
    } catch (err) {
      modalController.closeProgress(progressModal);
      await showError(err instanceof Error ? err.message : 'Failed to restart router');
    }
  }

  // Toggle auto-refresh
  function toggleAutoRefresh(): void {
    if (state.logsRefreshInterval) {
      // Currently on - turn it off
      stopLogsAutoRefresh();
    } else {
      // Currently off - turn it on
      startLogsAutoRefresh();
    }
    renderLogs();  // Re-render to update status
  }

  // Handle edit action for selected field
  async function handleEdit(): Promise<void> {
    if (state.view !== 'config') return;

    const field = state.fields[state.selectedIndex];

    switch (field.type) {
      case 'number':
        await editNumber(field);
        break;
      case 'toggle':
      case 'select':
        await editSelect(field);
        break;
    }
  }

  // Handle escape/cancel
  async function handleEscape(): Promise<void> {
    // Don't handle if modal is open
    if (modalController.isModalOpen()) return;

    if (state.view === 'logs') {
      state.view = 'status';
      await render();
      return;
    }

    if (state.view === 'config') {
      if (state.hasChanges) {
        unregisterHandlers();
        // Pass empty onClose - handleEscape manages handler registration
        const result = await showUnsavedDialog(() => {});
        if (result === 'save') {
          await saveChanges();
          state.view = 'status';
        } else if (result === 'discard') {
          // Reset field values
          for (const field of state.fields) {
            field.value = field.originalValue;
          }
          state.hasChanges = false;
          state.view = 'status';
        }
        // 'continue' - stay in config view
        registerHandlers();
        await render();
      } else {
        state.view = 'status';
        await render();
      }
      return;
    }

    // In status view, exit to main monitor
    if (state.hasChanges) {
      unregisterHandlers();
      // Pass empty onClose - handleEscape manages handler registration
      const result = await showUnsavedDialog(() => {});
      registerHandlers();
      if (result === 'save') {
        await saveChanges();
        cleanup();
        onBack();
      } else if (result === 'discard') {
        cleanup();
        onBack();
      }
      // 'continue' - stay in status view
      await render();
    } else {
      cleanup();
      onBack();
    }
  }

  // Key handlers
  const keyHandlers = {
    up: () => {
      if (state.view === 'config') {
        state.selectedIndex = Math.max(0, state.selectedIndex - 1);
        render();
      }
    },
    down: () => {
      if (state.view === 'config') {
        state.selectedIndex = Math.min(state.fields.length - 1, state.selectedIndex + 1);
        render();
      }
    },
    enter: () => {
      handleEdit();
    },
    config: () => {
      if (state.view === 'status') {
        state.view = 'config';
        state.selectedIndex = 0;
        render();
      }
    },
    startStopOrSave: () => {
      if (state.view === 'status' && !state.isRunning) {
        startRouter();
      } else if (state.view === 'status' && state.isRunning) {
        stopRouter();
      } else if (state.view === 'config' && state.hasChanges) {
        saveChanges();
      }
    },
    toggleLogType: () => {
      if (state.view === 'logs') {
        state.logType = state.logType === 'stdout' ? 'stderr' : 'stdout';
        render();
      }
    },
    restart: () => {
      if (state.view === 'status' && state.isRunning) {
        restartRouter();
      }
    },
    logs: () => {
      if (state.view === 'status') {
        state.view = 'logs';
        render();
      }
    },
    refreshLogs: () => {
      if (state.view === 'logs') {
        renderLogs();
      }
    },
    toggleRefresh: () => {
      if (state.view === 'logs') {
        toggleAutoRefresh();
      }
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
    screen.unkey('c', keyHandlers.config);
    screen.unkey('C', keyHandlers.config);
    screen.unkey('s', keyHandlers.startStopOrSave);
    screen.unkey('S', keyHandlers.startStopOrSave);
    screen.unkey('t', keyHandlers.toggleLogType);
    screen.unkey('T', keyHandlers.toggleLogType);
    screen.unkey('r', keyHandlers.restart);
    screen.unkey('R', keyHandlers.restart);
    screen.unkey('l', keyHandlers.logs);
    screen.unkey('L', keyHandlers.logs);
    screen.unkey('f', keyHandlers.toggleRefresh);
    screen.unkey('F', keyHandlers.toggleRefresh);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
  }

  // Register handlers (view-specific)
  function registerHandlers(): void {
    // Always available
    screen.key(['escape'], keyHandlers.escape);
    screen.key(['q', 'Q'], keyHandlers.quit);

    if (state.view === 'status') {
      // Status view keys
      screen.key(['s', 'S'], keyHandlers.startStopOrSave);
      screen.key(['r', 'R'], keyHandlers.restart);
      screen.key(['c', 'C'], keyHandlers.config);
      screen.key(['l', 'L'], keyHandlers.logs);
    } else if (state.view === 'config') {
      // Config view keys
      screen.key(['up', 'k'], keyHandlers.up);
      screen.key(['down', 'j'], keyHandlers.down);
      screen.key(['enter'], keyHandlers.enter);
      screen.key(['s', 'S'], keyHandlers.startStopOrSave);
    } else if (state.view === 'logs') {
      // Logs view keys
      screen.key(['t', 'T'], keyHandlers.toggleLogType);
      screen.key(['r', 'R'], keyHandlers.refreshLogs);
      screen.key(['f', 'F'], keyHandlers.toggleRefresh);
    }
  }

  // Cleanup function (for exiting router screen)
  function cleanup(): void {
    stopLogsAutoRefresh();
    unregisterHandlers();
    screen.remove(contentBox);
  }

  // Initial registration
  registerHandlers();

  // Initial render
  render();
}
