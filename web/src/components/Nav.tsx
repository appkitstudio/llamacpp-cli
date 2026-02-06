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
    <nav className="border-b border-neutral-200 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Nav Links */}
          <div className="flex items-center space-x-10">
            <Link to="/" className="flex items-center">
              <span className="text-xl font-bold text-neutral-900 tracking-tight">LLAMA CPP</span>
            </Link>

            <div className="flex items-center space-x-1">
              <Link
                to="/servers"
                className={`px-3 py-2 text-sm font-medium transition-colors rounded-md ${
                  location.pathname === '/servers' || location.pathname === '/'
                    ? 'text-neutral-900 bg-neutral-100'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
              >
                Servers
              </Link>
              <Link
                to="/models"
                className={`px-3 py-2 text-sm font-medium transition-colors rounded-md ${
                  location.pathname === '/models'
                    ? 'text-neutral-900 bg-neutral-100'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
              >
                Models
              </Link>
              <Link
                to="/router"
                className={`px-3 py-2 text-sm font-medium transition-colors rounded-md ${
                  location.pathname === '/router'
                    ? 'text-neutral-900 bg-neutral-100'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
              >
                Router
              </Link>
            </div>
          </div>

          {/* Search + Logout */}
          <div className="flex items-center space-x-3">
            {onSearchChange && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                <input
                  type="search"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-72 pl-9 pr-4 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 border border-neutral-200 rounded-md bg-white hover:border-neutral-300 focus:outline-none focus:border-neutral-400 transition-colors"
                />
              </div>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors cursor-pointer"
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
