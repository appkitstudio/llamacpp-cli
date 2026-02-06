import type {
  Server,
  Model,
  SystemStatus,
  CreateServerRequest,
  UpdateServerRequest,
  ApiError,
  HFModelResult,
  DownloadJob,
} from '../types/api';

const API_BASE = '';  // Proxy handles routing

class ApiClient {
  private apiKey: string | null = null;

  setApiKey(key: string) {
    this.apiKey = key;
    localStorage.setItem('llamacpp_api_key', key);
  }

  getApiKey(): string | null {
    if (!this.apiKey) {
      this.apiKey = localStorage.getItem('llamacpp_api_key');
    }
    return this.apiKey;
  }

  clearApiKey() {
    this.apiKey = null;
    localStorage.removeItem('llamacpp_api_key');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const apiKey = this.getApiKey();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (apiKey && endpoint !== '/health') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error: ApiError = await response.json();
      throw new Error(error.details || error.error);
    }

    return response.json();
  }

  // Health
  async getHealth() {
    return this.request<{ status: string; uptime: number; timestamp: string }>('/health');
  }

  // System
  async getSystemStatus() {
    return this.request<SystemStatus>('/api/status');
  }

  // Servers
  async listServers() {
    return this.request<{ servers: Server[] }>('/api/servers');
  }

  async getServer(id: string) {
    return this.request<{ server: Server }>(`/api/servers/${id}`);
  }

  async createServer(data: CreateServerRequest) {
    return this.request<{ server: Server }>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateServer(id: string, data: UpdateServerRequest) {
    return this.request<{ server: Server }>(`/api/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteServer(id: string) {
    return this.request<{ success: boolean }>(`/api/servers/${id}`, {
      method: 'DELETE',
    });
  }

  async startServer(id: string) {
    return this.request<{ server: Server }>(`/api/servers/${id}/start`, {
      method: 'POST',
    });
  }

  async stopServer(id: string) {
    return this.request<{ server: Server }>(`/api/servers/${id}/stop`, {
      method: 'POST',
    });
  }

  async restartServer(id: string) {
    return this.request<{ server: Server }>(`/api/servers/${id}/restart`, {
      method: 'POST',
    });
  }

  async getServerLogs(id: string, type: 'stdout' | 'stderr' | 'both' = 'both', lines = 100) {
    return this.request<{ stdout: string; stderr: string }>(
      `/api/servers/${id}/logs?type=${type}&lines=${lines}`
    );
  }

  // Models
  async listModels() {
    return this.request<{ models: Model[] }>('/api/models');
  }

  async getModel(name: string) {
    return this.request<{ model: Model }>(`/api/models/${encodeURIComponent(name)}`);
  }

  async searchModels(query: string, limit = 20) {
    return this.request<{ results: HFModelResult[] }>(
      `/api/models/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  }

  async getModelFiles(repoId: string) {
    return this.request<{ repoId: string; files: string[] }>(
      `/api/models/${encodeURIComponent(repoId)}/files`
    );
  }

  async downloadModel(repo: string, filename: string) {
    return this.request<{ jobId: string; status: string }>(
      '/api/models/download',
      {
        method: 'POST',
        body: JSON.stringify({ repo, filename }),
      }
    );
  }

  async deleteModel(name: string, cascade = false) {
    return this.request<{ success: boolean; deletedServers?: string[] }>(
      `/api/models/${encodeURIComponent(name)}?cascade=${cascade}`,
      {
        method: 'DELETE',
      }
    );
  }

  // Download Jobs
  async listDownloadJobs() {
    return this.request<{ jobs: DownloadJob[] }>('/api/jobs');
  }

  async getDownloadJob(jobId: string) {
    return this.request<{ job: DownloadJob }>(`/api/jobs/${jobId}`);
  }

  async cancelDownloadJob(jobId: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/jobs/${jobId}`,
      { method: 'DELETE' }
    );
  }
}

export const api = new ApiClient();
