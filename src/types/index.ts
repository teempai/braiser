// Core types for the extension

export type ActionType = 
  | 'NAVIGATE'
  | 'CLICK'
  | 'TYPE'
  | 'SUBMIT'
  | 'COMPLETE' 
  | 'FAILED'
  | 'SCROLL'
  | 'HOVER'
  | 'STORE'
  | 'PRINT'

export interface AIAction {
  type: ActionType;
  payload?: Record<string, any>; // Made optional since COMPLETE doesn't need payload
}

export interface PageElement {
  type: string;
  text?: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  path: string; // CSS selector path
  children?: PageElement[];
}

export interface PageState {
  url: string;
  title: string;
  elements: PageElement[];
  timestamp: number;
}

export interface ExecutionLog {
  type: 'info' | 'error' | 'warning';
  message: string;
  timestamp: string;
}

export interface ExecutionState {
  status: 'idle' | 'running' | 'paused' | 'error' | 'stopped';
  currentStep: number;
  totalSteps: number;
  currentAction?: AIAction;
  error?: string;
  logs: ExecutionLog[];
}

export interface AIResponse {
  action: AIAction;
  reasoning: string;
  completed: boolean;
  failed: boolean;
  storedData?: StoredData;
}

export interface ExtensionSettings {
  aiProvider: 'openai' | 'local' | 'custom';
  apiEndpoint: string;
  apiKey: string;
}

export interface StoredData {
  text: string;
  timestamp: number;
}
