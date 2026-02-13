import { useState, useEffect } from 'react';
import { X, Loader2, Plus, HardDrive, AlertCircle } from 'lucide-react';
import { useCreateServer, useModels } from '../hooks/useApi';

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  model: string;
  alias: string;
  port: string; // Empty string means auto-assign
  host: string;
  threads: number;
  ctxSize: number;
  gpuLayers: number;
  verbose: boolean;
  customFlags: string;
}

// Smart defaults based on model size (matching CLI behavior)
function getSmartDefaults(modelSize: number): { threads: number; ctxSize: number; gpuLayers: number } {
  const cpuCores = navigator.hardwareConcurrency || 8;
  const threads = Math.max(1, Math.floor(cpuCores / 2));

  let ctxSize: number;
  if (modelSize < 1e9) {
    ctxSize = 2048;
  } else if (modelSize < 3e9) {
    ctxSize = 4096;
  } else if (modelSize < 6e9) {
    ctxSize = 8192;
  } else {
    ctxSize = 16384;
  }

  return {
    threads,
    ctxSize,
    gpuLayers: 60, // Metal auto-detects optimal
  };
}

export function CreateServerModal({ isOpen, onClose }: CreateServerModalProps) {
  const createServer = useCreateServer();
  const { data: modelsData, isLoading: modelsLoading } = useModels();

  const [formData, setFormData] = useState<FormData>({
    model: '',
    alias: '',
    port: '',
    host: '127.0.0.1',
    threads: 4,
    ctxSize: 4096,
    gpuLayers: 60,
    verbose: false,
    customFlags: '',
  });

  const [error, setError] = useState<string | null>(null);

  const models = modelsData?.models || [];

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        model: '',
        alias: '',
        port: '',
        host: '127.0.0.1',
        threads: 4,
        ctxSize: 4096,
        gpuLayers: 60,
        verbose: false,
        customFlags: '',
      });
      setError(null);
    }
  }, [isOpen]);

  // Update defaults when model changes
  useEffect(() => {
    if (formData.model) {
      const selectedModel = models.find(m => m.filename === formData.model);
      if (selectedModel) {
        const defaults = getSmartDefaults(selectedModel.size);
        setFormData(prev => ({
          ...prev,
          threads: defaults.threads,
          ctxSize: defaults.ctxSize,
          gpuLayers: defaults.gpuLayers,
        }));
      }
    }
  }, [formData.model, models]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.model) {
      setError('Please select a model');
      return;
    }

    setError(null);

    try {
      const customFlags = formData.customFlags
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      await createServer.mutateAsync({
        model: formData.model,
        alias: formData.alias.trim() || undefined,
        port: formData.port ? parseInt(formData.port) : undefined,
        host: formData.host,
        threads: formData.threads,
        ctxSize: formData.ctxSize,
        gpuLayers: formData.gpuLayers,
        verbose: formData.verbose,
        customFlags: customFlags.length > 0 ? customFlags : undefined,
      });

      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(1)} KB`;
  };

  const formatContextSize = (size: number) => {
    if (size >= 1048576) return `${(size / 1048576).toFixed(1)}M tokens`;
    if (size >= 1024) return `${(size / 1024).toFixed(0)}K tokens`;
    return `${size} tokens`;
  };

  const selectedModel = models.find(m => m.filename === formData.model);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create Server</h2>
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
                No models available. Download a model first.
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                {models.map((model) => {
                  const hasServer = model.serversUsing > 0;
                  return (
                    <button
                      key={model.filename}
                      type="button"
                      onClick={() => !hasServer && setFormData({ ...formData, model: model.filename })}
                      disabled={hasServer}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        formData.model === model.filename
                          ? 'bg-gray-100 cursor-pointer'
                          : hasServer
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
                          {hasServer && (
                            <span className="text-xs text-orange-600">in use</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedModel && (
              <p className="text-xs text-gray-500 mt-1">
                {formatSize(selectedModel.size)} · Smart defaults applied
              </p>
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
            <p className="text-xs text-gray-500 mt-1">Friendly name for this server (alphanumeric, hyphens, underscores)</p>
          </div>

          {/* Port */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Port
            </label>
            <input
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: e.target.value })}
              placeholder="Auto-assign (9000-9999)"
              min={1024}
              max={65535}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Leave empty to auto-assign</p>
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
              value={formData.gpuLayers}
              onChange={(e) => setFormData({ ...formData, gpuLayers: parseInt(e.target.value) || 0 })}
              min={0}
              max={999}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">Layers to offload to GPU (0 = CPU only)</p>
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

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
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
            disabled={createServer.isPending || !formData.model}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {createServer.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Create Server
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
