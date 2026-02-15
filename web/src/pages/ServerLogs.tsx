import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, ChevronDown, Trash2, Check } from 'lucide-react';
import { useServerLogs, useServer } from '../hooks/useApi';
import { renderAnsiLine, stripAnsiCodes } from '../utils/ansi-parser';

type LogSort = 'newest' | 'oldest';
type ViewMode = 'activity' | 'verbose';

interface ParsedLogLine {
  raw: string;
  formatted?: string;
  timestamp?: string;
  type: 'request' | 'error' | 'warning' | 'system';
  isHealthCheck?: boolean;
}

// Health check endpoints to filter by default
const HEALTH_CHECK_ENDPOINTS = ['/health', '/slots', '/props'];

// Cache for timestamps - maps raw log content to its assigned timestamp
const timestampCache = new Map<string, string>();

// Generate a current timestamp
function getCurrentTimestamp(): string {
  const now = new Date();
  return now.toISOString().substring(0, 19).replace('T', ' ');
}

// Log parser utilities - returns cached timestamp or generates new one
function extractTimestamp(line: string, rawKey: string): string {
  // Try bracket format: [2025-12-09 10:13:45]
  const bracketMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
  if (bracketMatch) return bracketMatch[1];

  // Try plain format at start of line: 2025-12-09 10:13:45
  const plainMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (plainMatch) return plainMatch[1];

  // Check cache for previously generated timestamp
  const cached = timestampCache.get(rawKey);
  if (cached) return cached;

  // Generate and cache new timestamp
  const newTimestamp = getCurrentTimestamp();
  timestampCache.set(rawKey, newTimestamp);
  return newTimestamp;
}

function extractJson(line: string): any {
  const jsonStart = line.indexOf('{');
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(line.substring(jsonStart));
  } catch {
    return null;
  }
}

function extractUserMessage(requestJson: any): string {
  const messages = requestJson.messages || [];
  const userMsg = messages.find((m: any) => m.role === 'user');
  if (!userMsg || !userMsg.content) return '';

  let content: string;
  if (Array.isArray(userMsg.content)) {
    const textPart = userMsg.content.find((p: any) => p.type === 'text');
    content = textPart?.text || '';
  } else {
    content = userMsg.content;
  }

  content = content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  return content.length > 50 ? content.substring(0, 47) + '...' : content;
}

function extractResponseTime(responseJson: any): number {
  const verboseTimings = responseJson.__verbose?.timings;
  if (verboseTimings) {
    return Math.round((verboseTimings.prompt_ms || 0) + (verboseTimings.predicted_ms || 0));
  }
  const timings = responseJson.timings;
  if (timings) {
    return Math.round((timings.prompt_ms || 0) + (timings.predicted_ms || 0));
  }
  return 0;
}

function parseHttpLog(line: string): ParsedLogLine | null {
  // Parse HTTP log format: "2026-02-15 16:41:05 GET /slots 127.0.0.1 200 "" 0 0 -"
  const httpMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+(\S+)\s+(\d+)/);
  if (!httpMatch) return null;

  const [, timestamp, , endpoint] = httpMatch;

  // Check if this is a health check request
  const isHealthCheck = HEALTH_CHECK_ENDPOINTS.some(ep => endpoint === ep);

  return {
    raw: line,
    formatted: line, // HTTP logs are already formatted nicely
    timestamp,
    type: 'request',
    isHealthCheck,
  };
}

