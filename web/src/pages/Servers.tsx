import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useServers, useStartServer, useStopServer } from '../hooks/useApi';
import { Play, Square, Cpu, Database, Loader2, Settings, Plus, FileText } from 'lucide-react';
import { ServerConfigModal } from '../components/ServerConfigModal';
import { CreateServerModal } from '../components/CreateServerModal';
import type { Server } from '../types/api';

type ServerFilter = 'all' | 'running' | 'stopped';

export function Servers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: serversData, isLoading } = useServers();
  const startServer = useStartServer();
  const stopServer = useStopServer();

  const [actionLoading, setActionLoading] = useState<{ id: string; action: 'start' | 'stop' } | null>(null);
  const [configServer, setConfigServer] = useState<Server | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState<ServerFilter>('all');

  const pendingAction = useRef<{ id: string; expectedStatus: 'running' | 'stopped' } | null>(null);

  const servers = serversData?.servers || [];

  useEffect(() => {
    if (pendingAction.current && actionLoading) {
      const { id, expectedStatus } = pendingAction.current;
      const server = servers.find(s => s.id === id);
      if (server && server.status === expectedStatus) {
        pendingAction.current = null;
        setActionLoading(null);
      }
    }
  }, [servers, actionLoading]);

  const handleStart = async (id: string) => {
    setActionLoading({ id, action: 'start' });
    pendingAction.current = { id, expectedStatus: 'running' };
    try {
      await startServer.mutateAsync(id);
      await queryClient.refetchQueries({ queryKey: ['servers'] });
    } catch {
      pendingAction.current = null;
      setActionLoading(null);
    }
  };

  const handleStop = async (id: string) => {
    setActionLoading({ id, action: 'stop' });
    pendingAction.current = { id, expectedStatus: 'stopped' };
    try {
      await stopServer.mutateAsync(id);
      await queryClient.refetchQueries({ queryKey: ['servers'] });
    } catch {
      pendingAction.current = null;
      setActionLoading(null);
    }
  };

  const renderStatusBadge = (server: Server) => {
    const serverId = server.id;

    if (actionLoading?.id === serverId) {
      if (actionLoading.action === 'stop') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-700">
            <Loader2 className="w-3 h-3 animate-spin" />
            Stopping
          </span>
        );
      }
      if (actionLoading.action === 'start') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-700">
            <Loader2 className="w-3 h-3 animate-spin" />
            Starting
          </span>
        );
      }
    }

    if (server.status === 'running') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200/50">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          Running
        </span>
      );
    }

    if (server.status === 'crashed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-200/50">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
          Crashed
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

  const formatContextSize = (size: number) => {
    if (size >= 1024) return `${(size / 1024).toFixed(0)}K`;
    return size.toString();
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-neutral-500 text-center">Loading...</p>
      </div>
    );
  }

  const runningServers = servers.filter(s => s.status === 'running');

  // Apply filter
  const filteredServers = servers.filter(server => {
    if (filter === 'all') return true;
    if (filter === 'running') return server.status === 'running';
    if (filter === 'stopped') return server.status !== 'running';
    return true;
  });

  const displayRunning = filteredServers.filter(s => s.status === 'running');
  const displayStopped = filteredServers.filter(s => s.status !== 'running');

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Servers</h1>
          <p className="text-sm text-neutral-600 mt-1">
            {servers.length} server{servers.length !== 1 ? 's' : ''}
            {runningServers.length > 0 && ` • ${runningServers.length} running`}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Server
        </button>
      </div>

      {/* Filter Buttons */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all cursor-pointer ${
            filter === 'all'
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('running')}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all cursor-pointer ${
            filter === 'running'
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          Running
        </button>
        <button
          onClick={() => setFilter('stopped')}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all cursor-pointer ${
            filter === 'stopped'
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
          }`}
        >
          Stopped
        </button>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Running Servers */}
        {displayRunning.map((server) => (
          <div
            key={server.id}
            className="group bg-white border border-neutral-200 rounded-lg p-5 hover:border-neutral-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-neutral-900 truncate mb-1">
                  {server.modelName.replace('.gguf', '')}
                </h3>
                <p className="text-sm text-neutral-500">
                  localhost:{server.port}
                </p>
              </div>
              {renderStatusBadge(server)}
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Cpu className="w-3.5 h-3.5 text-neutral-400" />
                <span>{server.threads} threads</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Database className="w-3.5 h-3.5 text-neutral-400" />
                <span>{formatContextSize(server.ctxSize)} context • {server.gpuLayers} GPU layers</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => navigate(`/servers/${server.id}/logs`)}
                disabled={actionLoading?.id === server.id}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                title="Logs"
              >
                <FileText className="w-3.5 h-3.5" />
                Logs
              </button>
              <button
                onClick={() => setConfigServer(server)}
                disabled={actionLoading?.id === server.id}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                title="Config"
              >
                <Settings className="w-3.5 h-3.5" />
                Config
              </button>
              <button
                onClick={() => handleStop(server.id)}
                disabled={actionLoading?.id === server.id}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
                title="Stop"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            </div>
          </div>
        ))}

        {/* Stopped Servers */}
        {displayStopped.map((server) => (
          <div
            key={server.id}
            className="group bg-white border border-neutral-200 rounded-lg p-5 hover:border-neutral-300 hover:shadow-sm transition-all opacity-60 hover:opacity-100"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-neutral-900 truncate mb-1">
                  {server.modelName.replace('.gguf', '')}
                </h3>
                <p className="text-sm text-neutral-500">
                  localhost:{server.port}
                </p>
              </div>
              {renderStatusBadge(server)}
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Cpu className="w-3.5 h-3.5 text-neutral-400" />
                <span>{server.threads} threads</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Database className="w-3.5 h-3.5 text-neutral-400" />
                <span>{formatContextSize(server.ctxSize)} context</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => navigate(`/servers/${server.id}/logs`)}
                disabled={actionLoading?.id === server.id}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                title="Logs"
              >
                <FileText className="w-3.5 h-3.5" />
                Logs
              </button>
              <button
                onClick={() => setConfigServer(server)}
                disabled={actionLoading?.id === server.id}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                title="Config"
              >
                <Settings className="w-3.5 h-3.5" />
                Config
              </button>
              <button
                onClick={() => handleStart(server.id)}
                disabled={actionLoading?.id === server.id}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
                title="Start"
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredServers.length === 0 && servers.length > 0 && (
        <div className="text-center py-16 bg-white border border-neutral-200 rounded-lg">
          <p className="text-neutral-600 text-base mb-2">No {filter} servers</p>
          <p className="text-sm text-neutral-500">
            Try a different filter or create a new server
          </p>
        </div>
      )}

      {servers.length === 0 && (
        <div className="text-center py-16 bg-white border border-neutral-200 rounded-lg">
          <p className="text-neutral-600 text-base mb-2">No servers configured</p>
          <p className="text-sm text-neutral-500 mb-6">
            Create your first server to get started
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Server
          </button>
        </div>
      )}

      {/* Config Modal */}
      <ServerConfigModal
        server={configServer}
        isOpen={configServer !== null}
        onClose={() => setConfigServer(null)}
      />

      {/* Create Modal */}
      <CreateServerModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
}
