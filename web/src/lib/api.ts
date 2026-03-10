import type {
  Server,
  Model,
  SystemStatus,
  CreateServerRequest,
  UpdateServerRequest,
  ApiError,
  HFModelResult,
  DownloadJob,
  RouterInfo,
  UpdateRouterRequest,
  AdminInfo,
  AdminLogsResponse,
  RotateLogsRequest,
  ClearArchivedLogsRequest,
  UpdateLogConfigRequest,
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

  async getServerLogs(id: string, type: 'activity' | 'system' | 'all' = 'all', lines = 100) {
    return this.request<{ http: string; stdout: string; stderr: string }>(
      `/api/servers/${id}/logs?type=${type}&lines=${lines}`
    );
  }

  async getServerSlots(id: string) {
    return this.request<{ slots: any[]; activeSlots: number; idleSlots: number; totalSlots: number }>(
      `/api/servers/${id}/slots`
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

  // Router
  async getRouter() {
    return this.request<RouterInfo>('/api/router');
  }

  async startRouter() {
    return this.request<{ success: boolean; status: string; pid: number | null }>(
      '/api/router/start',
      { method: 'POST' }
    );
  }

  async stopRouter() {
    return this.request<{ success: boolean; status: string }>(
      '/api/router/stop',
      { method: 'POST' }
    );
  }

  async restartRouter() {
    return this.request<{ success: boolean; status: string; pid: number | null }>(
      '/api/router/restart',
      { method: 'POST' }
    );
  }

  async getRouterLogs(type: 'activity' | 'system' | 'both' = 'both', lines = 100) {
    return this.request<{ stdout: string; stderr: string }>(
      `/api/router/logs?type=${type}&lines=${lines}`
    );
  }

  async updateRouter(data: UpdateRouterRequest) {
    return this.request<{ success: boolean; needsRestart: boolean; config: any }>(
      '/api/router',
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );
  }

  // Admin
  async getAdmin() {
    return this.request<AdminInfo>('/api/admin');
  }

  // Admin Log Management
  async getAdminLogs() {
    return this.request<AdminLogsResponse>('/api/admin/logs');
  }

  async getAdminServiceLogs(type: 'activity' | 'system' | 'both' = 'both', lines = 100) {
    return this.request<{ stdout: string; stderr: string }>(
      `/api/admin/service-logs?type=${type}&lines=${lines}`
    );
  }

  async rotateLogs(data: RotateLogsRequest) {
    return this.request<{ success: boolean; message: string; archivedFiles: string[] }>(
      '/api/admin/logs/rotate',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  async clearArchivedLogs(data: ClearArchivedLogsRequest) {
    return this.request<{ success: boolean; count: number; totalSize: number }>(
      '/api/admin/logs/clear-archived',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  async updateLogConfig(data: UpdateLogConfigRequest) {
    return this.request<{ success: boolean; config: any }>(
      '/api/admin/logs/config',
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );
  }

  // Chat - Streaming via Router
  async *streamChatMessage(
    modelName: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: { max_tokens?: number; temperature?: number }
  ): AsyncGenerator<any> {
    const response = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        max_tokens: options?.max_tokens || 4096,
        temperature: options?.temperature || 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.details || 'Chat request failed');
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const api = new ApiClient();
