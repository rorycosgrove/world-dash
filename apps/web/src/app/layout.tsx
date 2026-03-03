import type { Metadata } from 'next';
import '@/styles/globals.css';
import NavBar from '@/components/NavBar';
import ChatPanelWrapper from '@/components/ChatPanelWrapper';
import { Toaster } from 'react-hot-toast';
import ErrorBoundaryWrapper from '@/components/ErrorBoundary';

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
        <NavBar />
        <ErrorBoundaryWrapper>
          {children}
        </ErrorBoundaryWrapper>
        <ChatPanelWrapper />
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #334155',
              fontSize: '13px',
            },
            success: {
              iconTheme: { primary: '#10b981', secondary: '#1e293b' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#1e293b' },
            },
          }}
        />
      </body>
    </html>
  );
}
