import { useSystemStatus, useServers } from '../hooks/useApi';
import { Server, Box, Activity, Clock } from 'lucide-react';

export function Dashboard() {
  const { data: status } = useSystemStatus();
  const { data: serversData } = useServers();

  const runningServers = serversData?.servers.filter(s => s.status === 'running') || [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 dark:text-white mb-2">
          Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage your local llama.cpp servers
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Total Servers</span>
            <Server className="w-4 h-4 text-gray-400" />
          </div>
          <div className="text-3xl font-semibold text-gray-900 dark:text-white">
            {status?.servers.total || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Running</span>
            <Activity className="w-4 h-4 text-green-500" />
          </div>
          <div className="text-3xl font-semibold text-green-600 dark:text-green-500">
            {status?.servers.running || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Stopped</span>
            <Clock className="w-4 h-4 text-gray-400" />
          </div>
          <div className="text-3xl font-semibold text-gray-900 dark:text-white">
            {status?.servers.stopped || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Models</span>
            <Box className="w-4 h-4 text-gray-400" />
          </div>
          <div className="text-3xl font-semibold text-gray-900 dark:text-white">
            {status?.models.total || 0}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Running Servers
          </h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {runningServers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">No servers running</p>
            </div>
          ) : (
            runningServers.map((server) => (
              <div key={server.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                      {server.modelName}
                    </h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                      <span>Port {server.port}</span>
                      <span>•</span>
                      <span>{server.threads} threads</span>
                      <span>•</span>
                      <span>Context {server.ctxSize}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      Running
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