function parseLogsToFormatted(lines: string[]): ParsedLogLine[] {
  const results: ParsedLogLine[] = [];
  let buffer: string[] = [];
  let isBuffering = false;

  const isRequestStatusLine = (line: string): boolean => {
    return (
      (line.includes('log_server_r: request:') || line.includes('log_server_r: done request:')) &&
      !line.includes('{') &&
      /(?:done )?request: (POST|GET|PUT|DELETE)/.test(line)
    );
  };

  const consolidateRequest = (bufferedLines: string[]): ParsedLogLine | null => {
    try {
      const firstLine = bufferedLines[0];
      const rawKey = bufferedLines.join('\n'); // Use full request as cache key
      const timestamp = extractTimestamp(firstLine, rawKey);
      const requestMatch = firstLine.match(/(?:done )?request: (POST|GET|PUT|DELETE) (\/[^\s]+) ([^\s]+) (\d+)/);
      if (!requestMatch) return null;

      const [, method, endpoint, ip, status] = requestMatch;

      // Parse request JSON
      const requestLine = bufferedLines.find(l => l.includes('log_server_r: request:') && l.includes('{'));
      let userMessage = '';
      if (requestLine) {
        const requestJson = extractJson(requestLine);
        if (requestJson) {
          userMessage = extractUserMessage(requestJson);
        }
      }

      // Parse response JSON
      const responseLine = bufferedLines.find(l => l.includes('log_server_r: response:'));
      let tokensIn = 0;
      let tokensOut = 0;
      let responseTimeMs = 0;

      if (responseLine) {
        const responseJson = extractJson(responseLine);
        if (responseJson) {
          tokensIn = responseJson.usage?.prompt_tokens || 0;
          tokensOut = responseJson.usage?.completion_tokens || 0;
          responseTimeMs = extractResponseTime(responseJson);
        }
      }

      const formatted = `${timestamp} ${method} ${endpoint} ${ip} ${status} "${userMessage}" ${tokensIn} ${tokensOut} ${responseTimeMs}`;

      // Check if this is a health check request
      const isHealthCheck = HEALTH_CHECK_ENDPOINTS.some(ep => endpoint === ep);

      return {
        raw: bufferedLines.join('\n'),
        formatted,
        timestamp,
        type: 'request',
        isHealthCheck,
      };
    } catch {
      return null;
    }
  };

  const parseSimpleFormat = (line: string): ParsedLogLine | null => {
    try {
      const timestamp = extractTimestamp(line, line); // Use line as cache key
      const requestMatch = line.match(/(?:done )?request: (POST|GET|PUT|DELETE) ([^\s]+) ([^\s]+) (\d+)/);
      if (!requestMatch) return null;

      const [, method, endpoint, ip, status] = requestMatch;
      const formatted = `${timestamp} ${method} ${endpoint} ${ip} ${status} "" 0 0 0`;

      // Check if this is a health check request
      const isHealthCheck = HEALTH_CHECK_ENDPOINTS.some(ep => endpoint === ep);

      return {
        raw: line,
        formatted,
        timestamp,
        type: 'request',
        isHealthCheck,
      };
    } catch {
      return null;
    }
  };

  const parseNonRequestLine = (line: string): ParsedLogLine => {
    const trimmed = line.trim();

    // Error patterns
    if (trimmed.toLowerCase().includes('error') ||
        trimmed.toLowerCase().includes('failed') ||
        trimmed.toLowerCase().includes('exception') ||
        trimmed.includes('ERR') ||
        trimmed.includes('FATAL')) {
      return { raw: line, type: 'error' };
    }

    // Warning patterns
    if (trimmed.toLowerCase().includes('warn') ||
        trimmed.toLowerCase().includes('warning') ||
        trimmed.includes('WARN')) {
      return { raw: line, type: 'warning' };
    }

    return { raw: line, type: 'system' };
  };

  for (const line of lines) {
    // Try parsing as HTTP log first
    const httpLog = parseHttpLog(line);
    if (httpLog) {
      results.push(httpLog);
      continue;
    }

    // Otherwise, parse as verbose log
    if (isRequestStatusLine(line)) {
      if (isBuffering) {
        // Process previous buffer
        const result = consolidateRequest(buffer);
        if (result) results.push(result);
        buffer = [];
        isBuffering = false;
      }
      isBuffering = true;
      buffer = [line];
    } else if (isBuffering) {
      buffer.push(line);
      if (line.includes('log_server_r: response:')) {
        const result = consolidateRequest(buffer);
        if (result) results.push(result);
        buffer = [];
        isBuffering = false;
      }
    } else {
      // Non-buffered line (not part of a request)
      const trimmed = line.trim();
      if (trimmed && !trimmed.includes('log_server_r')) {
        results.push(parseNonRequestLine(line));
      }
    }
  }

  // Flush remaining buffer (simple format without response)
  if (isBuffering && buffer.length === 1) {
    const result = parseSimpleFormat(buffer[0]);
    if (result) results.push(result);
  }

  return results;
}

