// src/config.ts

export interface AppSettings {
  numMlWorkers: number;
  isLoggingEnabled: boolean;
  isRerankingEnabled: boolean;
  isSemanticChunkingEnabled: boolean;
  parentChunkSize: number;
  numInitialCandidates: number;
  numFinalContextChunks: number;
  isDeepAnalysisEnabled: boolean;
  numSubQuestions: number;
  relevanceThreshold: number;
  backgroundIndex: number;
  isLightQueryTransformationEnabled: boolean;
  chatBubbleColor: string;
  isChatModeEnabled: boolean;
  // Enforcement: when true, answers must be based on the user's documents only
  docOnlyMode: boolean;
  // Feature flags
  enableRouterV2?: boolean;
  enableDeepAnalysisV1?: boolean;
  enableCitationGroupUX?: boolean;
  deepAnalysisLevel?: 2 | 3; // 2 = single pass, 3 = with gap analysis
}

const SETTINGS_KEY = 'gemini-rag-studio-settings';

const DEFAULT_SETTINGS: AppSettings = {
  numMlWorkers: 2,
  isLoggingEnabled: true,
  isRerankingEnabled: true,
  isSemanticChunkingEnabled: false, // Default to off for now
  parentChunkSize: 1000,
  numInitialCandidates: 20,
  numFinalContextChunks: 5,
  isDeepAnalysisEnabled: false,
  numSubQuestions: 3,
  relevanceThreshold: 0.25,
  backgroundIndex: 0,
  isLightQueryTransformationEnabled: false,
  chatBubbleColor: 'default',
  isChatModeEnabled: false,
  docOnlyMode: true,
  // Enable new features by default for testing; can be toggled in Settings later
  enableRouterV2: true,
  enableDeepAnalysisV1: true,
  enableCitationGroupUX: true,
  deepAnalysisLevel: 2,
};

/**
 * Loads application settings from localStorage.
 * If no settings are found, it returns the default settings.
 * @returns The loaded or default application settings.
 */
export function loadSettings(): AppSettings {
  try {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      // Merge with defaults to ensure all keys are present
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error('Error loading settings from localStorage:', error);
    // Fallback to defaults in case of parsing errors
  }
  return DEFAULT_SETTINGS;
}

/**
 * Saves application settings to localStorage.
 * @param settings The settings object to save.
 */
export function saveSettings(settings: AppSettings): void {
  try {
    const settingsString = JSON.stringify(settings);
    localStorage.setItem(SETTINGS_KEY, settingsString);
  } catch (error) {
    console.error('Error saving settings to localStorage:', error);
  }
}