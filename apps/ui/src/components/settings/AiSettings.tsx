import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Text } from '../ui';
import { useAnalytics } from '../../analytics/runtime';
import {
  storeApiKey as storeApiKeyToStorage,
  clearApiKey as clearApiKeyFromStorage,
  hasApiKeyForProvider,
  getAvailableProviders as getAvailableProvidersFromStore,
  getProviderBaseUrl,
  storeProviderBaseUrl,
  clearProviderBaseUrl,
} from '../../stores/apiKeyStore';
import { useSettings } from '../../stores/settingsStore';
import { getPlatform } from '../../platform';
import { notifyError, notifySuccess } from '../../utils/notifications';
import { SettingsSupportBlock } from './SettingsPrimitives';
import { ApiProviderCard } from './ApiProviderCard';
import { ExternalAgentsCard } from './ExternalAgentsCard';

const MASKED_KEY = '••••••••••••••••••••••••••••••••••••••••••••';

export interface AiSettingsHandle {
  save: () => void;
}

interface AiSettingsProps {
  /** Triggers state reload each time the dialog opens */
  isOpen: boolean;
  /** Called whenever the save button's enabled state changes */
  onCanSaveChange: (canSave: boolean) => void;
}

export const AiSettings = forwardRef<AiSettingsHandle, AiSettingsProps>(
  ({ isOpen, onCanSaveChange }, ref) => {
    const [provider, setProvider] = useState<'anthropic' | 'openai' | 'ollama'>('anthropic');
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
    const [hasOpenAIKey, setHasOpenAIKey] = useState(false);
    const [hasOllamaKey, setHasOllamaKey] = useState(false);
    const [isLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showKey, setShowKey] = useState(false);
    const analytics = useAnalytics();
    const [settings] = useSettings();

    const loadKeys = useCallback(() => {
      const availableProviders = getAvailableProvidersFromStore();
      setHasAnthropicKey(availableProviders.includes('anthropic'));
      setHasOpenAIKey(availableProviders.includes('openai'));
      setHasOllamaKey(hasApiKeyForProvider('ollama') || !!getProviderBaseUrl('ollama'));

      if (provider === 'ollama') {
        setBaseUrl(getProviderBaseUrl('ollama') || '');
      }

      if (hasApiKeyForProvider(provider)) {
        setApiKey(MASKED_KEY);
      } else {
        setApiKey('');
      }
    }, [provider]);

    useEffect(() => {
      if (isOpen) {
        loadKeys();
      }
    }, [isOpen, loadKeys]);

    useEffect(() => {
      onCanSaveChange(!isLoading && (provider === 'ollama' ? true : !!apiKey.trim() && !apiKey.startsWith('•')));
    }, [apiKey, baseUrl, provider, isLoading, onCanSaveChange]);

    const handleSave = useCallback(() => {
      if (provider !== 'ollama' && (!apiKey.trim() || apiKey.startsWith('•'))) {
        setError('Please enter a valid API key');
        return;
      }

      setError(null);

      try {
        let savedKey = false;
        if (!apiKey.startsWith('•')) {
          if (apiKey.trim() || provider === 'ollama') {
            storeApiKeyToStorage(provider, apiKey);
            savedKey = true;
          }
        }
        
        if (provider === 'ollama') {
          if (baseUrl.trim()) {
            storeProviderBaseUrl('ollama', baseUrl);
          } else {
            clearProviderBaseUrl('ollama');
          }
          setHasOllamaKey(!!apiKey.trim() || !!baseUrl.trim());
        }

        if (savedKey) {
          analytics.track('api key saved', { provider });
          notifySuccess(`${provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Ollama'} settings saved`, {
            toastId: `save-api-key-${provider}`,
          });

          if (provider === 'anthropic') {
            setHasAnthropicKey(true);
          } else if (provider === 'openai') {
            setHasOpenAIKey(true);
          }

          if (apiKey.trim()) {
            setApiKey(MASKED_KEY);
          }
          setShowKey(false);
        } else if (provider === 'ollama') {
          analytics.track('api settings saved', { provider });
          notifySuccess(`Ollama settings saved`, {
            toastId: `save-api-key-${provider}`,
          });
        }
      } catch (err) {
        notifyError({
          operation: 'save-api-key',
          error: err,
          fallbackMessage: 'Failed to save settings',
          toastId: `save-api-key-error-${provider}`,
          logLabel: '[AiSettings] Failed to save settings',
        });
      }
    }, [apiKey, baseUrl, provider, analytics]);

    useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

    const handleClear = async (targetProvider: 'anthropic' | 'openai' | 'ollama') => {
      const providerName = targetProvider === 'anthropic' ? 'Anthropic' : targetProvider === 'openai' ? 'OpenAI' : 'Ollama';
      const confirmed = await getPlatform().confirm(
        `Are you sure you want to remove your ${providerName} settings?`,
        { title: 'Remove Settings', kind: 'warning', okLabel: 'Remove', cancelLabel: 'Cancel' }
      );
      if (!confirmed) return;

      setError(null);

      try {
        clearApiKeyFromStorage(targetProvider);
        if (targetProvider === 'ollama') {
          clearProviderBaseUrl('ollama');
          setHasOllamaKey(false);
        }
        
        analytics.track('api key cleared', { provider: targetProvider });
        notifySuccess(`${providerName} settings cleared`, { toastId: `clear-api-key-${targetProvider}` });

        if (targetProvider === 'anthropic') {
          setHasAnthropicKey(false);
        } else if (targetProvider === 'openai') {
          setHasOpenAIKey(false);
        }

        if (provider === targetProvider) {
          setApiKey('');
          if (provider === 'ollama') setBaseUrl('');
        }
      } catch (err) {
        notifyError({
          operation: 'clear-api-key',
          error: err,
          fallbackMessage: 'Failed to clear settings',
          toastId: `clear-api-key-error-${targetProvider}`,
          logLabel: '[AiSettings] Failed to clear settings',
        });
      }
    };

    return (
      <div className="flex flex-col ph-no-capture" style={{ gap: 'var(--space-section-gap)' }}>
        <Text variant="body">
          Add your API keys to enable AI assistant features. Model selection is available in the
          chat interface. Your key is stored locally on this device/browser profile and used for
          direct requests to the AI provider from the app. It is not sent to our analytics.
        </Text>

        <ApiProviderCard
          title="Anthropic API Key"
          description="Required for Claude models."
          placeholder="sk-ant-..."
          keyLink={{
            label: 'Get one from Anthropic',
            href: 'https://console.anthropic.com/settings/keys',
          }}
          isActive={provider === 'anthropic'}
          hasKey={hasAnthropicKey}
          apiKey={apiKey}
          showKey={showKey}
          isLoading={isLoading}
          onFocus={() => {
            if (provider !== 'anthropic') {
              setProvider('anthropic');
              setApiKey('');
              setShowKey(false);
            } else {
              setProvider('anthropic');
            }
          }}
          onChange={(value) => {
            setProvider('anthropic');
            setApiKey(value);
          }}
          onToggleShow={() => setShowKey((prev) => !prev)}
          onClear={() => {
            setProvider('anthropic');
            handleClear('anthropic');
          }}
        />

        <ApiProviderCard
          title="OpenAI API Key"
          description="Required for OpenAI models."
          placeholder="sk-..."
          keyLink={{ label: 'Get one from OpenAI', href: 'https://platform.openai.com/api-keys' }}
          isActive={provider === 'openai'}
          hasKey={hasOpenAIKey}
          apiKey={apiKey}
          showKey={showKey}
          isLoading={isLoading}
          onFocus={() => {
            if (provider !== 'openai') {
              setProvider('openai');
              setApiKey('');
              setShowKey(false);
            } else {
              setProvider('openai');
            }
          }}
          onChange={(value) => {
            setProvider('openai');
            setApiKey(value);
          }}
          onToggleShow={() => setShowKey((prev) => !prev)}
          onClear={() => {
            setProvider('openai');
            handleClear('openai');
          }}
        />

        <ApiProviderCard
          title="Ollama (Local & Proxied)"
          description="Required only for non-default configurations (Bearer token is optional)."
          placeholder="Bearer token (optional)"
          isActive={provider === 'ollama'}
          hasKey={hasOllamaKey}
          apiKey={apiKey}
          showKey={showKey}
          isLoading={isLoading}
          baseUrl={baseUrl}
          onBaseUrlChange={(value) => {
            setProvider('ollama');
            setBaseUrl(value);
          }}
          baseUrlPlaceholder="Base URL (default: http://localhost:11434/api)"
          onFocus={() => {
            if (provider !== 'ollama') {
              setProvider('ollama');
              setApiKey('');
              setBaseUrl(getProviderBaseUrl('ollama') || '');
              setShowKey(false);
            } else {
              setProvider('ollama');
            }
          }}
          onChange={(value) => {
            setProvider('ollama');
            setApiKey(value);
          }}
          onToggleShow={() => setShowKey((prev) => !prev)}
          onClear={() => {
            setProvider('ollama');
            handleClear('ollama');
          }}
        />

        {error && (
          <SettingsSupportBlock
            className="flex items-center text-sm"
            style={{
              gap: 'var(--space-control-gap)',
              backgroundColor: 'rgba(220, 50, 47, 0.1)',
              border: '1px solid rgba(220, 50, 47, 0.3)',
              color: 'var(--color-error)',
            }}
          >
            {error}
          </SettingsSupportBlock>
        )}

        {getPlatform().capabilities.hasFileSystem ? (
          <ExternalAgentsCard settings={settings} isOpen={isOpen} />
        ) : null}
      </div>
    );
  }
);

AiSettings.displayName = 'AiSettings';
