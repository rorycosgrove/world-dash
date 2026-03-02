'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  enabled: boolean;
  tags: string[];
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  error_count: number;
  total_events: number;
  created_at: string;
  updated_at: string;
}

interface NewSource {
  name: string;
  url: string;
  type: string;
  tags: string[];
  enabled: boolean;
}

type TabType = 'sources' | 'ollama';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('sources');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [newSource, setNewSource] = useState<NewSource>({
    name: '',
    url: '',
    type: 'rss',
    tags: [],
    enabled: true,
  });
  const [tagInput, setTagInput] = useState('');

  // Ollama settings
  const [ollamaEndpoint, setOllamaEndpoint] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama2');
  const [ollamaEnabled, setOllamaEnabled] = useState(true);
  const [testingOllama, setTestingOllama] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'connected' | 'failed'>('unknown');
  const [ollamaMessage, setOllamaMessage] = useState('');

  useEffect(() => {
    // Load Ollama config from API (server-side truth)
    const loadConfig = async () => {
      try {
        const config = await api.getLLMConfig();
        setOllamaEndpoint(config.endpoint);
        setOllamaModel(config.model);
        setOllamaEnabled(config.enabled);
      } catch {
        // Fallback to localStorage if API unavailable
        const saved = localStorage.getItem('ollama-settings');
        if (saved) {
          const { endpoint, model } = JSON.parse(saved);
          setOllamaEndpoint(endpoint || 'http://localhost:11434');
          setOllamaModel(model || 'llama2');
        }
      }
    };
    loadConfig();
  }, []);

  const fetchSources = async () => {
    try {
      const data = await api.getSources();
      setSources(data);
    } catch (error) {
      console.error('Failed to fetch sources:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const source = await api.createSource({
        ...newSource,
        tags: tagInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setSources([...sources, source]);
      setNewSource({
        name: '',
        url: '',
        type: 'rss',
        tags: [],
        enabled: true,
      });
      setTagInput('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to create source:', error);
    }
  };

  const handleToggleEnabled = async (source: Source) => {
    try {
      const updated = await api.updateSource(source.id, {
        enabled: !source.enabled,
      });
      setSources(sources.map((s) => (s.id === source.id ? updated : s)));
    } catch (error) {
      console.error('Failed to update source:', error);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm('Are you sure you want to delete this source?')) return;
    try {
      await api.deleteSource(sourceId);
      setSources(sources.filter((s) => s.id !== sourceId));
    } catch (error) {
      console.error('Failed to delete source:', error);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await api.ingestAllSources();
    } catch (error) {
      console.error('Failed to refresh sources:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const testOllamaConnection = async () => {
    setTestingOllama(true);
    setOllamaStatus('unknown');
    setOllamaMessage('Testing connection...');

    try {
      console.log(`Testing Ollama at ${ollamaEndpoint} with model ${ollamaModel}`);
      
      // First test via the API
      const health = await api.getLLMHealth();
      
      // Then test directly
      const response = await fetch(`${ollamaEndpoint}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const models = data.models || [];
      const modelExists = models.some((m: any) => m.name.includes(ollamaModel));

      if (modelExists) {
        setOllamaStatus('connected');
        setOllamaMessage(`✓ Connected! Found model: ${ollamaModel}`);
        // Save settings
        localStorage.setItem(
          'ollama-settings',
          JSON.stringify({
            endpoint: ollamaEndpoint,
            model: ollamaModel,
          })
        );
      } else {
        setOllamaStatus('failed');
        setOllamaMessage(
          `✗ Connected to Ollama but "${ollamaModel}" not found. Available: ${models.map((m: any) => m.name).join(', ')}`
        );
      }
    } catch (error: any) {
      setOllamaStatus('failed');
      setOllamaMessage(`✗ Connection failed: ${error.message}`);
      console.error('Ollama test failed:', error);
    } finally {
      setTestingOllama(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-purple-400">⚙️ Settings</h1>
            <p className="text-sm text-gray-400">Configure feeds and AI services</p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('sources')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'sources'
              ? 'border-b-2 border-purple-500 text-purple-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          📰 Feed Sources
        </button>
        <button
          onClick={() => setActiveTab('ollama')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'ollama'
              ? 'border-b-2 border-purple-500 text-purple-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🤖 Ollama / LLM
        </button>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        {/* Sources Tab */}
        {activeTab === 'sources' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-100">Feed Sources</h2>
              <div className="flex gap-2">
                <button
                  onClick={handleRefreshAll}
                  disabled={refreshing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium disabled:opacity-50"
                >
                  {refreshing ? '⏳ Refreshing...' : '🔄 Refresh All'}
                </button>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium"
                >
                  {showAddForm ? '✕ Cancel' : '➕ Add Feed'}
                </button>
              </div>
            </div>

            {showAddForm && (
              <form onSubmit={handleAddSource} className="bg-gray-800 rounded p-4 mb-6 border border-gray-700">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <input
                    type="text"
                    placeholder="Feed Name"
                    value={newSource.name}
                    onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                    required
                    className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100"
                  />
                  <input
                    type="url"
                    placeholder="Feed URL"
                    value={newSource.url}
                    onChange={(e) => setNewSource({ ...newSource, url: e.target.value })}
                    required
                    className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Tags (comma-separated)"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 mb-4"
                />
                <button
                  type="submit"
                  className="w-full bg-purple-600 hover:bg-purple-700 rounded px-3 py-2 font-medium"
                >
                  Add Feed
                </button>
              </form>
            )}

            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading feeds...</div>
            ) : sources.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-xl mb-2">No feeds configured</p>
                <p>Click "Add Feed" to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sources.map((source) => (
                  <div key={source.id} className="bg-gray-800 rounded p-4 border border-gray-700 hover:border-gray-600">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="checkbox"
                            checked={source.enabled}
                            onChange={() => handleToggleEnabled(source)}
                            className="w-4 h-4"
                          />
                          <h3 className="font-semibold text-gray-100">{source.name}</h3>
                          <span className="text-xs bg-gray-700 px-2 py-1 rounded">{source.type}</span>
                        </div>
                        <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-400 hover:underline">
                          {source.url}
                        </a>
                        <div className="text-xs text-gray-400 mt-1">
                          {source.total_events} events • Last: {source.last_polled_at ? new Date(source.last_polled_at).toLocaleString() : 'never'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteSource(source.id)}
                        className="px-2 py-1 bg-red-900 hover:bg-red-800 rounded text-xs font-medium ml-4"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ollama Tab */}
        {activeTab === 'ollama' && (
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-gray-100 mb-6">Ollama / LLM Configuration</h2>

            <div className="bg-gray-800 rounded p-6 border border-gray-700 space-y-4">
              {/* Server-side config notice */}
              <div className="bg-blue-900/30 border border-blue-700 rounded p-3 text-sm text-blue-200">
                ℹ️ Ollama endpoint and model are configured via environment variables on the server
                (<code className="bg-gray-800 px-1 rounded">OLLAMA_ENDPOINT</code>,{' '}
                <code className="bg-gray-800 px-1 rounded">OLLAMA_MODEL</code>). The values below reflect the
                current server configuration.
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Ollama Endpoint (server)</label>
                <input
                  type="url"
                  value={ollamaEndpoint}
                  disabled
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-400 text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Model Name (server)</label>
                <input
                  type="text"
                  value={ollamaModel}
                  disabled
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-400 text-sm cursor-not-allowed"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-300">LLM Processing:</span>
                <span className={`text-sm font-bold ${ollamaEnabled ? 'text-green-400' : 'text-red-400'}`}>
                  {ollamaEnabled ? '✓ Enabled' : '✗ Disabled'}
                </span>
              </div>

              <button
                onClick={testOllamaConnection}
                disabled={testingOllama}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded px-4 py-2 font-medium text-white transition-colors"
              >
                {testingOllama ? '⏳ Testing Connection...' : '🧪 Test Connection'}
              </button>

              {ollamaStatus !== 'unknown' && (
                <div
                  className={`rounded p-3 text-sm font-medium ${
                    ollamaStatus === 'connected'
                      ? 'bg-green-900 text-green-100 border border-green-700'
                      : 'bg-red-900 text-red-100 border border-red-700'
                  }`}
                >
                  {ollamaMessage}
                </div>
              )}

              <div className="bg-gray-900 rounded p-4 border border-gray-700">
                <h3 className="font-semibold text-gray-100 mb-2">How to Set Up Ollama:</h3>
                <ol className="text-sm text-gray-300 space-y-1 list-decimal list-inside">
                  <li>Install Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">ollama.ai</a></li>
                  <li>Run: <code className="bg-gray-800 px-1 rounded">ollama run llama2</code></li>
                  <li>Set env vars in <code className="bg-gray-800 px-1 rounded">.env</code>: OLLAMA_ENDPOINT, OLLAMA_MODEL</li>
                  <li>Restart API/worker containers to pick up changes</li>
                </ol>
              </div>

              <div className="bg-gray-900 rounded p-4 border border-gray-700">
                <h3 className="font-semibold text-gray-100 mb-2">How It Works:</h3>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>✓ Events are <strong>automatically categorized at ingestion</strong> by the worker</li>
                  <li>✓ Categories, actors, themes, and significance are stored in the database</li>
                  <li>✓ Stored data is used as RAG context when you click an event</li>
                  <li>✓ Related events are found by shared categories and actors</li>
                  <li>✓ All analysis happens locally via Ollama (no cloud data)</li>
                  <li>✓ Graceful fallback to tag-based analysis if Ollama is unavailable</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
