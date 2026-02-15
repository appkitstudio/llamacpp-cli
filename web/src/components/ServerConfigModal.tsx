import { useState, useEffect } from 'react';
import { X, Loader2, Save, RotateCcw, HardDrive, AlertTriangle } from 'lucide-react';
import { useUpdateServer, useModels } from '../hooks/useApi';
import type { Server } from '../types/api';

interface ServerConfigModalProps {
  server: Server | null;
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  model: string;
  alias: string;
  port: number;
  host: string;
  threads: number;
  ctxSize: number;
  gpuLayers: number;
  verbose: boolean;
  customFlags: string;
}

export function ServerConfigModal({ server, isOpen, onClose }: ServerConfigModalProps) {
  const updateServer = useUpdateServer();
  const { data: modelsData, isLoading: modelsLoading } = useModels();

  const [formData, setFormData] = useState<FormData>({
    model: '',
    alias: '',
    port: 9000,
    host: '127.0.0.1',
    threads: 4,
    ctxSize: 4096,
    gpuLayers: 60,
    verbose: false,
    customFlags: '',
  });

  const [restartAfterSave, setRestartAfterSave] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gpuLayersInput, setGpuLayersInput] = useState('60');

  const models = modelsData?.models || [];

  // Initialize form when server changes
  useEffect(() => {
    if (server) {
      setFormData({
        model: server.modelName,
        alias: server.alias || '',
        port: server.port,
        host: server.host,
        threads: server.threads,
        ctxSize: server.ctxSize,
        gpuLayers: server.gpuLayers,
        verbose: server.verbose,
        customFlags: server.customFlags?.join(', ') || '',
      });
      setGpuLayersInput(server.gpuLayers.toString());
      setError(null);
    }
  }, [server]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server) return;

    setError(null);

    try {
      const customFlags = formData.customFlags
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      // If alias changed, include it (empty string means remove, same value means don't change)
      const aliasUpdate = formData.alias.trim() === (server.alias || '')
        ? undefined
        : formData.alias.trim() || null;

      // Check if model changed
      const modelUpdate = formData.model !== server.modelName ? formData.model : undefined;

      await updateServer.mutateAsync({
        id: server.id,
        data: {
          ...(modelUpdate && { model: modelUpdate }),
          ...(aliasUpdate !== undefined && { alias: aliasUpdate }),
          port: formData.port,
          host: formData.host,
          threads: formData.threads,
          ctxSize: formData.ctxSize,
          gpuLayers: isNaN(formData.gpuLayers) ? 60 : formData.gpuLayers,
          verbose: formData.verbose,
          customFlags: customFlags.length > 0 ? customFlags : undefined,
          restart: server.status === 'running' && restartAfterSave,
        },
      });

      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const formatContextSize = (size: number) => {
    if (size >= 1048576) return `${(size / 1048576).toFixed(1)}M tokens`;
    if (size >= 1024) return `${(size / 1024).toFixed(0)}K tokens`;
    return `${size} tokens`;
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(1)} KB`;
  };

  const modelChanged = server && formData.model !== server.modelName;

  if (!isOpen || !server) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Configure Server</h2>
            <p className="text-sm text-gray-500">{server.modelName.replace('.gguf', '')}</p>
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
          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Model
            </label>
            {modelsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : models.length === 0 ? (
              <div className="text-center py-4 text-sm text-gray-500">
                No models available
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                {models.map((model) => {
                  const isCurrentModel = model.filename === server.modelName;
                  const hasOtherServer = model.serversUsing > 0 && !isCurrentModel;
                  const canSelect = isCurrentModel || !hasOtherServer;
                  return (
                    <button
                      key={model.filename}
                      type="button"
                      onClick={() => canSelect && setFormData({ ...formData, model: model.filename })}
                      disabled={!canSelect}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        formData.model === model.filename
                          ? 'bg-gray-100 cursor-pointer'
                          : !canSelect
                          ? 'bg-gray-50 opacity-50 cursor-not-allowed'
                          : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <HardDrive className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-900 truncate">
                            {model.filename.replace('.gguf', '')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-xs text-gray-500">{formatSize(model.size)}</span>
                          {isCurrentModel && (
                            <span className="text-xs text-blue-600">current</span>
                          )}
                          {hasOtherServer && (
                            <span className="text-xs text-orange-600">in use</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {modelChanged && (
              <div className="flex items-start gap-2 mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Changing the model will stop the server and update its configuration. This may take a few moments.
                </p>
              </div>
            )}
          </div>

          {/* Alias */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Alias (optional)
            </label>
            <input
              type="text"
              value={formData.alias}
              onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
              placeholder="e.g., thinking, coder, gpt-oss"
              pattern="[a-zA-Z0-9_-]*"
              maxLength={64}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Friendly name (leave empty to remove)</p>
          </div>

          {/* Port */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Port
            </label>
            <input
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 9000 })}
              min={1024}
              max={65535}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
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
          </div>

          {/* Threads */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Threads
            </label>
            <input
              type="number"
              value={formData.threads}
              onChange={(e) => setFormData({ ...formData, threads: parseInt(e.target.value) || 1 })}
              min={1}
              max={256}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Number of CPU threads for inference</p>
          </div>

          {/* Context Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Context Size
            </label>
            <input
              type="number"
              value={formData.ctxSize || ''}
              onChange={(e) => setFormData({ ...formData, ctxSize: e.target.value === '' ? 0 : parseInt(e.target.value) })}
              min={512}
              max={2097152}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ctxSize: 16384 })}
                  className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
                >
                  16k
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ctxSize: 32768 })}
                  className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
                >
                  32k
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ctxSize: 65536 })}
                  className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
                >
                  64k
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ctxSize: 131072 })}
                  className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
                >
                  128k
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ctxSize: 262144 })}
                  className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
                >
                  256k
                </button>
              </div>
              {formData.ctxSize > 0 && (
                <span className="text-xs text-gray-500">{formatContextSize(formData.ctxSize)}</span>
              )}
            </div>
          </div>

          {/* GPU Layers */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              GPU Layers
            </label>
            <input
              type="number"
              value={gpuLayersInput}
              onChange={(e) => {
                const value = e.target.value;
                setGpuLayersInput(value);
                // Only update formData if it's a valid number
                if (value !== '' && value !== '-') {
                  const num = parseInt(value);
                  if (!isNaN(num)) {
                    setFormData({ ...formData, gpuLayers: num });
                  }
                }
              }}
              onBlur={() => {
                // On blur, ensure we have a valid number
                const num = parseInt(gpuLayersInput);
                if (isNaN(num) || gpuLayersInput === '' || gpuLayersInput === '-' || num < -1 || num > 999) {
                  setGpuLayersInput('60');
                  setFormData({ ...formData, gpuLayers: 60 });
                }
              }}
              min={-1}
              max={999}
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent ${
                (() => {
                  const num = parseInt(gpuLayersInput);
                  const isComplete = gpuLayersInput !== '' && gpuLayersInput !== '-' && !isNaN(num);
                  const isInvalid = isComplete && (num < -1 || num > 999);
                  return isInvalid
                    ? 'border-red-500 focus:ring-red-200'
                    : 'border-gray-200 focus:ring-gray-200';
                })()
              }`}
            />
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, gpuLayers: -1 });
                  setGpuLayersInput('-1');
                }}
                className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
              >
                All (-1)
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, gpuLayers: 60 });
                  setGpuLayersInput('60');
                }}
                className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
              >
                Recommended (60)
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, gpuLayers: 0 });
                  setGpuLayersInput('0');
                }}
                className="text-xs text-gray-600 hover:text-gray-900 hover:underline cursor-pointer"
              >
                CPU only (0)
              </button>
            </div>
          </div>

          {/* Verbose */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">Verbose Logging</label>
              <p className="text-xs text-gray-500">Log HTTP requests and responses</p>
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

          {/* Custom Flags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Custom Flags
            </label>
            <input
              type="text"
              value={formData.customFlags}
              onChange={(e) => setFormData({ ...formData, customFlags: e.target.value })}
              placeholder="--flash-attn, --cont-batching"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Comma-separated additional flags</p>
          </div>

          {/* Restart option (only show if server is running) */}
          {server.status === 'running' && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <input
                type="checkbox"
                id="restartAfterSave"
                checked={restartAfterSave}
                onChange={(e) => setRestartAfterSave(e.target.checked)}
                className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-200"
              />
              <label htmlFor="restartAfterSave" className="text-sm text-gray-700">
                Restart server to apply changes
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
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={updateServer.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait"
          >
            {updateServer.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                {server.status === 'running' && restartAfterSave ? (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Save & Restart
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save
                  </>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
