import { useState } from 'react';
import {
  useAdminLogs,
  useClearLogs,
  useRotateLogs,
  useClearArchivedLogs,
  useClearAllLogs,
  useUpdateLogConfig,
} from '../hooks/useApi';
import {
  Database,
  Trash2,
  RotateCw,
  Archive,
  ChevronDown,
  ChevronUp,
  Settings,
  Loader2,
  Clock,
  CheckCircle2,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import type { ServerLogInfo } from '../types/api';

export function Admin() {
  const { data: logsData, isLoading } = useAdminLogs();
  const clearLogs = useClearLogs();
  const rotateLogs = useRotateLogs();
  const clearArchivedLogs = useClearArchivedLogs();
  const clearAllLogs = useClearAllLogs();
  const updateLogConfig = useUpdateLogConfig();

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [showConfigSection, setShowConfigSection] = useState(false);
  const [showServerLogsSection, setShowServerLogsSection] = useState(false);
  const [showRouterLogsSection, setShowRouterLogsSection] = useState(false);
  const [showAdminLogsSection, setShowAdminLogsSection] = useState(false);

  // Configuration state
  const [configChanges, setConfigChanges] = useState<{
    autoRotate?: {
      enabled?: boolean;
      intervalHours?: number;
      thresholdMB?: number;
    };
    autoDelete?: {
      enabled?: boolean;
      intervalHours?: number;
      afterDays?: number;
    };
  }>({});

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const handleClearLogs = (
    type: 'server' | 'router' | 'admin',
    serverId: string | undefined,
    streams: ('stdout' | 'stderr' | 'httpLog')[]
  ) => {
    const streamNames = streams.join(', ');
    const target = type === 'server' ? `server ${serverId}` : type;

    setConfirmModal({
      isOpen: true,
      title: 'Clear Logs',
      message: `Are you sure you want to clear ${streamNames} for ${target}? This will truncate the log files to 0 bytes.`,
      onConfirm: async () => {
        await clearLogs.mutateAsync({ type, serverId, streams });
        setConfirmModal({ ...confirmModal, isOpen: false });
      },
    });
  };

  const handleRotateLogs = async (
    type: 'server' | 'router' | 'admin',
    serverId: string | undefined,
    streams: ('stdout' | 'stderr' | 'httpLog')[]
  ) => {
    await rotateLogs.mutateAsync({ type, serverId, streams });
  };

  const handleClearArchived = (serverId?: string) => {
    const target = serverId || 'all services';

    setConfirmModal({
      isOpen: true,
      title: 'Clear Archived Logs',
      message: `Are you sure you want to delete all archived logs for ${target}?`,
      onConfirm: async () => {
        await clearArchivedLogs.mutateAsync({ serverId });
        setConfirmModal({ ...confirmModal, isOpen: false });
      },
    });
  };

  const handleClearAll = (includeArchived: boolean) => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear All Logs',
      message: `Are you sure you want to clear ALL logs${includeArchived ? ' (including archived)' : ''}? This action cannot be undone.`,
      onConfirm: async () => {
        await clearAllLogs.mutateAsync({ includeArchived });
        setConfirmModal({ ...confirmModal, isOpen: false });
      },
    });
  };

  const handleSaveConfig = async () => {
    await updateLogConfig.mutateAsync(configChanges);
    setConfigChanges({});
    setShowConfigSection(false);
  };

  if (isLoading && !logsData) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-neutral-500 text-center">Loading...</p>
      </div>
    );
  }

  const currentConfig = logsData?.config || {
    autoRotate: { enabled: false, intervalHours: 24, thresholdMB: 100 },
    autoDelete: { enabled: false, intervalHours: 24, afterDays: 30 },
  };

  const mergedConfig = {
    autoRotate: { ...currentConfig.autoRotate, ...configChanges.autoRotate },
    autoDelete: { ...currentConfig.autoDelete, ...configChanges.autoDelete },
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Admin</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Manage logs, view API documentation, and configure system settings
          </p>
        </div>
      </div>

      {/* API Documentation Section */}
      <div className="bg-white border border-neutral-200 rounded-lg mb-6 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-neutral-900">API Documentation</h3>
              <p className="text-sm text-neutral-500">
                Interactive API reference with request/response examples
              </p>
            </div>
          </div>
          <a
            href="/api-docs/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors flex items-center gap-2"
          >
            Open Swagger UI
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Log Management Section Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">Log Management</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Monitor disk usage and manage log files
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 mb-6 hover:border-neutral-300 hover:shadow-sm transition-all">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
              <Database className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-neutral-900 mb-1">Total Disk Usage</h3>
              <p className="text-sm text-neutral-500">
                {formatSize(logsData?.summary.grandTotal || 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs text-blue-700 mb-1 font-medium">Total Log Size</p>
            <p className="text-lg font-semibold text-blue-900">
              {formatSize(logsData?.summary.grandTotal || 0)}
            </p>
          </div>
          <div className="text-center p-3 bg-neutral-50 rounded-lg">
            <p className="text-xs text-neutral-500 mb-1">Current Logs</p>
            <p className="text-lg font-semibold text-neutral-900">
              {formatSize(logsData?.summary.totalCurrent || 0)}
            </p>
          </div>
          <div className="text-center p-3 bg-neutral-50 rounded-lg">
            <p className="text-xs text-neutral-500 mb-1">Archived Logs</p>
            <p className="text-lg font-semibold text-neutral-900">
              {formatSize(logsData?.summary.totalArchived || 0)}
            </p>
          </div>
          <div className="text-center p-3 bg-neutral-50 rounded-lg">
            <p className="text-xs text-neutral-500 mb-1">Servers</p>
            <p className="text-lg font-semibold text-neutral-900">
              {logsData?.servers.length || 0}
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => handleClearAll(false)}
            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All Current
          </button>
          <button
            onClick={() => handleClearAll(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All + Archived
          </button>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="bg-white border border-neutral-200 rounded-lg mb-6 overflow-hidden">
        <button
          onClick={() => setShowConfigSection(!showConfigSection)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-neutral-600" />
            <div className="text-left">
              <h3 className="text-base font-semibold text-neutral-900">Automation Configuration</h3>
              <p className="text-sm text-neutral-500">Configure auto-rotation and auto-deletion</p>
            </div>
          </div>
          {showConfigSection ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </button>

        {showConfigSection && (
          <div className="px-5 pb-5 border-t border-neutral-200">
            <div className="grid grid-cols-2 gap-6 mt-4">
              {/* Auto-Rotation */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-neutral-900">Auto-Rotation</h4>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mergedConfig.autoRotate.enabled}
                      onChange={(e) =>
                        setConfigChanges({
                          ...configChanges,
                          autoRotate: {
                            ...configChanges.autoRotate,
                            enabled: e.target.checked,
                          },
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Check Interval (hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={mergedConfig.autoRotate.intervalHours}
                    onChange={(e) =>
                      setConfigChanges({
                        ...configChanges,
                        autoRotate: {
                          ...configChanges.autoRotate,
                          intervalHours: parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Size Threshold (MB)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={mergedConfig.autoRotate.thresholdMB}
                    onChange={(e) =>
                      setConfigChanges({
                        ...configChanges,
                        autoRotate: {
                          ...configChanges.autoRotate,
                          thresholdMB: parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {logsData?.workers.autoRotate.lastRun && (
                  <div className="text-xs text-neutral-500 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Last run: {new Date(logsData.workers.autoRotate.lastRun).toLocaleString()}
                  </div>
                )}
              </div>

              {/* Auto-Delete */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-neutral-900">Auto-Delete</h4>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mergedConfig.autoDelete.enabled}
                      onChange={(e) =>
                        setConfigChanges({
                          ...configChanges,
                          autoDelete: {
                            ...configChanges.autoDelete,
                            enabled: e.target.checked,
                          },
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Check Interval (hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={mergedConfig.autoDelete.intervalHours}
                    onChange={(e) =>
                      setConfigChanges({
                        ...configChanges,
                        autoDelete: {
                          ...configChanges.autoDelete,
                          intervalHours: parseInt(e.target.value) || 1,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Delete After (days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={mergedConfig.autoDelete.afterDays}
                    onChange={(e) =>
                      setConfigChanges({
                        ...configChanges,
                        autoDelete: {
                          ...configChanges.autoDelete,
                          afterDays: parseInt(e.target.value) || 0,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {logsData?.workers.autoDelete.lastRun && (
                  <div className="text-xs text-neutral-500 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Last run: {new Date(logsData.workers.autoDelete.lastRun).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {Object.keys(configChanges).length > 0 && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-neutral-200">
                <button
                  onClick={handleSaveConfig}
                  disabled={updateLogConfig.isPending}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {updateLogConfig.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Save Configuration
                    </>
                  )}
                </button>
                <button
                  onClick={() => setConfigChanges({})}
                  className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Server Logs Section */}
      <div className="bg-white border border-neutral-200 rounded-lg mb-6 overflow-hidden">
        <button
          onClick={() => setShowServerLogsSection(!showServerLogsSection)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-neutral-600" />
            <div className="text-left">
              <h3 className="text-base font-semibold text-neutral-900">Server Logs</h3>
              <p className="text-sm text-neutral-500">
                {logsData?.servers.length || 0} servers • {formatSize(
                  logsData?.servers.reduce((total, s) => total + s.currentTotal + s.archived.totalSize, 0) || 0
                )}
              </p>
            </div>
          </div>
          {showServerLogsSection ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </button>

        {showServerLogsSection && (
          <div className="border-t border-neutral-200">
            {logsData?.servers && logsData.servers.length > 0 ? (
              <div className="divide-y divide-neutral-200">
                {logsData.servers.map((server: ServerLogInfo) => (
                  <ServerLogRow
                    key={server.serverId}
                    server={server}
                    onClear={handleClearLogs}
                    onRotate={handleRotateLogs}
                    onClearArchived={handleClearArchived}
                    formatSize={formatSize}
                  />
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-neutral-500">No servers configured</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Router & Admin Logs (Side by Side) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Router Logs Section */}
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowRouterLogsSection(!showRouterLogsSection)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <RotateCw className="w-5 h-5 text-neutral-600" />
              <div className="text-left">
                <h3 className="text-base font-semibold text-neutral-900">Router Logs</h3>
                <p className="text-sm text-neutral-500">
                  {formatSize((logsData?.router.currentTotal || 0) + (logsData?.router.archived.totalSize || 0))}
                </p>
              </div>
            </div>
            {showRouterLogsSection ? (
              <ChevronUp className="w-5 h-5 text-neutral-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-neutral-400" />
            )}
          </button>

          {showRouterLogsSection && logsData?.router && (
            <div className="border-t border-neutral-200 px-5 py-4">
              <ServiceLogCard
                title="Router Logs"
                type="router"
                log={logsData.router}
                onClear={handleClearLogs}
                onRotate={handleRotateLogs}
                onClearArchived={handleClearArchived}
                formatSize={formatSize}
              />
            </div>
          )}
        </div>

        {/* Admin Logs Section */}
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowAdminLogsSection(!showAdminLogsSection)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-neutral-600" />
              <div className="text-left">
                <h3 className="text-base font-semibold text-neutral-900">Admin Logs</h3>
                <p className="text-sm text-neutral-500">
                  {formatSize((logsData?.admin.currentTotal || 0) + (logsData?.admin.archived.totalSize || 0))}
                </p>
              </div>
            </div>
            {showAdminLogsSection ? (
              <ChevronUp className="w-5 h-5 text-neutral-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-neutral-400" />
            )}
          </button>

          {showAdminLogsSection && logsData?.admin && (
            <div className="border-t border-neutral-200 px-5 py-4">
              <ServiceLogCard
                title="Admin Logs"
                type="admin"
                log={logsData.admin}
                onClear={handleClearLogs}
                onRotate={handleRotateLogs}
                onClearArchived={handleClearArchived}
                formatSize={formatSize}
              />
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">{confirmModal.title}</h3>
            <p className="text-sm text-neutral-600 mb-6">{confirmModal.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                className="px-4 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-md hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Server Log Row Component (compact, single line)
function ServerLogRow({
  server,
  onClear,
  onRotate,
  onClearArchived,
  formatSize,
}: {
  server: ServerLogInfo;
  onClear: (type: 'server', serverId: string | undefined, streams: ('stdout' | 'stderr' | 'httpLog')[]) => void;
  onRotate: (type: 'server', serverId: string | undefined, streams: ('stdout' | 'stderr' | 'httpLog')[]) => void;
  onClearArchived: (serverId?: string) => void;
  formatSize: (bytes: number) => string;
}) {
  const totalSize = server.currentTotal + server.archived.totalSize;

  return (
    <div className="px-5 py-4 hover:bg-neutral-50 transition-colors">
      <div className="flex items-start justify-between gap-4 mb-3">
        <h3 className="text-sm font-semibold text-neutral-900">{server.serverId}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onRotate('server', server.serverId, ['stdout', 'stderr', 'httpLog'])}
            className="p-1.5 text-neutral-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Rotate all logs"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => onClear('server', server.serverId, ['stdout', 'stderr', 'httpLog'])}
            className="p-1.5 text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Clear all logs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {server.archived.count > 0 && (
            <button
              onClick={() => onClearArchived(server.serverId)}
              className="p-1.5 text-neutral-600 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors"
              title="Clear archived logs"
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <span className="text-neutral-500 block mb-1">Current</span>
          <span className="text-neutral-900 font-medium">{formatSize(server.currentTotal)}</span>
        </div>
        <div>
          <span className="text-neutral-500 block mb-1">Archived</span>
          <span className="text-neutral-900 font-medium">{server.archived.count} ({formatSize(server.archived.totalSize)})</span>
        </div>
        <div>
          <span className="text-neutral-500 block mb-1">Total</span>
          <span className="text-neutral-900 font-semibold">{formatSize(totalSize)}</span>
        </div>
      </div>
    </div>
  );
}

// Service Log Card Component
function ServiceLogCard({
  title,
  type,
  log,
  onClear,
  onRotate,
  onClearArchived,
  formatSize,
}: {
  title: string;
  type: 'router' | 'admin';
  log: any;
  onClear: (type: 'router' | 'admin', serverId: undefined, streams: ('stdout' | 'stderr')[]) => void;
  onRotate: (type: 'router' | 'admin', serverId: undefined, streams: ('stdout' | 'stderr')[]) => void;
  onClearArchived: (serverId?: string) => void;
  formatSize: (bytes: number) => string;
}) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <h3 className="text-base font-semibold text-neutral-900 mb-4">{title}</h3>

      <div className="space-y-3">
        <LogFileRow
          name="stdout"
          size={log?.stdout.size || 0}
          formatSize={formatSize}
          onClear={() => onClear(type, undefined, ['stdout'])}
          onRotate={() => onRotate(type, undefined, ['stdout'])}
        />
        <LogFileRow
          name="stderr"
          size={log?.stderr.size || 0}
          formatSize={formatSize}
          onClear={() => onClear(type, undefined, ['stderr'])}
          onRotate={() => onRotate(type, undefined, ['stderr'])}
        />

        {log?.archived.count > 0 && (
          <div className="pt-3 border-t border-neutral-200">
            <button
              onClick={() => onClearArchived(type)}
              className="w-full px-3 py-2 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5"
            >
              <Archive className="w-3.5 h-3.5" />
              Clear {log.archived.count} Archived ({formatSize(log.archived.totalSize)})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Log File Row Component
function LogFileRow({
  name,
  size,
  formatSize,
  onClear,
  onRotate,
}: {
  name: string;
  size: number;
  formatSize: (bytes: number) => string;
  onClear: () => void;
  onRotate: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-neutral-50 rounded-md">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-neutral-700">{name}</span>
        <span className="text-xs text-neutral-500">{formatSize(size)}</span>
      </div>
      <div className="flex gap-1">
        <button
          onClick={onRotate}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
          title="Rotate"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onClear}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
          title="Clear"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
