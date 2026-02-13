import { useState, useMemo } from 'react';
import { useModels, useDeleteModel, useDownloadJobs } from '../hooks/useApi';
import { HardDrive, Server, Trash2, Clock, Loader2, Download, LayoutGrid, List } from 'lucide-react';
import { SearchModal } from '../components/SearchModal';
import { DownloadProgress } from '../components/DownloadProgress';
import { useQueryClient } from '@tanstack/react-query';

interface ModelsProps {
  searchQuery?: string;
}

type ModelFilter = 'all' | 'active' | 'inactive';
type ViewMode = 'grid' | 'list';

export function Models({ searchQuery = '' }: ModelsProps) {
  const queryClient = useQueryClient();
  const { data: modelsData, isLoading } = useModels();
  const deleteModel = useDeleteModel();
  const { data: jobsData } = useDownloadJobs(true);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [filter, setFilter] = useState<ModelFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('llamacpp_models_view');
    return (saved as ViewMode) || 'grid';
  });

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('llamacpp_models_view', mode);
  };

  const hasActiveDownloads = (jobsData?.jobs || []).some(
    job => job.status === 'pending' || job.status === 'downloading'
  );

  const handleDownloadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['models'] });
  };

  const models = modelsData?.models || [];

  const filteredModels = useMemo(() => {
    let filtered = models;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(model =>
        model.filename.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (filter === 'active') {
      filtered = filtered.filter(model => model.serversUsing > 0);
    } else if (filter === 'inactive') {
      filtered = filtered.filter(model => model.serversUsing === 0);
    }

    return filtered;
  }, [models, searchQuery, filter]);

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

  const activeModels = models.filter(m => m.serversUsing > 0);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">Models</h1>
          <p className="text-sm text-neutral-600 mt-1">
            {models.length} model{models.length !== 1 ? 's' : ''} available
            {activeModels.length > 0 && ` • ${activeModels.length} active`}
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

      {/* Filter Buttons and View Toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
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
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all cursor-pointer ${
              filter === 'active'
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('inactive')}
            className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all cursor-pointer ${
              filter === 'inactive'
                ? 'bg-neutral-900 text-white border-neutral-900'
                : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
            }`}
          >
            Inactive
          </button>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 p-1 bg-white border border-neutral-200 rounded-lg">
          <button
            onClick={() => handleViewChange('grid')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleViewChange('list')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {filteredModels.length === 0 ? (
        <div className="text-center py-16 bg-white border border-neutral-200 rounded-lg">
          {searchQuery ? (
            <>
              <p className="text-neutral-600 text-base mb-2">No models matching "{searchQuery}"</p>
              <p className="text-sm text-neutral-500">Try a different search term</p>
            </>
          ) : filter !== 'all' && models.length > 0 ? (
            <>
              <p className="text-neutral-600 text-base mb-2">No {filter} models</p>
              <p className="text-sm text-neutral-500">Try a different filter</p>
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
      ) : viewMode === 'grid' ? (
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
      ) : (
        /* List View */
        <div className="bg-white border border-neutral-200 rounded-lg divide-y divide-neutral-200">
          {filteredModels.map((model) => (
            <div
              key={model.filename}
              className="group px-5 py-4 hover:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <HardDrive className="w-5 h-5 text-neutral-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-neutral-900 truncate">
                      {model.filename.replace('.gguf', '')}
                    </h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-neutral-600">{formatSize(model.size)}</span>
                      <span className="text-xs text-neutral-400">•</span>
                      <span className="text-xs text-neutral-600">
                        {model.serversUsing} server{model.serversUsing !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-neutral-400">•</span>
                      <span className="text-xs text-neutral-600">{formatDate(model.modified)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {model.serversUsing > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-green-200/50 bg-green-50 text-xs font-medium text-green-700">
                        active
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                      gguf
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(model.filename, model.serversUsing)}
                    disabled={actionLoading === model.filename}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer disabled:cursor-wait"
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
