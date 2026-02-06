import { useState, useMemo } from 'react';
import { useModels, useDeleteModel, useDownloadJobs } from '../hooks/useApi';
import { HardDrive, Server, Trash2, Clock, Plus, Loader2 } from 'lucide-react';
import { SearchModal } from '../components/SearchModal';
import { DownloadProgress } from '../components/DownloadProgress';
import { useQueryClient } from '@tanstack/react-query';

interface ModelsProps {
  searchQuery?: string;
}

export function Models({ searchQuery = '' }: ModelsProps) {
  const queryClient = useQueryClient();
  const { data: modelsData, isLoading } = useModels();
  const deleteModel = useDeleteModel();
  const { data: jobsData } = useDownloadJobs(true);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Check if there are active downloads
  const hasActiveDownloads = (jobsData?.jobs || []).some(
    job => job.status === 'pending' || job.status === 'downloading'
  );

  const handleDownloadComplete = () => {
    // Refresh models list when download completes
    queryClient.invalidateQueries({ queryKey: ['models'] });
  };

  const models = modelsData?.models || [];

  const filteredModels = useMemo(() => {
    if (!searchQuery) return models;
    const query = searchQuery.toLowerCase();
    return models.filter(model =>
      model.filename.toLowerCase().includes(query)
    );
  }, [models, searchQuery]);

  const handleDelete = async (name: string, serversUsing: number) => {
    if (serversUsing > 0) {
      if (!confirm(`Model "${name}" is used by ${serversUsing} server(s). Delete the model AND all associated servers?`)) {
        return;
      }
    } else {
      if (!confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    }

    setActionLoading(name);
    try {
      await deleteModel.mutateAsync({ name, cascade: serversUsing > 0 });
    } finally {
      setActionLoading(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(1)} KB`;
  };

  const formatDate = (dateStr: string | Date) => {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-gray-500 text-center">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header with Pull button */}
      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-gray-500">
          {models.length} model{models.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={() => setShowSearchModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Pull Model
        </button>
      </div>

      {filteredModels.length === 0 ? (
        <div className="text-center py-12">
          {searchQuery ? (
            <>
              <p className="text-gray-500">No models matching "{searchQuery}"</p>
              <p className="text-sm text-gray-400 mt-1">Try a different search term</p>
            </>
          ) : (
            <>
              <p className="text-gray-500">No models found</p>
              <p className="text-sm text-gray-400 mt-1">
                Click "Pull Model" to download from Hugging Face
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {filteredModels.map((model) => (
            <div
              key={model.filename}
              className="py-5 hover:bg-gray-50 -mx-4 px-4 transition-colors group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-medium text-gray-900">
                    {model.filename.replace('.gguf', '')}
                  </h3>

                  {/* Tags */}
                  <div className="flex items-center gap-2 mt-2">
                    {model.serversUsing > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded border border-green-200 bg-green-50 text-xs font-medium text-green-700">
                        active
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded border border-gray-200 text-xs font-medium text-gray-600">
                      gguf
                    </span>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4" />
                      {formatSize(model.size)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Server className="w-4 h-4" />
                      {model.serversUsing} server{model.serversUsing !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      {formatDate(model.modified)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(model.filename, model.serversUsing)}
                  disabled={actionLoading === model.filename}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-100 cursor-pointer disabled:cursor-wait"
                  title="Delete model"
                >
                  {actionLoading === model.filename ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search Modal */}
      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onDownloadComplete={handleDownloadComplete}
      />

      {/* Download Progress Indicator */}
      {hasActiveDownloads && <DownloadProgress />}
    </div>
  );
}
