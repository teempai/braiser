import { AIResponse, PageState } from '../types';
import { OpenAIProvider } from './ai/providers/openai';  
import { AIProvider } from './ai/types';  
import { AIResponseParser } from './ai/response-parser';  
import { StorageManager } from './storage';
import { AIConfig } from './ai/config';  

export class AIClient {
  private provider: AIProvider | null = null;
  private parser: AIResponseParser;
  private storage: StorageManager;
  private actionHistory: Array<{
    action: AIAction;
    reasoning: string;
    timestamp: string;
    success: boolean;
  }> = [];

  constructor() {
    this.parser = new AIResponseParser();
    this.storage = new StorageManager();
  }

  private async getProvider(): Promise<AIProvider> {
    if (this.provider) return this.provider;

    const settings = await this.storage.getSettings();
    if (!settings?.apiKey) {
      throw new Error('AI provider not configured. Please set up your API key.');
    }

    this.provider = new OpenAIProvider({ 
      provider: 'openai', 
      apiKey: settings.apiKey 
    });
    return this.provider;
  }

  private addToHistory(response: AIResponse, success: boolean) {
    this.actionHistory.push({
      action: response.action,
      reasoning: response.reasoning,
      timestamp: new Date().toISOString(),
      success
    });

    // Keep only last 10 actions
    if (this.actionHistory.length > 10) {
      this.actionHistory.shift();
    }
  }

  private formatActionHistory(): string {
    if (this.actionHistory.length === 0) return '';

    return this.actionHistory
      .map(({ action, reasoning, success }, index) => {
        const status = success ? '✓' : '✗';
        const actionStr = action.payload 
          ? `${action.type}(${JSON.stringify(action.payload)})`
          : action.type;
        return `${index + 1}. ${status} ${actionStr} - ${reasoning}`;
      })
      .join('\n');
  }

  async getNextAction(task: string, pageState: PageState): Promise<AIResponse> {
    try {
      const provider = await this.getProvider();
      const messages = [
        { 
          role: 'system', 
          content: `You are an AI assistant that helps users automate web browsing tasks.
Your role is to provide ONE action at a time to progress towards completing the user's task.

Available actions:
- NAVIGATE: Go to a URL (payload: { url: string })
- CLICK: Click on an element (payload: { selector: string })
- TYPE: Enter text (payload: { selector: string, text: string })
- SUBMIT: Submit a form (payload: { selector: string })
- SCROLL: Scroll the page (payload: { direction: "up" | "down", amount: number })
- HOVER: Hover over an element to reveal dropdown (payload: { selector: string })
- COMPLETE: Mark the task as successfully completed (no payload)
- FAILED: Mark the task as failed (payload: { reason: string })

Note: You are seeing elements currently visible in the viewport. If you can't find what you're looking for, consider scrolling to reveal more content.

${this.actionHistory.length > 0 ? `\nPrevious actions in this session:
${this.formatActionHistory()}\n` : ''}

Respond with a JSON object containing:
{
  "action": {
    "type": "ACTION_TYPE",
    "payload": { /* action-specific data */ }
  },
  "reasoning": "Brief explanation of the action"
}`
        },
        ...(pageState ? [{
          role: 'system',
          content: `Current Page State:
URL: ${pageState.url}
Title: ${pageState.title}
Available Elements: ${JSON.stringify(pageState.elements, null, 2)}`
        }] : []),
        { role: 'user', content: task }
      ];

      const rawResponse = await provider.generateCompletion(messages);
      const parsedResponse = this.parser.parse(rawResponse);
      
      // Add to history after successful parsing
      this.addToHistory(parsedResponse, true);
      
      return parsedResponse;
    } catch (error) {
      // If there was a parsed response before the error, mark it as failed
      if (this.actionHistory.length > 0) {
        this.actionHistory[this.actionHistory.length - 1].success = false;
      }
      
      console.error('AI service error:', error);
      throw error;
    }
  }
}