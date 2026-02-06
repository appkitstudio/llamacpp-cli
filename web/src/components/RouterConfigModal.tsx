import { useState, useEffect } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { useUpdateRouter } from '../hooks/useApi';
import type { RouterInfo } from '../types/api';

interface RouterConfigModalProps {
  router: RouterInfo | null;
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  port: number;
  host: string;
  verbose: boolean;
  requestTimeout: number;
  healthCheckInterval: number;
}

export function RouterConfigModal({ router, isOpen, onClose }: RouterConfigModalProps) {
  const updateRouter = useUpdateRouter();

  const [formData, setFormData] = useState<FormData>({
    port: 9100,
    host: '127.0.0.1',
    verbose: false,
    requestTimeout: 120000,
    healthCheckInterval: 5000,
  });

  const [restartAfterSave, setRestartAfterSave] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize form when router changes
  useEffect(() => {
    if (router?.config) {
      setFormData({
        port: router.config.port,
        host: router.config.host,
        verbose: router.config.verbose,
        requestTimeout: router.config.requestTimeout,
        healthCheckInterval: router.config.healthCheckInterval,
      });
      setError(null);
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!router) return;

    setError(null);

    try {
      const result = await updateRouter.mutateAsync({
        port: formData.port,
        host: formData.host,
        verbose: formData.verbose,
        requestTimeout: formData.requestTimeout,
        healthCheckInterval: formData.healthCheckInterval,
      });

      // If router is running and needs restart, prompt user
      if (result.needsRestart && router.isRunning && !restartAfterSave) {
        setError('Changes saved. Restart the router to apply them.');
        return;
      }

      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!isOpen || !router) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Configure Router</h2>
            <p className="text-sm text-gray-500">Unified model routing service</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Port */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Port
            </label>
            <input
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 9100 })}
              min={1024}
              max={65535}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Router service port (requires restart)</p>
          </div>

          {/* Host */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Host
            </label>
            <select
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent bg-white"
            >
              <option value="127.0.0.1">127.0.0.1 (localhost only)</option>
              <option value="0.0.0.0">0.0.0.0 (all interfaces)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">Network interface (requires restart)</p>
          </div>

          {/* Request Timeout */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Request Timeout
            </label>
            <input
              type="number"
              value={formData.requestTimeout / 1000}
              onChange={(e) => setFormData({ ...formData, requestTimeout: (parseInt(e.target.value) || 120) * 1000 })}
              min={10}
              max={600}
              step={10}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.requestTimeout / 1000}s - Maximum time to wait for backend responses
            </p>
          </div>

          {/* Health Check Interval */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Health Check Interval
            </label>
            <input
              type="number"
              value={formData.healthCheckInterval / 1000}
              onChange={(e) => setFormData({ ...formData, healthCheckInterval: (parseInt(e.target.value) || 5) * 1000 })}
              min={1}
              max={60}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.healthCheckInterval / 1000}s - How often to check backend server health
            </p>
          </div>

          {/* Verbose */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">Verbose Logging</label>
              <p className="text-xs text-gray-500">Log detailed request information</p>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, verbose: !formData.verbose })}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                formData.verbose ? 'bg-gray-900' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  formData.verbose ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          {/* Restart option (only show if router is running) */}
          {router.isRunning && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <input
                type="checkbox"
                id="restartAfterSave"
                checked={restartAfterSave}
                onChange={(e) => setRestartAfterSave(e.target.checked)}
                className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-200"
              />
              <label htmlFor="restartAfterSave" className="text-sm text-gray-700">
                Restart router to apply changes
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={updateRouter.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait cursor-pointer"
          >
            {updateRouter.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
