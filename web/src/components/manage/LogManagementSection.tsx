import { useState } from 'react';
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
} from 'lucide-react';
import type { AdminLogsResponse, ServerLogInfo, UpdateLogConfigRequest } from '../../types/api';

interface LogManagementSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  logsData: AdminLogsResponse | undefined;
  onClearLogs: (
    type: 'server' | 'router' | 'admin',
    serverId: string | undefined,
    streams: ('stdout' | 'stderr' | 'httpLog')[]
  ) => void;
  onRotateLogs: (
    type: 'server' | 'router' | 'admin',
    serverId: string | undefined,
    streams: ('stdout' | 'stderr' | 'httpLog')[]
  ) => void;
  onClearArchived: (serverId?: string) => void;
  onClearAll: (includeArchived: boolean) => void;
  onUpdateConfig: (config: UpdateLogConfigRequest) => Promise<void>;
  formatSize: (bytes: number) => string;
  updateConfigPending: boolean;
}

export function LogManagementSection({
  isOpen,
  onToggle,
  logsData,
  onClearLogs,
  onRotateLogs,
  onClearArchived,
  onClearAll,
  onUpdateConfig,
  formatSize,
  updateConfigPending,
}: LogManagementSectionProps) {
  // Subsection collapse states
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

  const currentConfig = logsData?.config || {
    autoRotate: { enabled: false, intervalHours: 24, thresholdMB: 100 },
    autoDelete: { enabled: false, intervalHours: 24, afterDays: 30 },
  };

  const mergedConfig = {
    autoRotate: { ...currentConfig.autoRotate, ...configChanges.autoRotate },
    autoDelete: { ...currentConfig.autoDelete, ...configChanges.autoDelete },
  };

  const handleSaveConfig = async () => {
    await onUpdateConfig(configChanges);
    setConfigChanges({});
    setShowConfigSection(false);
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-lg mb-6 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
            <Database className="w-5 h-5 text-orange-600" />
          </div>
          <div className="text-left">
            <h3 className="text-base font-semibold text-neutral-900">Log Management</h3>
            <p className="text-sm text-neutral-500">
              {formatSize(logsData?.summary.grandTotal || 0)} across {logsData?.servers.length || 0} servers
            </p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-neutral-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-neutral-400" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-neutral-200">
          {/* Summary Section */}
          <div className="px-5 py-4 border-b border-neutral-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-700 mb-1 font-medium">Total Size</p>
                <p className="text-lg font-semibold text-blue-900">
                  {formatSize(logsData?.summary.grandTotal || 0)}
                </p>
              </div>
              <div className="text-center p-3 bg-neutral-50 rounded-lg">
                <p className="text-xs text-neutral-500 mb-1">Current</p>
                <p className="text-lg font-semibold text-neutral-900">
                  {formatSize(logsData?.summary.totalCurrent || 0)}
                </p>
              </div>
              <div className="text-center p-3 bg-neutral-50 rounded-lg">
                <p className="text-xs text-neutral-500 mb-1">Archived</p>
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
                onClick={() => onClearAll(false)}
                className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All Current
              </button>
              <button
                onClick={() => onClearAll(true)}
                className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All + Archived
              </button>
            </div>
          </div>

          {/* Automation Configuration Subsection */}
          <div className="border-b border-neutral-200">
            <button
              onClick={() => setShowConfigSection(!showConfigSection)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-neutral-600" />
                <div className="text-left">
                  <h3 className="text-base font-semibold text-neutral-900">Automation Configuration</h3>
                  <p className="text-sm text-neutral-500">Auto-rotation and auto-deletion settings</p>
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
                      disabled={updateConfigPending}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {updateConfigPending ? (
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

          {/* Server Logs Subsection */}
          <div className="border-b border-neutral-200">
            <button
              onClick={() => setShowServerLogsSection(!showServerLogsSection)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-neutral-600" />
                <div className="text-left">
                  <h3 className="text-base font-semibold text-neutral-900">Server Logs</h3>
                  <p className="text-sm text-neutral-500">
                    {logsData?.servers.length || 0} servers •{' '}
                    {formatSize(
                      logsData?.servers.reduce(
                        (total: number, s: ServerLogInfo) => total + s.currentTotal + s.archived.totalSize,
                        0
                      ) || 0
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
                        onClear={onClearLogs}
                        onRotate={onRotateLogs}
                        onClearArchived={onClearArchived}
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

          {/* Router Logs Subsection */}
          <div className="border-b border-neutral-200">
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
              <div className="border-t border-neutral-200">
                <ServiceLogCard
                  title="Router Logs"
                  type="router"
                  log={logsData.router}
                  onClear={onClearLogs}
                  onRotate={onRotateLogs}
                  onClearArchived={onClearArchived}
                  formatSize={formatSize}
                />
              </div>
            )}
          </div>

          {/* Admin Logs Subsection */}
          <div className="border-b border-neutral-200">
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
              <div className="border-t border-neutral-200">
                <ServiceLogCard
                  title="Admin Logs"
                  type="admin"
                  log={logsData.admin}
                  onClear={onClearLogs}
                  onRotate={onRotateLogs}
                  onClearArchived={onClearArchived}
                  formatSize={formatSize}
                />
              </div>
            )}
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
          <span className="text-neutral-900 font-medium">
            {server.archived.count} ({formatSize(server.archived.totalSize)})
          </span>
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
