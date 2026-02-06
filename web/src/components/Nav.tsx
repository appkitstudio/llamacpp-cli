import { Link, useLocation } from 'react-router-dom';
import { Search, LogOut } from 'lucide-react';
import { api } from '../lib/api';

interface NavProps {
  onLogout?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export function Nav({ onLogout, searchQuery = '', onSearchChange }: NavProps) {
  const location = useLocation();

  const handleLogout = () => {
    api.clearApiKey();
    onLogout?.();
  };

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo and Nav Links */}
          <div className="flex items-center space-x-8">
            <Link to="/" className="flex items-center space-x-2">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
              </svg>
              <span className="text-lg font-medium text-gray-900">llama.cpp</span>
            </Link>

            <div className="flex items-center space-x-6">
              <Link
                to="/servers"
                className={`text-sm font-medium transition-colors ${
                  location.pathname === '/servers'
                    ? 'text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Servers
              </Link>
              <Link
                to="/models"
                className={`text-sm font-medium transition-colors ${
                  location.pathname === '/models'
                    ? 'text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Models
              </Link>
            </div>
          </div>

          {/* Search + Logout */}
          <div className="flex items-center space-x-4">
            {onSearchChange && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-64 pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-transparent"
                />
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
