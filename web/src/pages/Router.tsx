import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useRouter,
  useStartRouter,
  useStopRouter,
  useRestartRouter,
} from '../hooks/useApi';
import {
  Play,
  Square,
  RotateCw,
  Loader2,
  Activity,
  Shuffle,
  FileText,
  Settings,
} from 'lucide-react';
import { RouterConfigModal } from '../components/RouterConfigModal';

export function Router() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: routerData, isLoading } = useRouter();
  const startRouter = useStartRouter();
  const stopRouter = useStopRouter();
  const restartRouter = useRestartRouter();

  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  const handleStart = async () => {
    setActionLoading('start');
    try {
      await startRouter.mutateAsync();
      await queryClient.refetchQueries({ queryKey: ['router'] });
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      await stopRouter.mutateAsync();
      await queryClient.refetchQueries({ queryKey: ['router'] });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestart = async () => {
    setActionLoading('restart');
    try {
      await restartRouter.mutateAsync();
      await queryClient.refetchQueries({ queryKey: ['router'] });
    } finally {
      setActionLoading(null);
    }
  };

  // Only show loading on initial load, not on refetches
  if (isLoading && !routerData) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-neutral-500 text-center">Loading...</p>
      </div>
    );
  }

  const router = routerData;
  const isRunning = router?.isRunning || false;
  const isNotConfigured = router?.status === 'not_configured';

  const renderStatusBadge = () => {
    if (actionLoading) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-700">
          <Loader2 className="w-3 h-3 animate-spin" />
          {actionLoading === 'start' && 'Starting'}
          {actionLoading === 'stop' && 'Stopping'}
          {actionLoading === 'restart' && 'Restarting'}
        </span>
      );
    }

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
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Router</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Unified API endpoint for model routing
          </p>
        </div>
      </div>

      {/* Router Card */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 hover:border-neutral-300 hover:shadow-sm transition-all">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Shuffle className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-neutral-900 mb-1">Router Service</h3>
              <p className="text-sm text-neutral-500">
                {isNotConfigured
                  ? 'Not yet configured'
                  : `localhost:${router?.config?.port || 'N/A'}`}
              </p>
            </div>
          </div>
          {renderStatusBadge()}
        </div>

        {/* Configuration Details */}
        {!isNotConfigured && router?.config && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="text-neutral-400">Host:</span>
              <span>{router.config.host}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="text-neutral-400">Request Timeout:</span>
              <span>{(router.config.requestTimeout / 1000).toFixed(0)}s</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="text-neutral-400">Verbose Logs:</span>
              <span>{router.config.verbose ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        )}

        {/* Available Models */}
        {!isNotConfigured && router && (
          <div className="mb-4 pt-4 border-t border-neutral-200">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-3.5 h-3.5 text-neutral-400" />
              <h4 className="text-xs font-semibold text-neutral-900">Available Models</h4>
            </div>
            {router.availableModels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {router.availableModels.map((model) => (
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
        {isNotConfigured && (
          <div className="mb-4 pt-4 border-t border-neutral-200">
            <p className="text-sm text-neutral-600 mb-3">
              Click "Start" to configure and launch the router service. The router will
              automatically discover and route requests to running servers.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-100 transition-opacity pt-4 border-t border-neutral-200">
          {!isNotConfigured && isRunning && (
            <button
              onClick={() => navigate('/router/logs')}
              disabled={actionLoading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              title="View Logs"
            >
              <FileText className="w-3.5 h-3.5" />
              Logs
            </button>
          )}

          {!isNotConfigured && (
            <button
              onClick={() => setShowConfigModal(true)}
              disabled={actionLoading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              title="Config"
            >
              <Settings className="w-3.5 h-3.5" />
              Config
            </button>
          )}

          {!isNotConfigured && isRunning && (
            <>
              <button
                onClick={handleRestart}
                disabled={actionLoading !== null}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
                title="Restart"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Restart
              </button>
              <button
                onClick={handleStop}
                disabled={actionLoading !== null}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            </>
          )}

          {(isNotConfigured || !isRunning) && (
            <button
              onClick={handleStart}
              disabled={actionLoading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
              title="Start"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          )}
        </div>
      </div>

      {/* Config Modal */}
      <RouterConfigModal
        router={router || null}
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />
    </div>
  );
}
