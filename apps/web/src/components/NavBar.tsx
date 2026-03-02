'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useDashboardStore } from '@/store/dashboard';
import clsx from 'clsx';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/analytics', label: 'Analytics', icon: '📈' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function NavBar() {
  const pathname = usePathname();
  const { autoRefresh, toggleAutoRefresh, unacknowledgedAlertCount, toggleDebugPanel, showDebugPanel } =
    useDashboardStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="bg-gray-800 border-b border-gray-700 px-4 md:px-6 py-2 flex-shrink-0 z-50 relative">
      <div className="flex justify-between items-center">
        {/* Left: brand + links */}
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/" className="text-lg font-bold text-highlight flex items-center gap-1.5">
            🌍 <span className="hidden sm:inline">World Dash</span>
          </Link>

          {/* Desktop nav items */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'text-sm px-3 py-1.5 rounded-md transition-colors relative',
                    isActive
                      ? 'text-white bg-accent font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  )}
                >
                  <span className="mr-1">{item.icon}</span>
                  {item.label}
                  {item.href === '/alerts' && unacknowledgedAlertCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {unacknowledgedAlertCount > 9 ? '9+' : unacknowledgedAlertCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right: status controls */}
        <div className="flex items-center gap-2 md:gap-3 text-xs">
          {/* Auto-refresh toggle */}
          <button
            onClick={toggleAutoRefresh}
            className={clsx(
              'flex items-center gap-1.5 px-2 py-1 rounded transition-colors',
              autoRefresh
                ? 'text-green-400 hover:bg-green-900/30'
                : 'text-gray-500 hover:bg-gray-700/50'
            )}
            title={autoRefresh ? 'Auto-refresh ON (click to pause)' : 'Auto-refresh OFF (click to resume)'}
          >
            <span className={autoRefresh ? 'animate-pulse' : ''}>●</span>
            <span className="hidden sm:inline">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>

          {/* Debug panel toggle (desktop only) */}
          <button
            onClick={toggleDebugPanel}
            className={clsx(
              'hidden lg:flex items-center gap-1 px-2 py-1 rounded transition-colors',
              showDebugPanel
                ? 'text-purple-400 bg-purple-900/30'
                : 'text-gray-500 hover:bg-gray-700/50'
            )}
            title="Toggle debug panel"
          >
            🐛
          </button>

          <span className="hidden md:inline text-gray-600">|</span>
          <span className="hidden md:inline text-gray-500">Geopolitical Intelligence</span>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden px-2 py-1 text-gray-400 hover:text-white"
          >
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-2 pb-2 border-t border-gray-700 pt-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'text-white bg-accent font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                )}
              >
                <span>{item.icon}</span>
                {item.label}
                {item.href === '/alerts' && unacknowledgedAlertCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 ml-auto">
                    {unacknowledgedAlertCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
