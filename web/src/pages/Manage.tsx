import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAdminLogs,
  useAdmin,
  useRotateLogs,
  useClearArchivedLogs,
  useUpdateLogConfig,
  useRouter,
  useStartRouter,
  useStopRouter,
  useRestartRouter,
} from '../hooks/useApi';
import { AdminServiceSection } from '../components/manage/AdminServiceSection';
import { RouterServiceSection } from '../components/manage/RouterServiceSection';
import { LogManagementSection } from '../components/manage/LogManagementSection';
import { RouterConfigModal } from '../components/RouterConfigModal';

export function Manage() {
  const queryClient = useQueryClient();
  const { data: logsData, isLoading } = useAdminLogs();
  const { data: adminData } = useAdmin();
  const rotateLogs = useRotateLogs();
  const clearArchivedLogs = useClearArchivedLogs();
  const updateLogConfig = useUpdateLogConfig();

  // Router hooks
  const { data: routerData } = useRouter();
  const startRouter = useStartRouter();
  const stopRouter = useStopRouter();
  const restartRouter = useRestartRouter();

  // Main section collapse states
  const [showAdminServiceSection, setShowAdminServiceSection] = useState(false);
  const [showRouterSection, setShowRouterSection] = useState(false);
  const [showLogManagementSection, setShowLogManagementSection] = useState(false);

  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [showRouterConfigModal, setShowRouterConfigModal] = useState(false);
  const [routerActionLoading, setRouterActionLoading] = useState<'start' | 'stop' | 'restart' | null>(null);

  // Helper function
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  // Callback handlers

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


  const handleSaveConfig = async (config: any) => {
    await updateLogConfig.mutateAsync(config);
  };

  // Router action handlers
  const handleStartRouter = async () => {
    setRouterActionLoading('start');
    try {
      await startRouter.mutateAsync();
      await queryClient.refetchQueries({ queryKey: ['router'] });
    } finally {
      setRouterActionLoading(null);
    }
  };

  const handleStopRouter = async () => {
    setRouterActionLoading('stop');
    try {
      await stopRouter.mutateAsync();
      await queryClient.refetchQueries({ queryKey: ['router'] });
    } finally {
      setRouterActionLoading(null);
    }
  };

  const handleRestartRouter = async () => {
    setRouterActionLoading('restart');
    try {
      await restartRouter.mutateAsync();
      await queryClient.refetchQueries({ queryKey: ['router'] });
    } finally {
      setRouterActionLoading(null);
    }
  };

  if (isLoading && !logsData) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-neutral-500 text-center">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Service Management</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Manage services, logs, and system configuration
        </p>
      </div>

      {/* Admin Service Section */}
      <AdminServiceSection
        adminData={adminData}
        isOpen={showAdminServiceSection}
        onToggle={() => setShowAdminServiceSection(!showAdminServiceSection)}
      />

      {/* Router Service Section */}
      <RouterServiceSection
        isOpen={showRouterSection}
        onToggle={() => setShowRouterSection(!showRouterSection)}
        routerData={routerData}
        routerActionLoading={routerActionLoading}
        onStart={handleStartRouter}
        onStop={handleStopRouter}
        onRestart={handleRestartRouter}
        onConfigure={() => setShowRouterConfigModal(true)}
      />

      {/* Log Management Section */}
      <LogManagementSection
        isOpen={showLogManagementSection}
        onToggle={() => setShowLogManagementSection(!showLogManagementSection)}
        logsData={logsData}
        onRotateLogs={handleRotateLogs}
        onClearArchived={handleClearArchived}
        onUpdateConfig={handleSaveConfig}
        formatSize={formatSize}
        updateConfigPending={updateLogConfig.isPending}
      />

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

      {/* Router Config Modal */}
      <RouterConfigModal
        router={routerData || null}
        isOpen={showRouterConfigModal}
        onClose={() => setShowRouterConfigModal(false)}
      />
    </div>
  );
}
