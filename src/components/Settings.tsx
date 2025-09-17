import React, { FC } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Model, Provider } from '../types'
import { AppSettings } from '../config'

const Settings: FC<{
  modelsList: Model[]
  setModelsList: (models: Model[]) => void
  selectedProvider: string
  setSelectedProvider: (provider: string) => void
  selectedModel: Model
  setSelectedModel: (model: Model) => void
  apiKeys: { [key: string]: string }
  setApiKeys: (keys: { [key: string]: string }) => void
  appSettings: AppSettings
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  totalEmbeddingsCount: number;
  handleIncrementMlWorkers: () => void;
  handleDecrementMlWorkers: () => void;
  handleIncrementInitialCandidates: () => void;
  handleDecrementInitialCandidates: () => void;
  handleIncrementFinalContextChunks: () => void;
  handleDecrementFinalContextChunks: () => void;
  handleToggleReranking: () => void;
  handleToggleLogging: () => void;
  className?: string; // Add className prop
}> = ({
  className, // Destructure className
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
  totalEmbeddingsCount,
  handleIncrementMlWorkers,
  handleDecrementMlWorkers,
  handleIncrementInitialCandidates,
  handleDecrementInitialCandidates,
  handleIncrementFinalContextChunks,
  handleDecrementFinalContextChunks,
  handleToggleReranking,
  handleToggleLogging,
}) => {
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
      const customModelName = window.prompt('Enter the custom model name (e.g. "google/gemini-pro"):');
      if (customModelName) {
        const newModel: Model = {
          id: customModelName,
          name: customModelName,
          provider: selectedProvider as Provider,
          apiKeyRequired: selectedProvider === 'openrouter' || selectedProvider === 'openai' || selectedProvider === 'google',
        };
        const newModelsList = [...modelsList, newModel];
        setModelsList(newModelsList);
        setSelectedModel(newModel);
      }
      return;
    }
    const newModel = modelsList.find((m) => m.name === newModelName)
    if (newModel) {
      setSelectedModel(newModel)
    }
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeys({ ...apiKeys, [selectedProvider]: e.target.value })
  }

  const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target;
    const name = target.name;
    const value = target.value;
    const checked = (target as HTMLInputElement).checked; // Only for checkboxes

    setAppSettings((prevSettings: AppSettings) => {
      const newSettings: AppSettings = { ...prevSettings };

      switch (name) {
        case 'isDeepAnalysisEnabled':
        case 'isSemanticChunkingEnabled':
        case 'isLoggingEnabled':
        case 'isRerankingEnabled':
        case 'isLightQueryTransformationEnabled':
        case 'docOnlyMode':
          newSettings[name] = checked;
          break;
        case 'parentChunkSize':
        case 'numSubQuestions':
        case 'relevanceThreshold':
          newSettings[name] = parseInt(value, 10);
          break;
        case 'numInitialCandidates': {
          const parsedValue = parseInt(value, 10);
          const numericValue = isNaN(parsedValue) || parsedValue < 1 ? 1 : parsedValue;
          newSettings.numInitialCandidates = numericValue;

          // If final context was MAX, or if it's now greater than new initial candidates, adjust it
          if (prevSettings.numFinalContextChunks === prevSettings.numInitialCandidates || newSettings.numFinalContextChunks > numericValue) {
            newSettings.numFinalContextChunks = numericValue;
          }
          break;
        }
        case 'numFinalContextChunks': {
          const parsedValue = parseInt(value, 10);
          let numericValue: number;

          if (isNaN(parsedValue) || parsedValue < 1) {
            if (value.toUpperCase() === 'MAX') {
              numericValue = newSettings.numInitialCandidates; // Treat "MAX" as initial candidates value
            } else {
              numericValue = 1; // Default to 1 for invalid or negative numbers
            }
          } else {
            numericValue = parsedValue;
          }

          newSettings.numFinalContextChunks = numericValue;
          // Ensure final context is not greater than initial candidates
          if (newSettings.numFinalContextChunks > newSettings.numInitialCandidates) {
            newSettings.numFinalContextChunks = newSettings.numInitialCandidates;
          }
          break;
        }
        case 'chatBubbleColor':
          newSettings[name] = value;
          break;
        // No default case: all AppSettings properties should be handled explicitly.
        // If a new setting is added to AppSettings, it must be added to this switch.
        // This ensures type safety and prevents accidental assignment of incorrect types.
      }
      return newSettings;
    });
  };

  React.useEffect(() => {
    if (totalEmbeddingsCount > 0) {
      const fiftyPercentOfEmbeddings = totalEmbeddingsCount * 0.5;
      if (
        appSettings.numInitialCandidates > fiftyPercentOfEmbeddings ||
        (appSettings.numFinalContextChunks !== appSettings.numInitialCandidates && appSettings.numFinalContextChunks > fiftyPercentOfEmbeddings)
      ) {
        alert(
          `Warning: Initial Candidates (${appSettings.numInitialCandidates}) or Final Context Chunks (${appSettings.numFinalContextChunks}) is more than 50% of total embeddings (${totalEmbeddingsCount}). This might indicate an inefficient search.`
        );
      }
    }
  }, [appSettings.numInitialCandidates, appSettings.numFinalContextChunks, totalEmbeddingsCount]);

  React.useEffect(() => {
    if (totalEmbeddingsCount > 0) {
      const fiftyPercentOfEmbeddings = totalEmbeddingsCount * 0.5;
      if (
        appSettings.numInitialCandidates > fiftyPercentOfEmbeddings ||
        (appSettings.numFinalContextChunks !== appSettings.numInitialCandidates && appSettings.numFinalContextChunks > fiftyPercentOfEmbeddings)
      ) {
        alert(
          `Warning: Initial Candidates (${appSettings.numInitialCandidates}) or Final Context Chunks (${appSettings.numFinalContextChunks}) is more than 50% of total embeddings (${totalEmbeddingsCount}). This might indicate an inefficient search.`
        );
      }
    }
  }, [appSettings.numInitialCandidates, appSettings.numFinalContextChunks, totalEmbeddingsCount]);

  return (
    <div className={`settings-panel ${className}`}>
      <div className='setting-row'>
        <label htmlFor='provider-select'>Provider:</label>
        <select
          id='provider-select'
          value={selectedProvider}
          onChange={handleProviderChange}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className='setting-row'>
        <label htmlFor='model-select'>Model:</label>
        <select id='model-select' value={selectedModel.name} onChange={handleModelChange}>
          {modelsList
            .filter((m) => m.provider === selectedProvider)
            .map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
            <option value="add-custom">Add custom model...</option>
        </select>
      </div>
      {selectedModel.apiKeyRequired && (
        <div className='setting-row'>
          <label htmlFor='api-key-input'>{selectedProvider} API Key:</label>
          <input
            type='password'
            id='api-key-input'
            value={apiKeys[selectedProvider] || ''}
            onChange={handleApiKeyChange}
            placeholder={`Enter your ${selectedProvider} API key`}
          />
        </div>
      )}
       <div className="setting-row">
       <label htmlFor="deep-analysis-toggle">Enable Deep Analysis:</label>
       <input
         type="checkbox"
         id="deep-analysis-toggle"
         name="isDeepAnalysisEnabled"
         checked={appSettings.isDeepAnalysisEnabled}
         onChange={handleSettingChange}
       />
     </div>
     <div className="setting-row">
       <label htmlFor="light-query-transformation-toggle">Enable Light Query Transformation:</label>
       <input
         type="checkbox"
         id="light-query-transformation-toggle"
         name="isLightQueryTransformationEnabled"
         checked={appSettings.isLightQueryTransformationEnabled}
         onChange={handleSettingChange}
       />
     </div>
     <div className="setting-row">
       <label htmlFor="semantic-chunking-toggle">Enable Semantic Chunking:</label>
       <input
         type="checkbox"
         id="semantic-chunking-toggle"
         name="isSemanticChunkingEnabled"
         checked={appSettings.isSemanticChunkingEnabled}
         onChange={handleSettingChange}
       />
      </div>
      {appSettings.isSemanticChunkingEnabled && (
        <div className="setting-row">
            <label htmlFor="parent-chunk-size-slider">Parent Chunk Size: {appSettings.parentChunkSize}</label>
            <input
                type="range"
                id="parent-chunk-size-slider"
                name="parentChunkSize"
                min="500"
                max="3000"
                step="100"
                value={appSettings.parentChunkSize}
                onChange={handleSettingChange}
            />
        </div>
      )}
       {appSettings.isDeepAnalysisEnabled && (
         <div className="setting-row">
           <label htmlFor="num-sub-questions-slider">Sub-questions: {appSettings.numSubQuestions}</label>
          <input
            type="range"
            id="num-sub-questions-slider"
            name="numSubQuestions"
            min="1"
            max="5"
            value={appSettings.numSubQuestions}
            onChange={handleSettingChange}
          />
        </div>
      )}
      <div className="setting-row">
        <label htmlFor="num-initial-candidates-input">Initial Candidates:</label>
        <input
          type="text"
          id="num-initial-candidates-input"
          name="numInitialCandidates"
          value={appSettings.numInitialCandidates}
          onChange={handleSettingChange}
        />
      </div>
      <div className="setting-row">
        <label htmlFor="num-final-context-chunks-input">Final Context Chunks:</label>
        <input
          type="text"
          id="num-final-context-chunks-input"
          name="numFinalContextChunks"
          value={appSettings.numFinalContextChunks === appSettings.numInitialCandidates ? 'MAX' : appSettings.numFinalContextChunks}
          onChange={handleSettingChange}
          title={appSettings.numFinalContextChunks === appSettings.numInitialCandidates ? 'The number is equal to the number of initial candidates and user should review/check if this is really desired' : ''}
          style={appSettings.numFinalContextChunks === appSettings.numInitialCandidates ? { color: 'red', fontWeight: 'bold' } : {}}
        />
      </div>
      <div className='setting-row'>
        <label>ML Workers:</label>
        <div className="worker-controls">
          <button onClick={handleDecrementMlWorkers} disabled={appSettings.numMlWorkers <= 2}>
            <Minus size={14} />
          </button>
          <span>{appSettings.numMlWorkers}</span>
          <button onClick={handleIncrementMlWorkers} disabled={appSettings.numMlWorkers >= (navigator.hardwareConcurrency || 4) -1}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className='setting-row' title="Enable or disable the reranking step. Disabling it will use the initial vector search results directly, which is faster but may be less accurate.">
        <label htmlFor='reranking-toggle'>Enable Reranker:</label>
        <button
          id='reranking-toggle'
          onClick={handleToggleReranking}
          className={`toggle-button ${appSettings.isRerankingEnabled ? 'active' : ''}`}
        >
          {appSettings.isRerankingEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className='setting-row' title="How many initial candidate chunks to retrieve from the vector store for the reranker to process. Higher values may find more relevant chunks but increase reranking time.">
        <label>Initial Candidates:</label>
        <div className="worker-controls">
          <button onClick={handleDecrementInitialCandidates} disabled={appSettings.numInitialCandidates <= 5 || !appSettings.isRerankingEnabled}>
            <Minus size={14} />
          </button>
          <span>{appSettings.numInitialCandidates}</span>
          <button onClick={handleIncrementInitialCandidates} disabled={!appSettings.isRerankingEnabled}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className='setting-row' title="When enabled, the assistant must answer strictly from your loaded documents. If no relevant evidence is found, it will not use general knowledge and will ask for clarification.">
        <label htmlFor='doc-only-toggle'>Doc-only Mode:</label>
        <input
          type='checkbox'
          id='doc-only-toggle'
          name='docOnlyMode'
          checked={appSettings.docOnlyMode}
          onChange={handleSettingChange}
        />
      </div>

      <div className='setting-row' title="How many of the top reranked chunks to include in the final context for the LLM. Higher values provide more context but may introduce noise.">
        <label>Final Context:</label>
        <div className="worker-controls">
          <button onClick={handleDecrementFinalContextChunks} disabled={appSettings.numFinalContextChunks <= 1 || !appSettings.isRerankingEnabled}>
            <Minus size={14} />
          </button>
          <span>{appSettings.numFinalContextChunks === appSettings.numInitialCandidates ? 'MAX' : appSettings.numFinalContextChunks}</span>
          <button onClick={handleIncrementFinalContextChunks} disabled={appSettings.numFinalContextChunks >= appSettings.numInitialCandidates || !appSettings.isRerankingEnabled}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className='setting-row'>
        <label htmlFor='logging-toggle'>Enable Logging:</label>
        <button
          id='logging-toggle'
          onClick={handleToggleLogging}
          className={`toggle-button ${appSettings.isLoggingEnabled ? 'active' : ''}`}
        >
          {appSettings.isLoggingEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className='setting-row'>
        <label htmlFor='chat-bubble-color-select'>Chat Bubble Color:</label>
        <select
          id='chat-bubble-color-select'
          name='chatBubbleColor'
          value={appSettings.chatBubbleColor}
          onChange={handleSettingChange}
        >
          <option value='default'>Default</option>
          <option value='orange'>Orange</option>
          <option value='red'>Red</option>
          <option value='sapphire'>Sapphire Blue</option>
          <option value='violet'>Violet</option>
          <option value='turquoise'>Turquoise</option>
          <option value='yellow'>Yellow</option>
          <option value='grey'>Grey</option>
          <option value='white'>White</option>
        </select>
      </div>
    </div>
  )
}

export default Settings