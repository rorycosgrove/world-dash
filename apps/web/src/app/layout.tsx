import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'World Dash - Geopolitical Intelligence',
  description: 'Real-time world events monitoring dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-gray-800 border-b border-gray-700 px-6 py-2 flex-shrink-0">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-6">
              <span className="text-lg font-bold text-highlight">🌍 World Dash</span>
              <a href="/" className="text-sm text-gray-300 hover:text-white transition-colors">
                Dashboard
              </a>
              <a href="/settings" className="text-sm text-gray-300 hover:text-white transition-colors">
                Settings
              </a>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="text-green-400">● Live</span>
              <span>Geopolitical Intelligence</span>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
