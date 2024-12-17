export interface AIRequestOptions {
  prompt: string;
  pageState?: any;
  systemPrompt?: string;
  context?: Record<string, any>;
}

export interface AIProvider {
  generateResponse(options: AIRequestOptions): Promise<string>;
}