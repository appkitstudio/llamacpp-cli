import blessed from 'blessed';
import { ServerConfig } from '../types/server-config.js';
import { createMultiServerMonitorUI, MonitorUIControls } from './MultiServerMonitorApp.js';
import { createModelsUI } from './ModelsApp.js';

type RootView = 'monitor' | 'models';

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

  // Start with Monitor view
  await createMultiServerMonitorUI(
    screen,
    servers,
    false, // Show "Connecting to servers..." on initial load
    directJumpToServer,
    switchToModels
  );

  // Handle cleanup on exit
  screen.on('destroy', () => {
    isExiting = true;
  });
}
