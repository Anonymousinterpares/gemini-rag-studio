import { create } from 'zustand';
import { Model, Provider } from '../types';
import models from '../models.json';
import { AppSettings, loadSettings, saveSettings } from '../config';

interface SettingsState {
  appSettings: AppSettings;
  modelsList: Model[];
  selectedProvider: Provider;
  selectedModel: Model;
  apiKeys: Record<string, string>;
  
  // Actions
  setAppSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  setModelsList: (models: Model[]) => void;
  setSelectedProvider: (provider: string) => void;
  setSelectedModel: (model: Model) => void;
  setApiKeys: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

const initialAppSettings = loadSettings();

const getInitialModelsList = (): Model[] => {
  // 1. Get base models from JSON (Source of Truth)
  const baseModels = Object.entries(models).flatMap(([provider, providerModels]) =>
    (providerModels as { id: string; name: string; description?: string; apiKeyRequired?: boolean }[]).map((model) => ({
      ...model,
      provider: provider as Provider,
      apiKeyRequired: model.apiKeyRequired !== undefined ? model.apiKeyRequired : (provider === 'openai' || provider === 'google' || provider === 'openrouter'),
    }))
  ) as Model[];

  const baseKeys = new Set(baseModels.map(m => `${m.provider}:${m.id}`));
  const managedProviders = Object.keys(models);

  // 2. Load and Prune localStorage
  const savedModelsStr = localStorage.getItem('modelsList');
  if (savedModelsStr) {
    try {
      const savedModels = JSON.parse(savedModelsStr) as Model[];
      if (Array.isArray(savedModels)) {
        // Filter out legacy models: keep only those in JSON or from unmanaged providers
        const activeModels = savedModels.filter(saved => {
          const key = `${saved.provider}:${saved.id}`;
          return !managedProviders.includes(saved.provider) || baseKeys.has(key);
        });

        // Merge: Use baseModels as foundation to get latest names/descriptions
        const merged = [...baseModels];
        const mergedKeys = new Set(baseModels.map(m => `${m.provider}:${m.id}`));

        // Add any valid custom models from localStorage that aren't in JSON
        activeModels.forEach(saved => {
          const key = `${saved.provider}:${saved.id}`;
          if (!mergedKeys.has(key)) {
            merged.push(saved);
          }
        });

        return merged;
      }
    } catch (e) {
      console.error("Failed to parse/prune models from localStorage", e);
    }
  }
  
  return baseModels;
};

const initialModelsList = getInitialModelsList();

const getInitialProvider = (modelsList: Model[]): Provider => {
  const savedProvider = localStorage.getItem('selectedProvider') as Provider | null;
  const availableProviders = [...new Set(modelsList.map(m => m.provider))] as Provider[];
  if (savedProvider && availableProviders.includes(savedProvider)) {
    return savedProvider;
  }
  return availableProviders[0] || 'ollama';
};

const initialProvider = getInitialProvider(initialModelsList);

const getInitialModel = (modelsList: Model[], provider: Provider): Model => {
  const savedModelName = localStorage.getItem('selectedModelName');
  const providerModels = modelsList.filter(m => m.provider === provider);
  if (savedModelName) {
    const savedModel = modelsList.find(m => m.name === savedModelName);
    if (savedModel) return savedModel;
  }
  return providerModels.length > 0 ? providerModels[0] : modelsList[0];
};

const initialModel = getInitialModel(initialModelsList, initialProvider);

const getInitialApiKeys = (): Record<string, string> => {
  const savedApiKeys = localStorage.getItem('apiKeys');
  if (savedApiKeys) {
    try {
      return JSON.parse(savedApiKeys);
    } catch (e) {
      console.error("Failed to parse apiKeys from localStorage", e);
    }
  }
  return {};
};

export const useSettingsStore = create<SettingsState>((set) => ({
  appSettings: initialAppSettings,
  modelsList: initialModelsList,
  selectedProvider: initialProvider,
  selectedModel: initialModel,
  apiKeys: getInitialApiKeys(),

  setAppSettings: (updater) => set((state) => {
    const nextSettings = updater(state.appSettings);
    saveSettings(nextSettings);
    return { appSettings: nextSettings };
  }),

  setModelsList: (models) => set(() => {
    localStorage.setItem('modelsList', JSON.stringify(models));
    return { modelsList: models };
  }),

  setSelectedProvider: (providerName) => set((state) => {
    const provider = state.modelsList.find(m => m.provider === providerName)?.provider as Provider | undefined;
    if (provider) {
      localStorage.setItem('selectedProvider', provider);
      return { selectedProvider: provider };
    }
    return {};
  }),

  setSelectedModel: (model) => set(() => {
    localStorage.setItem('selectedModelName', model.name);
    return { selectedModel: model };
  }),

  setApiKeys: (updater) => set((state) => {
    const nextApiKeys = updater(state.apiKeys);
    localStorage.setItem('apiKeys', JSON.stringify(nextApiKeys));
    return { apiKeys: nextApiKeys };
  }),
}));
