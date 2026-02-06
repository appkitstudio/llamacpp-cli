import { X, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useDownloadJobs, useCancelDownload } from '../hooks/useApi';
import type { DownloadJob } from '../types/api';

export function DownloadProgress() {
  const { data: jobsData } = useDownloadJobs(true);
  const cancelMutation = useCancelDownload();

  const jobs = jobsData?.jobs || [];

  // Filter to active jobs only (pending, downloading)
  const activeJobs = jobs.filter(
    job => job.status === 'pending' || job.status === 'downloading'
  );

  // Nothing to show if no active downloads
  if (activeJobs.length === 0) return null;

  const handleCancel = (jobId: string) => {
    cancelMutation.mutate(jobId);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80">
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
          <Download className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-700">
            {activeJobs.length} download{activeJobs.length !== 1 ? 's' : ''} in progress
          </span>
        </div>

        {/* Jobs */}
        <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
          {activeJobs.map((job) => (
            <JobItem
              key={job.id}
              job={job}
              onCancel={() => handleCancel(job.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface JobItemProps {
  job: DownloadJob;
  onCancel: () => void;
}

function JobItem({ job, onCancel }: JobItemProps) {
  const formatBytes = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(1)} KB`;
  };

  const getStatusIcon = () => {
    switch (job.status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />;
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {getStatusIcon()}
          <span className="text-sm font-medium text-gray-900 truncate">
            {job.filename}
          </span>
        </div>
        {(job.status === 'pending' || job.status === 'downloading') && (
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded transition-colors cursor-pointer"
            title="Cancel download"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {job.progress && (
        <>
          <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1">
            <div
              className="bg-gray-700 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${job.progress.percentage}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {formatBytes(job.progress.downloaded)} / {formatBytes(job.progress.total)}
            </span>
            <span>{job.progress.speed}</span>
          </div>
        </>
      )}

      {job.status === 'pending' && !job.progress && (
        <p className="text-xs text-gray-500">Starting...</p>
      )}

      {job.status === 'failed' && job.error && (
        <p className="text-xs text-red-500 truncate">{job.error}</p>
      )}

      {job.status === 'cancelled' && (
        <p className="text-xs text-gray-500">Cancelled</p>
      )}
    </div>
  );
}
