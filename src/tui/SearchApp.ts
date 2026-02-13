import blessed from 'blessed';
import { modelSearch, HFModelResult } from '../lib/model-search.js';
import { modelDownloader, DownloadProgress } from '../lib/model-downloader.js';
import { stateManager } from '../lib/state-manager.js';
import { formatBytes } from '../utils/format-utils.js';

interface SearchState {
  query: string;
  results: HFModelResult[];
  selectedIndex: number;
  isSearching: boolean;
  expandedModelIndex: number | null;
  modelFiles: string[];
  selectedFileIndex: number;
  isLoadingFiles: boolean;
  error: string | null;
}

/**
 * Search HuggingFace and download models TUI
 */
export async function createSearchUI(
  screen: blessed.Widgets.Screen,
  onBack: () => void
): Promise<void> {
  const state: SearchState = {
    query: '',
    results: [],
    selectedIndex: 0,
    isSearching: false,
    expandedModelIndex: null,
    modelFiles: [],
    selectedFileIndex: 0,
    isLoadingFiles: false,
    error: null,
  };

  // Modal state flag to prevent screen handlers from executing when modals are open
  let isModalOpen = false;

  // Create content box for results
  const contentBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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

  // Render content
  function render() {
    const termWidth = (screen.width as number) || 80;
    const divider = '─'.repeat(termWidth - 2);
    let content = '';

    // Header
    content += '{bold}{blue-fg}═══ Search Models{/blue-fg}{/bold}\n';
    content += '{gray-fg}Press [/] to search HuggingFace{/gray-fg}\n';
    content += divider + '\n\n';

    // Show searching state
    if (state.isSearching) {
      content += '{cyan-fg}⏳ Searching...{/cyan-fg}\n';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Show error
    if (state.error) {
      content += `{red-fg}❌ Error: ${state.error}{/red-fg}\n\n`;
      content += '{gray-fg}Press [/] to search again{/gray-fg}\n';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Show results or empty state
    if (state.results.length === 0) {
      if (state.query) {
        content += `{yellow-fg}No results found for: ${state.query}{/yellow-fg}\n`;
      } else {
        content += '{gray-fg}Press [/] to search HuggingFace for models{/gray-fg}\n';
      }
      content += '\n' + divider + '\n';
      content += '{gray-fg}[/] Search [ESC] Back [Q]uit{/gray-fg}';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Show expanded model files
    if (state.expandedModelIndex !== null) {
      const model = state.results[state.expandedModelIndex];
      content += `{bold}Model: ${model.modelId}{/bold}\n`;
      content += `Downloads: ${model.downloads.toLocaleString()} | Likes: ${model.likes}\n`;
      content += divider + '\n\n';

      if (state.isLoadingFiles) {
        content += '{cyan-fg}⏳ Loading GGUF files...{/cyan-fg}\n';
      } else if (state.modelFiles.length === 0) {
        content += '{yellow-fg}No GGUF files found for this model{/yellow-fg}\n';
      } else {
        content += '{bold}GGUF Files:{/bold}\n\n';

        for (let i = 0; i < state.modelFiles.length; i++) {
          const file = state.modelFiles[i];
          const isSelected = i === state.selectedFileIndex;
          const indicator = isSelected ? '►' : ' ';

          let rowContent = '';
          if (isSelected) {
            rowContent = `{cyan-bg}{15-fg}${indicator} ${file}{/15-fg}{/cyan-bg}`;
          } else {
            rowContent = `${indicator} ${file}`;
          }

          content += rowContent + '\n';
        }

        content += '\n{gray-fg}Press Enter to download selected file{/gray-fg}\n';
      }

      content += '\n' + divider + '\n';
      content += '{gray-fg}[↑/↓] Navigate [Enter] Download [ESC] Back{/gray-fg}';
      contentBox.setContent(content);
      screen.render();
      return;
    }

    // Show results table
    content += `{bold}Results for: "${state.query}"{/bold}\n`;
    content += divider + '\n\n';

    // Table header
    content += '{bold}  │ Model                                              │ Downloads │ Likes{/bold}\n';
    content += divider + '\n';

    // Result rows
    for (let i = 0; i < state.results.length; i++) {
      const result = state.results[i];
      const isSelected = i === state.selectedIndex;
      const indicator = isSelected ? '►' : ' ';

      // Model ID (truncate if too long)
      const maxModelLen = 51;
      let modelId = result.modelId;
      if (modelId.length > maxModelLen) {
        modelId = modelId.substring(0, maxModelLen - 3) + '...';
      }
      modelId = modelId.padEnd(maxModelLen);

      // Downloads
      const downloads = result.downloads.toLocaleString().padStart(10);

      // Likes
      const likes = result.likes.toString().padStart(6);

      // Build row content
      let rowContent = '';
      if (isSelected) {
        rowContent = `{cyan-bg}{15-fg}${indicator} │ ${modelId} │ ${downloads} │ ${likes}{/15-fg}{/cyan-bg}`;
      } else {
        rowContent = `${indicator} │ ${modelId} │ ${downloads} │ ${likes}`;
      }

      content += rowContent + '\n';
    }

    // Footer
    content += '\n' + divider + '\n';
    content += '{gray-fg}[↑/↓] Navigate [Enter] View files [/] New search [ESC] Back [Q]uit{/gray-fg}';

    contentBox.setContent(content);
    screen.render();
  }

  // Show search popup modal
  function showSearchPopup() {
    const searchBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 7,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
      },
      tags: true,
    });

    searchBox.setContent('{bold}Search HuggingFace{/bold}\n\nType your query and press Enter:');

    const searchInput = blessed.textbox({
      parent: searchBox,
      bottom: 0,
      left: 1,
      right: 1,
      height: 1,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    });

    // Handle submit
    searchInput.on('submit', async (value: string) => {
      screen.remove(searchBox);
      screen.render();

      if (value && value.trim()) {
        await executeSearch(value.trim());
      }
    });

    // Handle cancel
    searchInput.on('cancel', () => {
      screen.remove(searchBox);
      render();
    });

    searchInput.key(['escape'], () => {
      screen.remove(searchBox);
      render();
    });

    screen.append(searchBox);
    searchInput.focus();
    screen.render();
  }

  // Execute search
  async function executeSearch(query: string) {
    state.query = query;
    state.isSearching = true;
    state.error = null;
    state.results = [];
    state.selectedIndex = 0;
    render();

    try {
      const results = await modelSearch.searchModels(query, 20);
      state.results = results;
      state.isSearching = false;
      render();
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Unknown error';
      state.isSearching = false;
      render();
    }
  }

  // Load model files
  async function loadModelFiles(modelIndex: number) {
    const model = state.results[modelIndex];
    state.expandedModelIndex = modelIndex;
    state.isLoadingFiles = true;
    state.modelFiles = [];
    state.selectedFileIndex = 0;
    render();

    try {
      const files = await modelSearch.getModelFiles(model.modelId);
      state.modelFiles = files;
      state.isLoadingFiles = false;
      render();
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Unknown error';
      state.expandedModelIndex = null;
      state.isLoadingFiles = false;
      render();
    }
  }

  // Download selected file
  async function downloadFile() {
    if (state.expandedModelIndex === null || state.modelFiles.length === 0) return;

    const model = state.results[state.expandedModelIndex];
    const filename = state.modelFiles[state.selectedFileIndex];

    // Get models directory
    const modelsDir = await stateManager.getModelsDirectory();

    // Create progress modal
    const progressBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 12,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
      },
      tags: true,
    });

    // Create abort controller for cancellation
    const abortController = new AbortController();
    let downloadCancelled = false;

    // Update progress display
    function updateProgress(progress: DownloadProgress) {
      if (downloadCancelled) return;
      const percentage = progress.percentage.toFixed(1);
      const barLength = 40;
      const filled = Math.round((progress.percentage / 100) * barLength);
      const empty = barLength - filled;
      const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));

      let content = `{bold}Downloading: ${progress.filename}{/bold}\n\n`;
      content += `[${bar}] ${percentage}%\n\n`;
      content += `Downloaded: ${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}\n`;
      content += `Speed: ${progress.speed}\n\n`;
      content += '{gray-fg}Press ESC or Ctrl+C to cancel{/gray-fg}';

      progressBox.setContent(content);
      screen.render();
    }

    // Temporarily unregister main handlers during download
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('C-c', keyHandlers.quit);

    // Handle cancel
    const cancelHandler = () => {
      downloadCancelled = true;
      abortController.abort();  // Actually abort the download
    };

    // Cleanup function to restore handlers
    const cleanup = () => {
      screen.unkey('escape', cancelHandler);
      screen.unkey('C-c', cancelHandler);
      screen.remove(progressBox);
      // Re-register main handlers
      screen.key(['escape'], keyHandlers.escape);
      screen.key(['C-c'], keyHandlers.quit);
    };

    screen.append(progressBox);
    progressBox.focus();
    screen.key(['escape', 'C-c'], cancelHandler);
    screen.render();

    try {
      // Start download with silent mode and abort signal
      await modelDownloader.downloadModel(
        model.modelId,
        filename,
        (progress) => {
          if (!downloadCancelled) {
            updateProgress(progress);
          }
        },
        modelsDir,
        { silent: true, signal: abortController.signal }
      );

      if (!downloadCancelled) {
        // Show success message
        cleanup();

        const successBox = blessed.message({
          parent: screen,
          top: 'center',
          left: 'center',
          width: '60%',
          height: 'shrink',
          border: { type: 'line' },
          style: {
            border: { fg: 'green' },
            fg: 'green',
          },
          tags: true,
        });

        successBox.display(
          `{bold}Download complete!{/bold}\n\nFile: ${filename}\nLocation: ${modelsDir}\n\nPress any key to continue`,
          () => {
            screen.remove(successBox);
            render();
          }
        );
      }
    } catch (error) {
      cleanup();

      if (!downloadCancelled) {
        // Show error message (not cancelled by user)
        const errorBox = blessed.message({
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
        });

        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errorBox.display(`{bold}Download failed{/bold}\n\n${errorMsg}\n\nPress any key to continue`, () => {
          screen.remove(errorBox);
          render();
        });
      } else {
        // Cancelled by user - just render
        render();
      }
    }
  }

  // Store key handler references for cleanup
  const keyHandlers = {
    up: () => {
      if (state.expandedModelIndex !== null) {
        // Navigating files
        state.selectedFileIndex = Math.max(0, state.selectedFileIndex - 1);
      } else {
        // Navigating results
        state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      }
      render();
    },
    down: () => {
      if (state.expandedModelIndex !== null) {
        // Navigating files
        state.selectedFileIndex = Math.min(state.modelFiles.length - 1, state.selectedFileIndex + 1);
      } else {
        // Navigating results
        state.selectedIndex = Math.min(state.results.length - 1, state.selectedIndex + 1);
      }
      render();
    },
    enter: () => {
      if (state.expandedModelIndex !== null) {
        // Download selected file
        downloadFile();
      } else if (state.results.length > 0) {
        // Expand selected model to show files
        loadModelFiles(state.selectedIndex);
      }
    },
    search: () => {
      if (state.expandedModelIndex !== null) return; // Don't allow search when viewing files
      showSearchPopup();
    },
    escape: () => {
      if (isModalOpen) return; // Don't handle if modal is open
      if (state.expandedModelIndex !== null) {
        // Go back to results list
        state.expandedModelIndex = null;
        state.modelFiles = [];
        state.selectedFileIndex = 0;
        render();
      } else {
        // Go back to models view
        unregisterHandlers();
        screen.remove(contentBox);
        onBack();
      }
    },
    quit: () => {
      screen.destroy();
      process.exit(0);
    },
  };

  // Unregister all keyboard handlers
  function unregisterHandlers() {
    screen.unkey('up', keyHandlers.up);
    screen.unkey('k', keyHandlers.up);
    screen.unkey('down', keyHandlers.down);
    screen.unkey('j', keyHandlers.down);
    screen.unkey('enter', keyHandlers.enter);
    screen.unkey('/', keyHandlers.search);
    screen.unkey('escape', keyHandlers.escape);
    screen.unkey('q', keyHandlers.quit);
    screen.unkey('Q', keyHandlers.quit);
    screen.unkey('C-c', keyHandlers.quit);
  }

  // Register key handlers
  screen.key(['up', 'k'], keyHandlers.up);
  screen.key(['down', 'j'], keyHandlers.down);
  screen.key(['enter'], keyHandlers.enter);
  screen.key(['/'], keyHandlers.search);
  screen.key(['escape'], keyHandlers.escape);
  screen.key(['q', 'Q', 'C-c'], keyHandlers.quit);

  // Initial render
  render();

  // Auto-open search popup on load
  showSearchPopup();
}
