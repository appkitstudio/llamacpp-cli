import blessed from 'blessed';
import { modelScanner } from '../lib/model-scanner.js';
import { stateManager } from '../lib/state-manager.js';
import { launchctlManager } from '../lib/launchctl-manager.js';
import { ModelInfo } from '../types/model-info.js';
import { ServerConfig } from '../types/server-config.js';
import { formatBytes, formatDateShort } from '../utils/format-utils.js';
import * as fs from 'fs/promises';
import { createSearchUI } from './SearchApp.js';
import { ModalController } from './shared/modal-controller.js';
import { createOverlay } from './shared/overlay-utils.js';

/**
 * Models management TUI
 * Display installed models and allow deletion
 */
export async function createModelsUI(
  screen: blessed.Widgets.Screen,
  onBack: () => void,
  onSearch: () => void
): Promise<void> {
  let models: ModelInfo[] = [];
  let selectedIndex = 0;
  let isLoading = false;

  // Modal controller for centralized keyboard handling
  const modalController = new ModalController(screen);

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
      style: {
        fg: 'blue',
      },
    },
  });
  screen.append(contentBox);

  // Render models view
  async function render() {
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += '{bold}{blue-fg}═══ Models Management{/blue-fg}{/bold}\n\n';

    if (isLoading) {
      content += '{cyan-fg}⏳ Loading models...{/cyan-fg}\n';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    if (models.length === 0) {
      content += '{yellow-fg}No models found{/yellow-fg}\n\n';
      content += '{dim}Models directory: ' + await stateManager.getModelsDirectory() + '{/dim}\n';
      content += '{dim}Download models: Press [S] to search HuggingFace{/dim}\n';
      content += '\n' + divider + '\n';
      content += `{gray-fg}[S]earch [ESC] Back [Q]uit{/gray-fg}`;
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // System info
    const totalSize = models.reduce((sum, m) => sum + m.size, 0);
    content += `{bold}Total: ${models.length} models{/bold} - ${formatBytes(totalSize)}\n`;
    content += divider + '\n';

    // Get all servers to check dependencies
    const allServers = await stateManager.getAllServers();

    // Table header
    content += '{bold}  │ Model File                                    │ Size       │ Modified   │ Servers{/bold}\n';
    content += divider + '\n';

    // Model rows
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const isSelected = i === selectedIndex;

      // Count servers using this model
      const serversUsingModel = allServers.filter(s => s.modelPath === model.path);
      const serverCount = serversUsingModel.length;

      // Selection indicator
      const indicator = isSelected ? '►' : ' ';

      // Model filename (truncate if too long)
      const maxFilenameLen = 46;
      let filename = model.filename;
      if (filename.length > maxFilenameLen) {
        filename = filename.substring(0, maxFilenameLen - 3) + '...';
      }
      filename = filename.padEnd(maxFilenameLen);

      // Size
      const size = model.sizeFormatted.padStart(11);

      // Modified date
      const modified = formatDateShort(model.modified).padStart(11);

      // Servers count with color coding
      let serversText = '';
      let serversTextPlain = '';
      if (serverCount === 0) {
        serversText = '{green-fg}0 servers{/green-fg}';
        serversTextPlain = '0 servers';
      } else {
        const runningCount = serversUsingModel.filter(s => s.status === 'running').length;
        if (runningCount > 0) {
          serversText = `{yellow-fg}${serverCount} (${runningCount} running){/yellow-fg}`;
          serversTextPlain = `${serverCount} (${runningCount} running)`;
        } else {
          serversText = `{gray-fg}${serverCount} stopped{/gray-fg}`;
          serversTextPlain = `${serverCount} stopped`;
        }
      }

      // Build row content
      let rowContent = '';
      if (isSelected) {
        // Selected row: cyan background with bright white text
        rowContent = `{cyan-bg}{15-fg}${indicator} │ ${filename} │ ${size} │ ${modified} │ ${serversTextPlain}{/15-fg}{/cyan-bg}`;
      } else {
        // Normal row: with colored server text
        rowContent = `${indicator} │ ${filename} │ ${size} │ ${modified} │ ${serversText}`;
      }

      content += rowContent + '\n';
    }

    // Footer
    content += '\n' + divider + '\n';
    content += '{gray-fg}[↑/↓] Navigate [D]elete [S]earch [R]efresh [ESC] Back [Q]uit{/gray-fg}';

    contentBox.setContent(content);
    screen.render();
  }

  // Load models
  async function loadModels() {
    isLoading = true;
    await render();

    models = await modelScanner.scanModels();
    selectedIndex = Math.min(selectedIndex, Math.max(0, models.length - 1));

    isLoading = false;
    await render();
  }

  // Delete selected model
  async function deleteModel() {
    if (models.length === 0) return;

    const model = models[selectedIndex];
    const allServers = await stateManager.getAllServers();
    const serversUsingModel = allServers.filter(s => s.modelPath === model.path);

    // Note: Custom blessed.box modals don't use modalController directly, but we track state
    // by keeping modal elements on screen until removed

    // Create overlay for modal
    const overlay = createOverlay(screen);

    // Show confirmation dialog
    const confirmBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 'shrink',
      border: { type: 'line' },
      style: {
        border: { fg: 'red' },
        fg: 'white',
      },
      tags: true,
      label: ' Delete Model ',
    });

    let confirmText = `\n{bold}Delete model: ${model.filename}?{/bold}\n\n`;
    confirmText += `Size: ${model.sizeFormatted}\n\n`;

    if (serversUsingModel.length > 0) {
      confirmText += `{yellow-fg}⚠️  This model has ${serversUsingModel.length} server(s) configured:{/yellow-fg}\n`;
      for (const server of serversUsingModel) {
        const statusColor = server.status === 'running' ? 'green-fg' : 'gray-fg';
        confirmText += `   - ${server.id} ({${statusColor}}${server.status}{/${statusColor}})\n`;
      }
      confirmText += `\n{yellow-fg}These servers will be deleted before removing the model.{/yellow-fg}\n\n`;
    }

    // Count lines to position input box correctly
    const contentLines = confirmText.split('\n').length;

    confirmBox.setContent(confirmText);

    // Add label for input
    blessed.text({
      parent: confirmBox,
      top: contentLines,
      left: 2,
      content: `Type 'yes' to confirm:`,
      tags: true,
    });

    // Create input box for confirmation (using top positioning, not bottom)
    const inputBox = blessed.textbox({
      parent: confirmBox,
      top: contentLines + 1,
      left: 2,
      right: 2,
      height: 3,
      inputOnFocus: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        focus: { border: { fg: 'green' } },
      },
    });
    screen.append(overlay);
    screen.append(confirmBox);
    inputBox.focus();
    screen.render();

    inputBox.on('submit', async (value: string) => {
      screen.remove(confirmBox);
      screen.remove(overlay);

      if (value.toLowerCase() !== 'yes') {
        await render();
        return;
      }

      // Show deleting message
      isLoading = true;
      contentBox.setContent('{cyan-fg}⏳ Deleting model...{/cyan-fg}');
      screen.render();

      try {
        // Delete all servers using this model
        for (const server of serversUsingModel) {
          // Unload service (stops and removes from launchd)
          try {
            await launchctlManager.unloadService(server.plistPath);
            if (server.status === 'running') {
              await launchctlManager.waitForServiceStop(server.label, 5000);
            }
          } catch (error) {
            // Continue even if unload fails
          }

          // Delete plist
          await launchctlManager.deletePlist(server.plistPath);

          // Delete server config
          await stateManager.deleteServerConfig(server.id);
        }

        // Delete model file
        await fs.unlink(model.path);

        // Reload models
        await loadModels();
      } catch (error) {
        // Show error with overlay
        const errorOverlay = createOverlay(screen);

        const errorBox = blessed.box({
          parent: screen,
          top: 'center',
          left: 'center',
          width: '60%',
          height: 'shrink',
          border: { type: 'line' },
          style: {
            border: { fg: 'red' },
            fg: 'red',
          },
          tags: true,
          label: ' Error ',
          keys: true,
        });

        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errorBox.setContent(`\n  {bold}Delete failed{/bold}\n\n  ${errorMsg}\n\n  {gray-fg}Press any key to continue{/gray-fg}`);

        screen.append(errorOverlay);
        screen.append(errorBox);
        errorBox.focus();
        screen.render();

        errorBox.once('keypress', () => {
          screen.remove(errorBox);
          screen.remove(errorOverlay);
          isLoading = false;
          render();
        });
      }
    });

    inputBox.on('cancel', () => {
      screen.remove(confirmBox);
      screen.remove(overlay);
      render();
    });

    inputBox.key(['escape'], () => {
      screen.remove(confirmBox);
      screen.remove(overlay);
      render();
    });
  }

  // Store key handler references for cleanup
  const keyHandlers = {
    up: () => {
      if (models.length === 0) return;
      selectedIndex = Math.max(0, selectedIndex - 1);
      render();
    },
    down: () => {
      if (models.length === 0) return;
      selectedIndex = Math.min(models.length - 1, selectedIndex + 1);
      render();
    },
    delete: () => {
      deleteModel();
    },
    search: async () => {
      // Cleanup current handlers before switching views
      cleanup();

      // Open search view
      await createSearchUI(screen, async () => {
        // onBack callback - return to models view
        // Re-register handlers
        registerHandlers();
        screen.append(contentBox);
        await loadModels();
      });
    },
    refresh: () => {
      loadModels();
    },
    escape: async () => {
      // Note: Custom blessed.box modals have their own focus and ESC handling
      // Screen handlers don't fire when modals are focused
      cleanup();
      await onBack();
    },
    quit: () => {
      screen.destroy();
      process.exit(0);
    },
  };

  // Cleanup function to unregister all handlers
  function cleanup() {
    screen.unkey('up', keyHandlers.up);
    screen.unkey('k', keyHandlers.up);
    screen.unkey('down', keyHandlers.down);
    screen.unkey('j', keyHandlers.down);
    screen.unkey('d', keyHandlers.delete);
    screen.unkey('D', keyHandlers.delete);
    screen.unkey('s', keyHandlers.search);
    screen.unkey('S', keyHandlers.search);
    screen.unkey('r', keyHandlers.refresh);
    screen.unkey('R', keyHandlers.refresh);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
    screen.unkey('C-c', keyHandlers.quit);
    screen.remove(contentBox);
  }

  // Register key handlers
  function registerHandlers() {
    screen.key(['up', 'k'], keyHandlers.up);
    screen.key(['down', 'j'], keyHandlers.down);
    screen.key(['d', 'D'], keyHandlers.delete);
    screen.key(['s', 'S'], keyHandlers.search);
    screen.key(['r', 'R'], keyHandlers.refresh);
    screen.key(['escape'], keyHandlers.escape);
    screen.key(['q', 'Q', 'C-c'], keyHandlers.quit);
  }

  // Register initial handlers
  registerHandlers();

  // Initial load
  await loadModels();
}
