import blessed from "blessed";
import { readFileSync } from "fs";
import { join } from "path";

// Get version from package.json at runtime
function getVersion(): string {
  try {
    // Try to find package.json relative to this file's location
    // Works both in src/ (dev) and dist/ (production)
    const possiblePaths = [
      join(__dirname, "../../package.json"), // From dist/tui/
      join(__dirname, "../../../package.json"), // Fallback
    ];

    for (const pkgPath of possiblePaths) {
      try {
        const content = readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(content);
        if (pkg.version) return pkg.version;
      } catch {
        continue;
      }
    }
    return "1.0.0";
  } catch {
    return "1.0.0";
  }
}

// ASCII art logo for llama.cpp
const LOGO = `
 {cyan-fg} ██╗     ██╗      █████╗ ███╗   ███╗ █████╗    ██████╗██████╗ ██████╗{/cyan-fg}
 {cyan-fg}██║     ██║     ██╔══██╗████╗ ████║██╔══██╗  ██╔════╝██╔══██╗██╔══██╗{/cyan-fg}
 {cyan-fg}██║     ██║     ███████║██╔████╔██║███████║  ██║     ██████╔╝██████╔╝{/cyan-fg}
 {cyan-fg}██║     ██║     ██╔══██║██║╚██╔╝██║██╔══██║  ██║     ██╔═══╝ ██╔═══╝{/cyan-fg}
 {cyan-fg}███████╗███████╗██║  ██║██║ ╚═╝ ██║██║  ██║  ╚██████╗██║     ██║{/cyan-fg}
 {cyan-fg}╚══════╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝   ╚═════╝╚═╝     ╚═╝{/cyan-fg}
`.trim();

export interface SplashCallbacks {
  onLoadConfigs: () => Promise<void>;
  onCheckServices: () => Promise<void>;
  onInitMetrics: () => Promise<void>;
}

export interface SplashScreenControls {
  updateStatus: (line: number, text: string, done?: boolean) => void;
  complete: () => void;
}

/**
 * Creates and displays the splash screen with loading status
 * Returns a cleanup function to remove the splash when the main UI is ready
 */
export async function createSplashScreen(
  screen: blessed.Widgets.Screen,
  callbacks: SplashCallbacks,
): Promise<() => void> {
  const version = getVersion();

  // Create top-left aligned container
  const container = blessed.box({
    top: 0,
    left: 0,
    width: 75,
    height: 19,
    tags: true,
  });
  screen.append(container);

  // Logo box
  const logoBox = blessed.box({
    parent: container,
    top: 0,
    left: 0,
    width: 73,
    height: 7,
    tags: true,
    content: LOGO,
  });

  // Info box with border
  const infoBox = blessed.box({
    parent: container,
    top: 7,
    left: 0,
    width: 73,
    height: 10,
    tags: true,
    border: {
      type: "line",
    },
    style: {
      border: {
        fg: "blue",
      },
    },
  });

  // Status lines (inside the info box)
  const statusLines = [
    "{bold}Local LLM Server Manager{/bold}                                    v" +
      version,
    "",
    "{gray-fg}>{/gray-fg} Loading server configurations...",
    "{gray-fg}>{/gray-fg} Checking launchctl services...",
    "{gray-fg}>{/gray-fg} Initializing metrics collectors...",
    "{gray-fg}>{/gray-fg} Loading UI...",
  ];

  function updateDisplay() {
    infoBox.setContent(statusLines.join("\n"));
    screen.render();
  }

  function updateStatus(line: number, text: string, done: boolean = false) {
    const prefix = done ? "{green-fg}✓{/green-fg}" : "{yellow-fg}>{/yellow-fg}";
    statusLines[line + 2] = `${prefix} ${text}`;
    updateDisplay();
  }

  // Initial render
  updateDisplay();

  // Run loading sequence
  // Step 1: Load configs
  updateStatus(0, "Loading server configurations...", false);
  await callbacks.onLoadConfigs();
  updateStatus(0, "Server configurations loaded", true);

  // Step 2: Check services
  updateStatus(1, "Checking launchctl services...", false);
  await callbacks.onCheckServices();
  updateStatus(1, "Launchctl services checked", true);

  // Step 3: Init metrics
  updateStatus(2, "Initializing metrics collectors...", false);
  await callbacks.onInitMetrics();
  updateStatus(2, "Metrics collectors ready", true);

  // Step 4: Loading UI (stays active until cleanup is called)
  updateStatus(3, "Loading UI...", false);

  // Return cleanup function - caller decides when to remove splash
  return () => {
    screen.remove(container);
    screen.render();
  };
}
