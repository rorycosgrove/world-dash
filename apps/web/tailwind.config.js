/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1a1a2e',
        secondary: '#16213e',
        accent: '#0f3460',
        highlight: '#e94560',
        surface: '#1e2a42',
        // Swimlane palette
        swim: {
          red: '#ef4444',
          orange: '#f97316',
          amber: '#f59e0b',
          green: '#22c55e',
          teal: '#14b8a6',
          cyan: '#06b6d4',
          blue: '#3b82f6',
          indigo: '#6366f1',
          purple: '#8b5cf6',
          pink: '#ec4899',
        },
      },
      transitionTimingFunction: {
        'panel': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.25s ease-out forwards',
        'slide-in-left': 'slide-in-left 0.2s ease-out forwards',
        'slide-up': 'slide-up 0.3s ease-out forwards',
      },
    },
  },
  plugins: [],
}
