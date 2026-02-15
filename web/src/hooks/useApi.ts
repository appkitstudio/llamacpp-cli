import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CreateServerRequest, UpdateServerRequest, UpdateRouterRequest } from '../types/api';

// System
export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: () => api.getSystemStatus(),
    refetchInterval: 5000, // Auto-refresh every 5s
  });
}

// Servers
export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => api.listServers(),
    refetchInterval: 5000, // Auto-refresh every 5s
  });
}

export function useServer(id: string) {
  return useQuery({
    queryKey: ['servers', id],
    queryFn: () => api.getServer(id),
    enabled: !!id,
  });
}

export function useCreateServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateServerRequest) => api.createServer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
  });
}

export function useUpdateServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateServerRequest }) =>
      api.updateServer(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', variables.id] });
    },
  });
}

export function useDeleteServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
  });
}

export function useStartServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.startServer(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', id] });
    },
  });
}

export function useStopServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.stopServer(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', id] });
    },
  });
}

export function useRestartServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.restartServer(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', id] });
    },
  });
}

export function useServerLogs(serverId: string | null, lines = 500) {
  return useQuery({
    queryKey: ['serverLogs', serverId, lines],
    queryFn: () => api.getServerLogs(serverId!, 'all', lines),
    enabled: !!serverId,
    refetchInterval: 2000, // Auto-refresh every 2s
  });
}

// Models
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: () => api.listModels(),
    refetchInterval: 10000, // Auto-refresh every 10s
  });
}

export function useModel(name: string) {
  return useQuery({
    queryKey: ['models', name],
    queryFn: () => api.getModel(name),
    enabled: !!name,
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, cascade }: { name: string; cascade: boolean }) =>
      api.deleteModel(name, cascade),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
  });
}

export function useDownloadModel() {
  return useMutation({
    mutationFn: ({ repo, filename }: { repo: string; filename: string }) =>
      api.downloadModel(repo, filename),
    // Don't invalidate immediately - download is background job
  });
}

// Search
export function useSearchModels() {
  return useMutation({
    mutationFn: ({ query, limit = 20 }: { query: string; limit?: number }) =>
      api.searchModels(query, limit),
  });
}

export function useModelFiles(repoId: string | null) {
  return useQuery({
    queryKey: ['modelFiles', repoId],
    queryFn: () => api.getModelFiles(repoId!),
    enabled: !!repoId,
  });
}

// Download Jobs
export function useDownloadJobs(enabled = true) {
  return useQuery({
    queryKey: ['downloadJobs'],
    queryFn: () => api.listDownloadJobs(),
    refetchInterval: enabled ? 1000 : false, // Poll every 1s when enabled
    enabled,
  });
}

export function useDownloadJob(jobId: string | null) {
  return useQuery({
    queryKey: ['downloadJobs', jobId],
    queryFn: () => api.getDownloadJob(jobId!),
    enabled: !!jobId,
    refetchInterval: 500, // Fast polling for active job
  });
}

export function useCancelDownload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => api.cancelDownloadJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['downloadJobs'] });
    },
  });
}

// Router
export function useRouter() {
  return useQuery({
    queryKey: ['router'],
    queryFn: () => api.getRouter(),
    refetchInterval: 5000, // Auto-refresh every 5s
    placeholderData: keepPreviousData, // Keep previous data during refetch to prevent flash
  });
}

export function useStartRouter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.startRouter(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['router'] });
    },
  });
}

export function useStopRouter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.stopRouter(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['router'] });
    },
  });
}

export function useRestartRouter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.restartRouter(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['router'] });
    },
  });
}

export function useRouterLogs(lines = 500) {
  return useQuery({
    queryKey: ['routerLogs', lines],
    queryFn: () => api.getRouterLogs('both', lines),
    refetchInterval: 2000, // Auto-refresh every 2s
    placeholderData: keepPreviousData, // Keep previous data during refetch to prevent flash
  });
}

export function useUpdateRouter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateRouterRequest) => api.updateRouter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['router'] });
    },
  });
}
