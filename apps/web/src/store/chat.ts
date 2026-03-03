import { create } from 'zustand';
import { ChatMessage, ChatSession, Event, ChartSpec } from '@/lib/api';

interface ChatState {
  // Panel visibility
  isOpen: boolean;

  // Session
  sessionId: string | null;
  messages: ChatMessage[];
  sessions: ChatSession[];

  // Context
  contextEventId: string | null;
  contextClusterId: string | null;
  contextEvents: Event[];

  // Chart specs per message (keyed by message ID)
  messageChartSpecs: Record<string, ChartSpec>;

  // Loading
  isLoading: boolean;
  error: string | null;

  // Actions
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  setSessionId: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setSessions: (sessions: ChatSession[]) => void;
  setContextEventId: (id: string | null) => void;
  setContextClusterId: (id: string | null) => void;
  setContextEvents: (events: Event[]) => void;
  setMessageChartSpec: (messageId: string, spec: ChartSpec) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearChat: () => void;
  startNewSession: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  sessionId: null,
  messages: [],
  sessions: [],
  contextEventId: null,
  contextClusterId: null,
  contextEvents: [],
  messageChartSpecs: {},
  isLoading: false,
  error: null,

  toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),
  openChat: () => set({ isOpen: true }),
  closeChat: () => set({ isOpen: false }),
  setSessionId: (id) => set({ sessionId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setSessions: (sessions) => set({ sessions }),
  setContextEventId: (id) => set({ contextEventId: id }),
  setContextClusterId: (id) => set({ contextClusterId: id }),
  setContextEvents: (events) => set({ contextEvents: events }),
  setMessageChartSpec: (messageId, spec) =>
    set((s) => ({ messageChartSpecs: { ...s.messageChartSpecs, [messageId]: spec } })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearChat: () => set({ messages: [], sessionId: null, contextEventId: null, contextClusterId: null, contextEvents: [], messageChartSpecs: {}, error: null }),
  startNewSession: () => set({ messages: [], sessionId: null, messageChartSpecs: {}, error: null }),
}));
