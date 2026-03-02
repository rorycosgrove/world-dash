'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

// ---- types ----
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

interface OllamaModel {
  name: string;
  size: string | null;
  modified_at: string | null;
}

type TabType = 'sources' | 'ollama';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('sources');

  // ---- sources ----
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSource, setNewSource] = useState<NewSource>({
    name: '',
    url: '',
    type: 'rss',
    tags: [],
    enabled: true,
  });
  const [tagInput, setTagInput] = useState('');

  // ---- ollama config ----
  const [cfgEndpoint, setCfgEndpoint] = useState('');
  const [cfgModel, setCfgModel] = useState('');
  const [cfgTimeout, setCfgTimeout] = useState(120);
  const [cfgEnabled, setCfgEnabled] = useState(true);
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingHealth, setTestingHealth] = useState(false);

  // ---- load ollama config ----
  const loadLLMConfig = useCallback(async () => {
    try {
      const cfg = await api.getLLMConfig();
      setCfgEndpoint(cfg.endpoint);
      setCfgModel(cfg.model);
      setCfgTimeout(cfg.timeout_seconds);
      setCfgEnabled(cfg.enabled);
    } catch {
      console.error('Failed to load LLM config');
    }
  }, []);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const data = await api.getLLMModels();
      setAvailableModels(data.models);
    } catch {
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadLLMConfig();
    loadModels();
  }, [loadLLMConfig, loadModels]);

  // ---- sources ----
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
  useEffect(() => { fetchSources(); }, []);

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const source = await api.createSource({
        ...newSource,
        tags: tagInput.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setSources([...sources, source]);
      setNewSource({ name: '', url: '', type: 'rss', tags: [], enabled: true });
      setTagInput('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to create source:', error);
    }
  };

  const handleToggleEnabled = async (source: Source) => {
    try {
      const updated = await api.updateSource(source.id, { enabled: !source.enabled });
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

  // ---- ollama save ----
  const handleSaveConfig = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await api.updateLLMConfig({
        endpoint: cfgEndpoint,
        model: cfgModel,
        timeout_seconds: cfgTimeout,
        enabled: cfgEnabled,
      });
      setCfgEndpoint(updated.endpoint);
      setCfgModel(updated.model);
      setCfgTimeout(updated.timeout_seconds);
      setCfgEnabled(updated.enabled);
      setSaveMsg({ ok: true, text: '✓ Configuration saved — workers will use the new settings on their next task.' });
    } catch (err: any) {
      setSaveMsg({ ok: false, text: `✗ Failed to save: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  // ---- ollama health ----
  const handleTestHealth = async () => {
    setTestingHealth(true);
    setHealthMsg(null);
    try {
      const health = await api.getLLMHealth();
      if (health.status === 'healthy') {
        setHealthMsg({ ok: true, text: health.message });
      } else {
        setHealthMsg({ ok: false, text: health.message });
      }
      // refresh model list
      await loadModels();
    } catch (err: any) {
      setHealthMsg({ ok: false, text: `✗ API unreachable: ${err.message}` });
    } finally {
      setTestingHealth(false);
    }
  };

  // ----------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-purple-400">⚙️ Settings</h1>
            <p className="text-sm text-gray-400">Configure feeds, AI model, and worker pipeline</p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {(['sources', 'ollama'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-purple-500 text-purple-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab === 'sources' ? '📰 Feed Sources' : '🤖 AI / LLM'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        {/* ============ SOURCES TAB ============ */}
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
                  {refreshing ? '⏳ Refreshing…' : '🔄 Refresh All'}
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
              <div className="text-center py-12 text-gray-400">Loading feeds…</div>
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
                          {source.last_error && (
                            <span className="text-red-400 ml-2">• Error: {source.last_error.slice(0, 60)}</span>
                          )}
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

        {/* ============ OLLAMA / LLM TAB ============ */}
        {activeTab === 'ollama' && (
          <div className="max-w-3xl space-y-6">
            <h2 className="text-xl font-semibold text-gray-100">AI / LLM Configuration</h2>

            {/* Config card */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-5">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="font-medium text-gray-200">LLM Processing</label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    When enabled, new events are automatically categorised by the AI model.
                  </p>
                </div>
                <button
                  onClick={() => setCfgEnabled(!cfgEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    cfgEnabled ? 'bg-green-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      cfgEnabled ? 'translate-x-6' : ''
                    }`}
                  />
                </button>
              </div>

              {/* Endpoint */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Ollama Endpoint</label>
                <input
                  type="url"
                  value={cfgEndpoint}
                  onChange={(e) => setCfgEndpoint(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  From Docker containers use <code className="bg-gray-900 px-1 rounded">http://host.docker.internal:11434</code>
                </p>
              </div>

              {/* Model selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-300">Model</label>
                  <button
                    onClick={loadModels}
                    disabled={loadingModels}
                    className="text-[11px] text-purple-400 hover:text-purple-300 disabled:opacity-50"
                  >
                    {loadingModels ? 'Loading…' : '↻ Refresh models'}
                  </button>
                </div>

                {availableModels.length > 0 ? (
                  <div className="space-y-1">
                    {/* Dropdown */}
                    <select
                      value={cfgModel}
                      onChange={(e) => setCfgModel(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                    >
                      {/* If the current model isn't in the list, still show it */}
                      {!availableModels.some((m) => m.name === cfgModel) && (
                        <option value={cfgModel}>{cfgModel} (not found on server)</option>
                      )}
                      {availableModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} {m.size ? `(${m.size})` : ''}
                        </option>
                      ))}
                    </select>

                    {/* Model chips */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {availableModels.map((m) => (
                        <button
                          key={m.name}
                          onClick={() => setCfgModel(m.name)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            cfgModel === m.name
                              ? 'bg-purple-600 border-purple-400 text-white'
                              : 'border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={cfgModel}
                      onChange={(e) => setCfgModel(e.target.value)}
                      placeholder="e.g. deepseek-r1:8b"
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-yellow-400/70 mt-1">
                      No models found. Is Ollama running? Click "Test Connection" below.
                    </p>
                  </div>
                )}
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Timeout (seconds)
                </label>
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={cfgTimeout}
                  onChange={(e) => setCfgTimeout(Number(e.target.value))}
                  className="w-32 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  How long to wait for Ollama to respond before timing out. Larger models need more time.
                </p>
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-700">
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 rounded font-medium text-sm disabled:opacity-50 transition-colors"
                >
                  {saving ? '⏳ Saving…' : '💾 Save Configuration'}
                </button>
                <button
                  onClick={handleTestHealth}
                  disabled={testingHealth}
                  className="px-5 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded font-medium text-sm disabled:opacity-50 transition-colors"
                >
                  {testingHealth ? '⏳ Testing…' : '🧪 Test Connection'}
                </button>
              </div>

              {/* Save result */}
              {saveMsg && (
                <div className={`rounded p-3 text-sm ${
                  saveMsg.ok
                    ? 'bg-green-900/40 text-green-200 border border-green-700'
                    : 'bg-red-900/40 text-red-200 border border-red-700'
                }`}>
                  {saveMsg.text}
                </div>
              )}

              {/* Health result */}
              {healthMsg && (
                <div className={`rounded p-3 text-sm ${
                  healthMsg.ok
                    ? 'bg-green-900/40 text-green-200 border border-green-700'
                    : 'bg-red-900/40 text-red-200 border border-red-700'
                }`}>
                  {healthMsg.text}
                </div>
              )}
            </div>

            {/* Worker pipeline info */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="font-semibold text-gray-100 mb-3">Worker Pipeline</h3>
              <div className="space-y-2 text-sm text-gray-300">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span><strong>default</strong> queue — ingestion, normalisation, analysis (concurrency 4)</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span><strong>llm</strong> queue — AI categorisation (concurrency 1, sequential)</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  The LLM worker processes one event at a time so Ollama is never overloaded.
                  Batches of 5 events are queued every 5 minutes. A Redis lock prevents overlapping batches.
                </p>
              </div>
            </div>

            {/* How-to */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="font-semibold text-gray-100 mb-3">Quick Start</h3>
              <ol className="text-sm text-gray-300 space-y-1.5 list-decimal list-inside">
                <li>Install Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">ollama.ai</a></li>
                <li>Pull a model: <code className="bg-gray-900 px-1.5 rounded text-xs">ollama pull deepseek-r1:8b</code></li>
                <li>Select the model above and click <strong>Save Configuration</strong></li>
                <li>Events will be categorised automatically — no restart needed</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
