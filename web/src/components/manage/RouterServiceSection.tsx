import { Shuffle, ChevronDown, ChevronUp, Loader2, Activity } from 'lucide-react';
import type { RouterInfo } from '../../types/api';

interface RouterServiceSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  routerData: RouterInfo | undefined;
  routerActionLoading: 'start' | 'stop' | 'restart' | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onConfigure: () => void;
}

export function RouterServiceSection({
  isOpen,
  onToggle,
  routerData,
  routerActionLoading,
  onStart,
  onStop,
  onRestart,
  onConfigure,
}: RouterServiceSectionProps) {
  // Router status badge renderer
  const renderRouterStatusBadge = () => {
    // Show loading state when data hasn't loaded yet
    if (!routerData) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-700">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading
        </span>
      );
    }

    if (routerActionLoading) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-700">
          <Loader2 className="w-3 h-3 animate-spin" />
          {routerActionLoading === 'start' && 'Starting'}
          {routerActionLoading === 'stop' && 'Stopping'}
          {routerActionLoading === 'restart' && 'Restarting'}
        </span>
      );
    }

    const isNotConfigured = routerData.status === 'not_configured';
    const isRunning = routerData.isRunning || false;

    if (isNotConfigured) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-600">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
          Not Configured
        </span>
      );
    }

    if (isRunning) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200/50">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          Running
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-600">
        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
        Stopped
      </span>
    );
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-lg mb-6 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Shuffle className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-left">
            <h3 className="text-base font-semibold text-neutral-900">Router Service</h3>
            <p className="text-sm text-neutral-500">
              {routerData?.status === 'not_configured'
                ? 'Not yet configured'
                : `Unified model routing on port ${routerData?.config?.port || 'N/A'}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {renderRouterStatusBadge()}
          {isOpen ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-neutral-200 px-5 py-4">
          <div className="space-y-4">
            {/* Control Buttons */}
            <div className="flex items-center gap-2 pb-4 border-b border-neutral-200">
              {routerData?.status !== 'not_configured' && routerData?.isRunning && (
                <a
                  href="/router/logs"
                  className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
                >
                  View Logs
                </a>
              )}

              {routerData?.status !== 'not_configured' && (
                <button
                  onClick={onConfigure}
                  disabled={routerActionLoading !== null}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  Configure
                </button>
              )}

              {routerData?.status !== 'not_configured' && routerData?.isRunning && (
                <>
                  <button
                    onClick={onRestart}
                    disabled={routerActionLoading !== null}
                    className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    Restart
                  </button>
                  <button
                    onClick={onStop}
                    disabled={routerActionLoading !== null}
                    className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    Stop
                  </button>
                </>
              )}

              {(routerData?.status === 'not_configured' || !routerData?.isRunning) && (
                <button
                  onClick={onStart}
                  disabled={routerActionLoading !== null}
                  className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  Start
                </button>
              )}
            </div>

            {/* Configuration Details */}
            {routerData?.status !== 'not_configured' && routerData?.config && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-neutral-900 mb-2">Configuration</h4>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Host:</span>
                  <span>{routerData.config.host}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Port:</span>
                  <span>{routerData.config.port}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Request Timeout:</span>
                  <span>{(routerData.config.requestTimeout / 1000).toFixed(0)}s</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Logging:</span>
                  <span>{routerData.config.logging ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            )}

            {/* Available Models */}
            {routerData?.status !== 'not_configured' && routerData && (
              <div className="pt-4 border-t border-neutral-200">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-3.5 h-3.5 text-neutral-400" />
                  <h4 className="text-xs font-semibold text-neutral-900">Available Models</h4>
                </div>
                {routerData.availableModels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {routerData.availableModels.map((model: string) => (
                      <span
                        key={model}
                        className="inline-flex items-center px-2 py-1 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md"
                      >
                        {model.replace('.gguf', '')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">
                    No models available. Start some servers to enable routing.
                  </p>
                )}
              </div>
            )}

            {/* Not Configured Message */}
            {routerData?.status === 'not_configured' && (
              <div className="pt-2">
                <p className="text-sm text-neutral-600">
                  Click "Start" to configure and launch the router service. The router will
                  automatically discover and route requests to running servers.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
