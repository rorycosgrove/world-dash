'use client';

import { useEffect } from 'react';
import { useDashboardStore } from '@/store/dashboard';

/**
 * Global keyboard shortcuts for the command-center dashboard.
 *
 * Shortcuts:
 *   Escape      — close right panel
 *   1           — Network view
 *   2           — Map view
 *   3           — Compare view
 *   [           — toggle left (insight) panel
 *   ]           — toggle right panel
 *   /           — focus search (CommandBar)
 *   ?           — toggle timeline collapsed
 */
export function useKeyboardShortcuts() {
  const {
    closeRightPanel,
    rightPanelOpen,
    setViewMode,
    toggleLeftPanel,
    openRightPanel,
    toggleTimelineCollapsed,
  } = useDashboardStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        // Allow Escape even in inputs
        if (e.key !== 'Escape') return;
      }

      // Don't intercept with modifiers (except shift for ?)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'Escape':
          if (rightPanelOpen) {
            e.preventDefault();
            closeRightPanel();
          }
          break;
        case '1':
          e.preventDefault();
          setViewMode('network');
          break;
        case '2':
          e.preventDefault();
          setViewMode('map');
          break;
        case '3':
          e.preventDefault();
          setViewMode('compare');
          break;
        case '[':
          e.preventDefault();
          toggleLeftPanel();
          break;
        case ']':
          e.preventDefault();
          if (rightPanelOpen) closeRightPanel();
          else openRightPanel('chat');
          break;
        case '/':
          e.preventDefault();
          // Focus the search input in CommandBar
          const searchInput = document.querySelector<HTMLInputElement>('[data-command-search]');
          searchInput?.focus();
          break;
        case '?':
          if (e.shiftKey) {
            e.preventDefault();
            toggleTimelineCollapsed();
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rightPanelOpen, closeRightPanel, setViewMode, toggleLeftPanel, openRightPanel, toggleTimelineCollapsed]);
}
