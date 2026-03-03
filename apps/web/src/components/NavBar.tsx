'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useDashboardStore } from '@/store/dashboard';
import { useChatStore } from '@/store/chat';
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
  const {
    autoRefresh,
    toggleAutoRefresh,
    unacknowledgedAlertCount,
    leftPanelOpen,
    toggleLeftPanel,
    rightPanelOpen,
    openRightPanel,
    closeRightPanel,
    events,
  } = useDashboardStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isDashboard = pathname === '/';

  return (
    <nav className="bg-gray-900/95 backdrop-blur-sm border-b border-gray-800/60 px-3 md:px-5 py-1.5 flex-shrink-0 z-50 relative">
      <div className="flex justify-between items-center">
        {/* Left: brand + links */}
        <div className="flex items-center gap-3 md:gap-5">
          <Link href="/" className="text-base font-bold text-highlight flex items-center gap-1.5">
            🌍 <span className="hidden sm:inline">World Dash</span>
          </Link>

          {/* Desktop nav items */}
          <div className="hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'text-xs px-2.5 py-1 rounded-md transition-colors relative',
                    isActive
                      ? 'text-white bg-accent/80 font-medium'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  )}
                >
                  <span className="mr-1">{item.icon}</span>
                  {item.label}
                  {item.href === '/alerts' && unacknowledgedAlertCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                      {unacknowledgedAlertCount > 9 ? '9+' : unacknowledgedAlertCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-1.5 md:gap-2 text-xs">
          {/* Event count */}
          {isDashboard && events.length > 0 && (
            <span className="hidden lg:flex text-[10px] text-gray-500 items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500/60" />
              {events.length} events
            </span>
          )}

          {/* Auto-refresh toggle */}
          <button
            onClick={toggleAutoRefresh}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded transition-colors',
              autoRefresh
                ? 'text-green-400 hover:bg-green-900/20'
                : 'text-gray-500 hover:bg-gray-800/50'
            )}
            title={autoRefresh ? 'Live — click to pause' : 'Paused — click to resume'}
          >
            <span className={clsx('text-[10px]', autoRefresh && 'animate-pulse')}>●</span>
            <span className="hidden sm:inline text-[10px]">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>

          {/* Panel toggles (dashboard only) */}
          {isDashboard && (
            <>
              <div className="w-px h-4 bg-gray-700/40 hidden md:block" />

              {/* Left panel (Insights) toggle */}
              <button
                onClick={toggleLeftPanel}
                className={clsx(
                  'hidden md:flex items-center gap-1 px-1.5 py-1 rounded transition-colors text-[10px]',
                  leftPanelOpen
                    ? 'text-purple-400 bg-purple-900/20'
                    : 'text-gray-500 hover:bg-gray-800/50'
                )}
                title={leftPanelOpen ? 'Hide insight panel' : 'Show insight panel'}
              >
                ◧
              </button>

              {/* Right panel (Chat/Detail) toggle */}
              <button
                onClick={() => rightPanelOpen ? closeRightPanel() : openRightPanel('chat')}
                className={clsx(
                  'flex items-center gap-1 px-1.5 py-1 rounded transition-colors text-[10px]',
                  rightPanelOpen
                    ? 'text-blue-400 bg-blue-900/20'
                    : 'text-gray-500 hover:bg-gray-800/50'
                )}
                title={rightPanelOpen ? 'Hide panel' : 'Open chat'}
              >
                💬
              </button>
            </>
          )}

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
        <div className="md:hidden mt-2 pb-2 border-t border-gray-800 pt-2 space-y-1">
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
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
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
