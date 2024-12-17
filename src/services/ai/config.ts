export interface AIConfig {
  provider: 'openai' | 'local' | 'custom';
  apiKey: string;
  endpoint?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export const DEFAULT_CONFIG: Partial<AIConfig> = {
  model: 'gpt-4o',
  maxTokens: 1000,
  temperature: 0.7
};