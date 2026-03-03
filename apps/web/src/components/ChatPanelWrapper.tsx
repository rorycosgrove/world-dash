'use client';

import { usePathname } from 'next/navigation';
import ChatPanel from '@/components/ChatPanel';

export default function ChatPanelWrapper() {
  const pathname = usePathname();
  // Dashboard page handles chat inline in its right panel
  if (pathname === '/') return null;
  return <ChatPanel />;
}
