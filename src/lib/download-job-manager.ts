import * as path from 'path';
import { modelDownloader, DownloadProgress } from './model-downloader';
import { stateManager } from './state-manager';

export type DownloadJobStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadJob {
  id: string;
  repo: string;
  filename: string;
  status: DownloadJobStatus;
  progress: {
    downloaded: number;
    total: number;
    percentage: number;
    speed: string;
  } | null;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

interface InternalJob extends DownloadJob {
  abortController: AbortController;
}

/**
 * Manages download jobs with progress tracking and cancellation support
 */
class DownloadJobManager {
  private jobs: Map<string, InternalJob> = new Map();
  private jobCounter = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Auto-cleanup completed/failed jobs after 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupOldJobs(), 60000);
  }

  /**
   * Create a new download job
   */
  createJob(repo: string, filename: string): string {
    const id = `download-${Date.now()}-${++this.jobCounter}`;
    const abortController = new AbortController();

    const job: InternalJob = {
      id,
      repo,
      filename,
      status: 'pending',
      progress: null,
      createdAt: new Date().toISOString(),
      abortController,
    };

    this.jobs.set(id, job);

    // Start download asynchronously
    this.startDownload(job);

    return id;
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    // Return public job info (without abortController)
    return this.toPublicJob(job);
  }

  /**
   * List all jobs
   */
  listJobs(): DownloadJob[] {
    return Array.from(this.jobs.values()).map(job => this.toPublicJob(job));
  }

  /**
   * Cancel a download job
   */
  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.status === 'pending' || job.status === 'downloading') {
      job.abortController.abort();
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      return true;
    }

    return false;
  }

  /**
   * Delete a job from the list
   */
  deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    // Cancel if still running
    if (job.status === 'pending' || job.status === 'downloading') {
      job.abortController.abort();
    }

    this.jobs.delete(id);
    return true;
  }

  /**
   * Start the download process for a job
   */
  private async startDownload(job: InternalJob): Promise<void> {
    job.status = 'downloading';

    try {
      const modelsDir = await stateManager.getModelsDirectory();

      await modelDownloader.downloadModel(
        job.repo,
        job.filename,
        (progress: DownloadProgress) => {
          job.progress = {
            downloaded: progress.downloaded,
            total: progress.total,
            percentage: progress.percentage,
            speed: progress.speed,
          };
        },
        modelsDir,
        {
          silent: true,
          signal: job.abortController.signal,
        }
      );

      // Only mark as completed if not cancelled
      if (job.status === 'downloading') {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        // Ensure progress shows 100%
        if (job.progress) {
          job.progress.percentage = 100;
        }
      }
    } catch (error) {
      // Check if this was a cancellation (status may have been set by cancelJob)
      const currentStatus = job.status as DownloadJobStatus;
      if (currentStatus === 'cancelled') {
        return;
      }

      const message = (error as Error).message;
      if (message.includes('cancelled') || message.includes('interrupted')) {
        job.status = 'cancelled';
      } else {
        job.status = 'failed';
        job.error = message;
      }
      job.completedAt = new Date().toISOString();
    }
  }

  /**
   * Convert internal job to public job (strips internal fields)
   */
  private toPublicJob(job: InternalJob): DownloadJob {
    const { abortController, ...publicJob } = job;
    return publicJob;
  }

  /**
   * Clean up old completed/failed jobs
   */
  private cleanupOldJobs(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    for (const [id, job] of this.jobs.entries()) {
      if (
        job.completedAt &&
        new Date(job.completedAt).getTime() < fiveMinutesAgo
      ) {
        this.jobs.delete(id);
      }
    }
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Cancel all active downloads
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'downloading') {
        job.abortController.abort();
      }
    }
  }
}

// Export singleton instance
export const downloadJobManager = new DownloadJobManager();
