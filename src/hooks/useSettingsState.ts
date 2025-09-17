import { useState, useEffect } from 'react';
import { Model, Provider } from '../types';
import models from '../models.json';

export const useSettingsState = () => {
  const [modelsList, setModelsList] = useState<Model[]>(() => {
    const savedModels = localStorage.getItem('modelsList');
    if (savedModels) {
      try {
        const parsedModels = JSON.parse(savedModels);
        if (Array.isArray(parsedModels) && parsedModels.length > 0) return parsedModels;
      } catch (e) {
        console.error("Failed to parse models from localStorage", e);
      }
    }
    return Object.entries(models).flatMap(([provider, providerModels]) =>
      providerModels.map((model: { id: string; name: string; description?: string; apiKeyRequired?: boolean }) => ({
        ...model,
        provider,
        apiKeyRequired: model.apiKeyRequired !== undefined ? model.apiKeyRequired : (provider === 'openai' || provider === 'google' || provider === 'openrouter'),
      }))
    )
  });

  const [selectedProvider, setSelectedProvider] = useState<Provider>(() => {
    const savedProvider = localStorage.getItem('selectedProvider') as Provider | null;
    const availableProviders = [...new Set(modelsList.map(m => m.provider))] as Provider[];
    if (savedProvider && availableProviders.includes(savedProvider)) {
      return savedProvider;
    }
    return availableProviders[0] || 'ollama';
  });

  const [selectedModel, setSelectedModel] = useState<Model>(() => {
    const savedModelName = localStorage.getItem('selectedModelName');
    const providerModels = modelsList.filter(m => m.provider === selectedProvider);
    if (savedModelName) {
      const savedModel = modelsList.find(m => m.name === savedModelName);
      if (savedModel) return savedModel;
    }
    return providerModels.length > 0 ? providerModels[0] : modelsList[0];
  });

  const [apiKeys, setApiKeys] = useState<{ [key: string]: string }>(() => {
    const savedApiKeys = localStorage.getItem('apiKeys');
    if (savedApiKeys) {
      try {
        return JSON.parse(savedApiKeys);
      } catch (e) {
        console.error("Failed to parse apiKeys from localStorage", e);
      }
    }
    return {};
  });

  useEffect(() => {
    localStorage.setItem('selectedProvider', selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('selectedModelName', selectedModel.name);
    }
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('apiKeys', JSON.stringify(apiKeys));
  }, [apiKeys]);

  useEffect(() => {
    localStorage.setItem('modelsList', JSON.stringify(modelsList));
  }, [modelsList]);

  const handleSetSelectedProvider = (providerName: string) => {
    const provider = modelsList.find(m => m.provider === providerName)?.provider as Provider | undefined;
    if (provider) {
      setSelectedProvider(provider);
    }
  };

  return {
    modelsList,
    setModelsList,
    selectedProvider,
    setSelectedProvider: handleSetSelectedProvider,
    selectedModel,
    setSelectedModel,
    apiKeys,
    setApiKeys,
  };
};