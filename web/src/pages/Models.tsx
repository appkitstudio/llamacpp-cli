import { useState, useMemo } from 'react';
import { useModels, useDeleteModel, useDownloadJobs } from '../hooks/useApi';
import { HardDrive, Server, Trash2, Clock, Loader2, Download } from 'lucide-react';
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

  const hasActiveDownloads = (jobsData?.jobs || []).some(
    job => job.status === 'pending' || job.status === 'downloading'
  );

  const handleDownloadComplete = () => {
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
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-neutral-500 text-center">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Models</h1>
          <p className="text-sm text-neutral-600 mt-1">
            {models.length} model{models.length !== 1 ? 's' : ''} available
          </p>
        </div>
        <button
          onClick={() => setShowSearchModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Pull Model
        </button>
      </div>

      {filteredModels.length === 0 ? (
        <div className="text-center py-16 bg-white border border-neutral-200 rounded-lg">
          {searchQuery ? (
            <>
              <p className="text-neutral-600 text-base mb-2">No models matching "{searchQuery}"</p>
              <p className="text-sm text-neutral-500">Try a different search term</p>
            </>
          ) : (
            <>
              <p className="text-neutral-600 text-base mb-2">No models found</p>
              <p className="text-sm text-neutral-500 mb-6">
                Download models from Hugging Face to get started
              </p>
              <button
                onClick={() => setShowSearchModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Pull Model
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModels.map((model) => (
            <div
              key={model.filename}
              className="group bg-white border border-neutral-200 rounded-lg p-5 hover:border-neutral-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-neutral-900 truncate mb-2">
                    {model.filename.replace('.gguf', '')}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {model.serversUsing > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-green-200/50 bg-green-50 text-xs font-medium text-green-700">
                        active
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                      gguf
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
                  <span>{formatSize(model.size)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <Server className="w-3.5 h-3.5 text-neutral-400" />
                  <span>{model.serversUsing} server{model.serversUsing !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <Clock className="w-3.5 h-3.5 text-neutral-400" />
                  <span>{formatDate(model.modified)}</span>
                </div>
              </div>

              {/* Delete Action */}
              <button
                onClick={() => handleDelete(model.filename, model.serversUsing)}
                disabled={actionLoading === model.filename}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-100 cursor-pointer disabled:cursor-wait"
              >
                {actionLoading === model.filename ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deleting
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </>
                )}
              </button>
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
