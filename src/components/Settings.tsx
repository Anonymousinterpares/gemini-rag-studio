import React, { FC } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Model, Provider } from '../types'
import { AppSettings } from '../config'
import { useSettingsStore, useComputeStore } from '../store'

const Settings: FC<{ className?: string }> = ({ className }) => {
  const {
    modelsList,
    setModelsList,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    apiKeys,
    setApiKeys,
    appSettings,
    setAppSettings,
  } = useSettingsStore();

  const { totalEmbeddingsCount } = useComputeStore();

  const providers = [...new Set(modelsList.map((m) => m.provider))]

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value
    setSelectedProvider(newProvider)
    const newModel = modelsList.find((m) => m.provider === newProvider)
    if (newModel) {
      setSelectedModel(newModel)
    }
  }

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModelName = e.target.value
    if (newModelName === 'add-custom') {
      const customModelName = window.prompt('Enter the custom model name:');
      if (customModelName) {
        const newModel: Model = {
          id: customModelName,
          name: customModelName,
          provider: selectedProvider as Provider,
          apiKeyRequired: ['openrouter', 'openai', 'google'].includes(selectedProvider),
        };
        setModelsList([...modelsList, newModel]);
        setSelectedModel(newModel);
      }
      return;
    }
    const newModel = modelsList.find((m) => m.name === newModelName)
    if (newModel) setSelectedModel(newModel)
  }

  const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target;
    const name = target.name;
    const value = target.value;
    const checked = (target as HTMLInputElement).checked;

    setAppSettings((prev: AppSettings) => {
      const next = { ...prev };
      switch (name) {
        case 'isDeepAnalysisEnabled':
        case 'isSemanticChunkingEnabled':
        case 'isLoggingEnabled':
        case 'isRerankingEnabled':
        case 'isLightQueryTransformationEnabled':
        case 'docOnlyMode':
          (next as unknown as Record<string, boolean>)[name] = checked;
          break;
        case 'parentChunkSize':
        case 'numSubQuestions':
        case 'relevanceThreshold':
          (next as unknown as Record<string, number>)[name] = parseInt(value, 10);
          break;
        case 'numInitialCandidates': {
          const val = parseInt(value, 10);
          const num = isNaN(val) || val < 1 ? 1 : val;
          next.numInitialCandidates = num;
          next.numFinalContextChunks = Math.min(next.numFinalContextChunks, num);
          break;
        }
        case 'numFinalContextChunks': {
          const val = parseInt(value, 10);
          const num = isNaN(val) || val < 1 ? (value.toUpperCase() === 'MAX' ? next.numInitialCandidates : 1) : val;
          next.numFinalContextChunks = Math.min(num, next.numInitialCandidates);
          break;
        }
        case 'chatBubbleColor':
          next.chatBubbleColor = value;
          break;
      }
      return next;
    });
  };

  return (
    <div className={`settings-panel ${className}`}>
      <div className='setting-row'>
        <label>Provider:</label>
        <select value={selectedProvider} onChange={handleProviderChange}>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className='setting-row'>
        <label>Model:</label>
        <select value={selectedModel.name} onChange={handleModelChange}>
          {modelsList.filter((m) => m.provider === selectedProvider).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          <option value="add-custom">Add custom...</option>
        </select>
      </div>
      {selectedModel.apiKeyRequired && (
        <div className='setting-row'>
          <label>API Key:</label>
          <input type='password' value={apiKeys[selectedProvider] || ''} onChange={(e) => setApiKeys(prev => ({ ...prev, [selectedProvider]: e.target.value }))} placeholder={`Enter key`} />
        </div>
      )}
      <div className="setting-row">
        <label>Deep Analysis:</label>
        <input type="checkbox" name="isDeepAnalysisEnabled" checked={appSettings.isDeepAnalysisEnabled} onChange={handleSettingChange} />
      </div>
      <div className="setting-row">
        <label>Candidates:</label>
        <div className="worker-controls">
          <button onClick={() => setAppSettings(p => ({...p, numInitialCandidates: Math.max(1, p.numInitialCandidates - 5)}))}><Minus size={14} /></button>
          <span>{appSettings.numInitialCandidates}</span>
          <button onClick={() => setAppSettings(p => ({...p, numInitialCandidates: p.numInitialCandidates + 5}))}><Plus size={14} /></button>
        </div>
      </div>
      <div className='setting-row'>
        <label>ML Workers:</label>
        <div className="worker-controls">
          <button onClick={() => setAppSettings(p => ({...p, numMlWorkers: Math.max(2, p.numMlWorkers - 1)}))} disabled={appSettings.numMlWorkers <= 2}><Minus size={14} /></button>
          <span>{appSettings.numMlWorkers}</span>
          <button onClick={() => setAppSettings(p => ({...p, numMlWorkers: p.numMlWorkers + 1}))} disabled={appSettings.numMlWorkers >= (navigator.hardwareConcurrency || 4) - 1}><Plus size={14} /></button>
        </div>
      </div>
      <div className='setting-row'>
        <label>Reranker:</label>
        <button onClick={() => setAppSettings(p => ({...p, isRerankingEnabled: !p.isRerankingEnabled}))} className={`toggle-button ${appSettings.isRerankingEnabled ? 'active' : ''}`}>{appSettings.isRerankingEnabled ? 'ON' : 'OFF'}</button>
      </div>
      <div className='setting-row'>
        <label>Logging:</label>
        <button onClick={() => setAppSettings(p => ({...p, isLoggingEnabled: !p.isLoggingEnabled}))} className={`toggle-button ${appSettings.isLoggingEnabled ? 'active' : ''}`}>{appSettings.isLoggingEnabled ? 'ON' : 'OFF'}</button>
      </div>
      <div className='setting-row'>
        <label>Bubble:</label>
        <select name='chatBubbleColor' value={appSettings.chatBubbleColor} onChange={handleSettingChange}>
          {['default', 'orange', 'red', 'sapphire', 'violet', 'turquoise', 'yellow', 'grey', 'white'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className='setting-row'>
        <span>Embeddings: {totalEmbeddingsCount}</span>
      </div>
    </div>
  )
}

export default Settings
