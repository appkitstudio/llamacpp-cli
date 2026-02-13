import { useState, useEffect, useRef } from 'react';
import { X, Search, Download, ArrowLeft, Loader2, HardDrive, Heart, ChevronRight } from 'lucide-react';
import { useSearchModels, useModelFiles, useDownloadModel, useDownloadJob } from '../hooks/useApi';
import type { HFModelResult } from '../types/api';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadComplete: () => void;
}

type ModalState = 'search' | 'files' | 'downloading';

export function SearchModal({ isOpen, onClose, onDownloadComplete }: SearchModalProps) {
  const [state, setState] = useState<ModalState>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<HFModelResult | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const searchMutation = useSearchModels();
  const downloadMutation = useDownloadModel();

  const { data: filesData, isLoading: filesLoading } = useModelFiles(
    state === 'files' && selectedModel ? selectedModel.modelId : null
  );

  const { data: jobData } = useDownloadJob(activeJobId);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && state === 'search') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, state]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setState('search');
      setSearchQuery('');
      setSelectedModel(null);
      setActiveJobId(null);
      searchMutation.reset();
    }
  }, [isOpen]);

  // Handle download completion
  useEffect(() => {
    if (jobData?.job?.status === 'completed') {
      onDownloadComplete();
      onClose();
    } else if (jobData?.job?.status === 'failed') {
      // Stay in downloading state to show error
    }
  }, [jobData?.job?.status, onDownloadComplete, onClose]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchMutation.mutate({ query: searchQuery.trim() });
    }
  };

  const handleSelectModel = (model: HFModelResult) => {
    setSelectedModel(model);
    setState('files');
  };

  const handleDownload = async (filename: string) => {
    if (!selectedModel) return;

    try {
      const result = await downloadMutation.mutateAsync({
        repo: selectedModel.modelId,
        filename,
      });
      setActiveJobId(result.jobId);
      setState('downloading');
    } catch (error) {
      // Error handled by mutation
    }
  };

  const handleBack = () => {
    if (state === 'files') {
      setState('search');
      setSelectedModel(null);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(1)} KB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {state === 'files' && (
              <button
                onClick={handleBack}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900">
              {state === 'search' && 'Pull Model'}
              {state === 'files' && selectedModel?.modelName}
              {state === 'downloading' && 'Downloading'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {state === 'search' && (
            <div className="p-4">
              {/* Search Input */}
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Hugging Face models..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
                  />
                </div>
              </form>

              {/* Results */}
              <div className="mt-4">
                {searchMutation.isPending && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                )}

                {searchMutation.isError && (
                  <p className="text-center py-8 text-red-600 text-sm">
                    Search failed. Please try again.
                  </p>
                )}

                {searchMutation.isSuccess && searchMutation.data.results.length === 0 && (
                  <p className="text-center py-8 text-gray-500 text-sm">
                    No GGUF models found for "{searchQuery}"
                  </p>
                )}

                {searchMutation.isSuccess && searchMutation.data.results.length > 0 && (
                  <div className="space-y-1">
                    {searchMutation.data.results.map((model) => (
                      <button
                        key={model.modelId}
                        onClick={() => handleSelectModel(model)}
                        className="w-full text-left px-3 py-3 hover:bg-gray-50 rounded-lg transition-colors group cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {model.modelName}
                            </div>
                            <div className="text-sm text-gray-500 truncate">
                              {model.author}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 ml-4">
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Download className="w-3.5 h-3.5" />
                              {formatNumber(model.downloads)}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <Heart className="w-3.5 h-3.5" />
                              {formatNumber(model.likes)}
                            </span>
                            <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {!searchMutation.isPending && !searchMutation.isSuccess && (
                  <p className="text-center py-8 text-gray-500 text-sm">
                    Search for GGUF models on Hugging Face
                  </p>
                )}
              </div>
            </div>
          )}

          {state === 'files' && (
            <div className="p-4">
              {filesLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              )}

              {filesData && filesData.files.length === 0 && (
                <p className="text-center py-8 text-gray-500 text-sm">
                  No GGUF files found in this repository
                </p>
              )}

              {filesData && filesData.files.length > 0 && (
                <div className="space-y-1">
                  {filesData.files.map((filename) => (
                    <button
                      key={filename}
                      onClick={() => handleDownload(filename)}
                      disabled={downloadMutation.isPending}
                      className="w-full text-left px-3 py-3 hover:bg-gray-50 rounded-lg transition-colors group disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <HardDrive className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-900 truncate">
                            {filename}
                          </span>
                        </div>
                        <Download className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {state === 'downloading' && (
            <div className="p-6">
              <div className="text-center">
                {jobData?.job?.status === 'failed' ? (
                  <>
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                      <X className="w-6 h-6 text-red-600" />
                    </div>
                    <h3 className="font-medium text-gray-900 mb-2">Download Failed</h3>
                    <p className="text-sm text-gray-500 mb-4">{jobData.job.error}</p>
                    <button
                      onClick={handleBack}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
                    >
                      Try Again
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-gray-400" />
                    <h3 className="font-medium text-gray-900 mb-1">
                      {jobData?.job?.filename || 'Starting download...'}
                    </h3>
                    {jobData?.job?.progress && (
                      <>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div
                            className="bg-gray-900 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${jobData.job.progress.percentage}%` }}
                          />
                        </div>
                        <p className="text-sm text-gray-500">
                          {formatBytes(jobData.job.progress.downloaded)} / {formatBytes(jobData.job.progress.total)}
                          {' · '}
                          {jobData.job.progress.speed}
                        </p>
                      </>
                    )}
                    {!jobData?.job?.progress && (
                      <p className="text-sm text-gray-500">Connecting...</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
