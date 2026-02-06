import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ChevronDown } from 'lucide-react';
import { useRouterLogs } from '../hooks/useApi';

type LogType = 'stdout' | 'stderr' | 'both';
type LogSort = 'newest' | 'oldest';

export function RouterLogs() {
  const navigate = useNavigate();

  const [logType, setLogType] = useState<LogType>('stdout');
  const [sortOrder, setSortOrder] = useState<LogSort>('newest');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: logsData, isLoading: logsLoading } = useRouterLogs(50000);

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

  const getFilteredLogs = (): string[] => {
    if (!logsData) return [];

    let logs: string;
    if (logType === 'stdout') {
      logs = logsData.stdout || '';
    } else if (logType === 'stderr') {
      logs = logsData.stderr || '';
    } else {
      // Combine both
      const stdout = logsData.stdout || '';
      const stderr = logsData.stderr || '';
      logs = [stderr, stdout].filter(l => l.trim()).join('\n');
    }

    const lines = logs.split('\n').filter(line => line.trim());

    // Apply sort
    if (sortOrder === 'oldest') {
      return lines;
    }

    return [...lines].reverse();
  };

  const filteredLogs = getFilteredLogs();

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/router')}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Router Logs</h1>
            <p className="text-sm text-gray-500">Unified model routing service</p>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        {/* Log Type Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setLogType('stdout')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                logType === 'stdout'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Activity
            </button>
            <button
              onClick={() => setLogType('stderr')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                logType === 'stderr'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              System
            </button>
            <button
              onClick={() => setLogType('both')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                logType === 'both'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Both
            </button>
          </div>
        </div>

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
            <p>No logs found</p>
            <p className="text-sm mt-1">Router may not be running or has no activity yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredLogs.map((line, index) => (
              <div
                key={index}
                className="text-gray-300 break-all whitespace-pre-wrap leading-relaxed"
              >
                {line}
              </div>
            ))}
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
