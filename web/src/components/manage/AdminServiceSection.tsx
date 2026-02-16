import { Settings, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import type { AdminInfo } from '../../types/api';

interface AdminServiceSectionProps {
  adminData: AdminInfo | undefined;
  isOpen: boolean;
  onToggle: () => void;
}

export function AdminServiceSection({ adminData, isOpen, onToggle }: AdminServiceSectionProps) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg mb-6 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
            <Settings className="w-5 h-5 text-purple-600" />
          </div>
          <div className="text-left">
            <h3 className="text-base font-semibold text-neutral-900">Admin Service</h3>
            <p className="text-sm text-neutral-500">
              Management API and web interface on port 9200
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200/50">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            Running
          </span>
          {isOpen ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-neutral-200 px-5 py-4">
          <div className="space-y-4">
            {/* Quick Access Links */}
            <div className="flex items-center gap-2 pb-4 border-b border-neutral-200">
              <a
                href="/admin/logs"
                className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
              >
                View Logs
              </a>
              <a
                href="/api-docs/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors flex items-center gap-1.5"
              >
                API Docs
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Service Information */}
            {adminData?.config && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-neutral-900 mb-2">Service Information</h4>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Host:</span>
                  <span>{adminData.config.host}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Port:</span>
                  <span>{adminData.config.port}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Logging:</span>
                  <span>{adminData.config.logging ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="text-neutral-400 w-32">Request Timeout:</span>
                  <span>{(adminData.config.requestTimeout / 1000).toFixed(0)}s</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
