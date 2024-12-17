import React, { useState, useEffect } from 'react';
import { ExtensionSettings } from '../types';
import { StorageManager } from '../services/storage';
import { AlertCircle } from 'lucide-react';

interface SettingsFormProps {
  onClose: () => void;
}

export function SettingsForm({ onClose }: SettingsFormProps) {
  const [settings, setSettings] = useState<ExtensionSettings>({
    aiProvider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const storage = new StorageManager();

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const stored = await storage.getSettings();
      if (stored) {
        setSettings(stored);
      }
    } catch (err) {
      setError('Failed to load settings');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await storage.saveSettings(settings);
      onClose();
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            AI Provider
          </label>
          <select
            value={settings.aiProvider}
            onChange={(e) => setSettings({
              ...settings,
              aiProvider: e.target.value as ExtensionSettings['aiProvider']
            })}
            className="input"
          >
            <option value="openai">OpenAI</option>
            <option value="local">Local Model</option>
            <option value="custom">Custom Endpoint</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            API Key
          </label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            className="input"
            placeholder="sk-..."
          />
          <p className="mt-1 text-xs text-gray-500">
            Your API key will be stored securely in your browser.
          </p>
        </div>

        {settings.aiProvider === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Endpoint
            </label>
            <input
              type="url"
              value={settings.apiEndpoint}
              onChange={(e) => setSettings({ ...settings, apiEndpoint: e.target.value })}
              className="input"
              placeholder="https://..."
            />
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <button
          type="button"
          onClick={onClose}
          className="btn btn-secondary"
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </form>
  );
}