export function ServerLogs() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sortOrder, setSortOrder] = useState<LogSort>('newest');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('serverLogs.viewMode');
    return (saved === 'activity' || saved === 'verbose') ? saved : 'activity';
  });
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showHealthChecks, setShowHealthChecks] = useState(false);

  // Persist viewMode to localStorage
  useEffect(() => {
    localStorage.setItem('serverLogs.viewMode', viewMode);
  }, [viewMode]);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: serverData, isLoading: serverLoading } = useServer(id || '');
  // Fetch many lines since verbose logs have lots of non-request output
  // CLI uses lines * 100 multiplier, we use 50000 to get more parsed request lines
  const { data: logsData, isLoading: logsLoading } = useServerLogs(id || null, 50000);

  const server = serverData?.server;

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logsData, autoScroll, sortOrder]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getFilteredLogs = (): { logs: ParsedLogLine[]; hasRawLogs: boolean; formattedCount: number } => {
    if (!logsData) return { logs: [], hasRawLogs: false, formattedCount: 0 };

    // Parse HTTP logs first (these have timestamps)
    const httpLines = (logsData.http || '').split('\n').filter(line => {
      const stripped = stripAnsiCodes(line).trim();
      return stripped.length > 0;
    });

    // Parse verbose logs (these don't have timestamps)
    const verboseLines = [
      ...(logsData.stderr || '').split('\n'),
      ...(logsData.stdout || '').split('\n'),
    ].filter(line => {
      const stripped = stripAnsiCodes(line).trim();
      return stripped.length > 0;
    });

    // Combine all lines (HTTP first for better timestamp availability)
    const allLines = [...httpLines, ...verboseLines];

    // Parse logs
    const parsed = parseLogsToFormatted(allLines);

    // Track counts for empty state messaging
    const hasRawLogs = allLines.length > 0;
    const formattedCount = parsed.filter(log => log.formatted && !log.isHealthCheck).length;

    // Filter by view mode
    let filtered = parsed;
    if (viewMode === 'activity') {
      // Show only HTTP logs (simple format with timestamps)
      filtered = parsed.filter(log => log.timestamp && log.formatted);
    } else {
      // Show only verbose logs (stderr/stdout without formatted output from HTTP)
      filtered = parsed.filter(log => !log.timestamp || !log.formatted || log.type !== 'request');
    }

    // Filter out health check requests unless toggle is enabled
    if (!showHealthChecks) {
      filtered = filtered.filter(log => !log.isHealthCheck);
    }

    // Apply sort
    if (sortOrder === 'oldest') {
      return { logs: filtered, hasRawLogs, formattedCount };
    }

    return { logs: [...filtered].reverse(), hasRawLogs, formattedCount };
  };

  const { logs: filteredLogs, hasRawLogs, formattedCount } = getFilteredLogs();

  const getLogTypeColor = (type: string): string => {
    switch (type) {
      case 'request':
        return 'text-blue-400';
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  if (serverLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <p className="text-gray-500 text-center">Loading...</p>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <p className="text-gray-500 text-center">Server not found</p>
        <div className="text-center mt-4">
          <Link
            to="/servers"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Back to Servers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/servers')}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Server Logs</h1>
            <p className="text-sm text-gray-500">{server.modelName.replace('.gguf', '')} · Port {server.port}</p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('activity')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                viewMode === 'activity'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Activity
            </button>
            <button
              onClick={() => setViewMode('verbose')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                viewMode === 'verbose'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Verbose
            </button>
          </div>
        </div>

        {/* Health Checks Toggle + Sort */}
        <div className="flex items-center gap-2">
          {/* Health Checks Toggle */}
          <button
            onClick={() => setShowHealthChecks(!showHealthChecks)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
              showHealthChecks
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
            title="Show /health, /slots, /props requests (filtered by default)"
          >
            {showHealthChecks && <Check className="w-4 h-4" />}
            Health Checks
          </button>

          {/* Sort Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors cursor-pointer"
            >
              {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
              <ChevronDown className="w-4 h-4" />
            </button>

            {showSortDropdown && (
              <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => { setSortOrder('newest'); setShowSortDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer ${
                    sortOrder === 'newest' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Newest
                </button>
                <button
                  onClick={() => { setSortOrder('oldest'); setShowSortDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer ${
                    sortOrder === 'oldest' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Oldest
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={logContainerRef}
        className="flex-1 overflow-y-auto bg-gray-900 p-4 font-mono text-sm"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
          setAutoScroll(isAtBottom);
        }}
      >
        {logsLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Trash2 className="w-8 h-8 mb-2 opacity-50" />
            <p>No {viewMode === 'activity' ? 'activity ' : viewMode === 'verbose' ? 'verbose ' : ''}logs found</p>
            {viewMode === 'activity' && hasRawLogs && formattedCount === 0 ? (
              <p className="text-sm mt-1">
                No HTTP requests yet.{' '}
                <button
                  onClick={() => setViewMode('verbose')}
                  className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                >
                  View verbose logs
                </button>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredLogs.map((log, index) => {
              const content = log.formatted || log.raw;
              return (
                <div
                  key={index}
                  className={`${getLogTypeColor(log.type)} break-all whitespace-pre-wrap leading-relaxed`}
                >
                  {renderAnsiLine(content, index)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with stats */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 bg-gray-50 text-sm text-gray-500">
        <span>
          {filteredLogs.length} {filteredLogs.length === 1 ? 'line' : 'lines'}
        </span>
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${autoScroll ? 'bg-green-500' : 'bg-gray-300'}`} />
          {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
        </span>
      </div>
    </div>
  );
}
