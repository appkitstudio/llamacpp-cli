import blessed from 'blessed';
import { ServerConfig } from '../types/server-config.js';
import { createMultiServerMonitorUI, MonitorUIControls } from './MultiServerMonitorApp.js';
import { createModelsUI } from './ModelsApp.js';
import { createRouterUI } from './RouterApp.js';
import { createSplashScreen } from './SplashScreen.js';

type RootView = 'monitor' | 'models' | 'router';

/**
 * Root navigator that manages switching between Monitor and Models views
 */
export async function createRootNavigator(
  screen: blessed.Widgets.Screen,
  servers: ServerConfig[],
  directJumpToServer?: number
): Promise<void> {
  let currentView: RootView = 'monitor';
  let isExiting = false;

  // Show splash screen with loading sequence
  const cleanupSplash = await createSplashScreen(screen, {
    onLoadConfigs: async () => {
      // Configs are already loaded (passed in), but simulate brief work
      await new Promise(resolve => setTimeout(resolve, 150));
    },
    onCheckServices: async () => {
      // Services already checked by ps command, but simulate brief work
      await new Promise(resolve => setTimeout(resolve, 150));
    },
    onInitMetrics: async () => {
      // Metrics collectors initialize on first poll, but simulate brief work
      await new Promise(resolve => setTimeout(resolve, 150));
    },
  });

  // Callback to switch to Models view (receives controls from Monitor)
  const switchToModels = async (monitorControls: MonitorUIControls) => {
    if (isExiting) return;
    currentView = 'models';

    // Create Models view (Monitor is paused, not destroyed)
    await createModelsUI(
      screen,
      async () => {
        // onBack callback - return to Monitor view
        if (isExiting) return;
        currentView = 'monitor';

        // Resume Monitor view instantly (no reload, just re-attach and resume polling)
        monitorControls.resume();
      },
      async () => {
        // onSearch callback - handled by ModelsApp (opens SearchApp)
        // This is a placeholder, actual implementation in ModelsApp
      }
    );
  };

  // Callback to switch to Router view (receives controls from Monitor)
  const switchToRouter = async (monitorControls: MonitorUIControls) => {
    if (isExiting) return;
    currentView = 'router';

    // Create Router view (Monitor is paused, not destroyed)
    await createRouterUI(
      screen,
      async () => {
        // onBack callback - return to Monitor view
        if (isExiting) return;
        currentView = 'monitor';

        // Resume Monitor view instantly (no reload, just re-attach and resume polling)
        monitorControls.resume();
      }
    );
  };

  // Start with Monitor view (skip connecting message since splash already showed loading)
  // Pass cleanupSplash as onFirstRender callback - splash stays until monitor data is ready
  await createMultiServerMonitorUI(
    screen,
    servers,
    true, // Skip "Connecting to servers..." since splash screen showed loading
    directJumpToServer,
    switchToModels,
    switchToRouter,
    cleanupSplash
  );

  // Handle cleanup on exit
  screen.on('destroy', () => {
    isExiting = true;
  });
}
