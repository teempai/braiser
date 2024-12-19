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
  private currentStoredData: string = '';
  private readonly MAX_STORED_LENGTH = 2000;  // ~2KB limit
  private readonly MAX_PRINT_LENGTH = 2000;   // ~2KB limit

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

      // Log the task and current state
      console.group('AI Request');
      console.log('Task:', task);
      console.log('Current URL:', pageState?.url);
      console.log('Stored Data:', this.currentStoredData || 'None');
      console.log('Action History:', this.actionHistory);
      
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
- STORE: Store text for later use (payload: { text: string, append: boolean })
- PRINT: Display information to user (payload: { text: string })
- COMPLETE: Mark the task as successfully completed (no payload)
- FAILED: Mark the task as failed (payload: { reason: string })

Notes: 
- If you find ALL the information the user is requesting use the PRINT action, not the STORE action. Only use STORE if you need collect information across multiple actions.
- When working with search forms, always SUBMIT the form after typing
- You are seeing elements currently visible in the viewport. If you can't find what you're looking for, consider scrolling to reveal more content.

${this.currentStoredData ? `\nCurrently stored data:
${this.currentStoredData}\n` : ''}

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

      // Log the raw AI response
      console.log('Raw AI Response:', rawResponse);
      
      const parsedResponse = this.parser.parse(rawResponse);
      
      // Handle STORE and PRINT actions
      if (parsedResponse.action.type === 'STORE') {
        const newText = this.validateStoredData(parsedResponse.action.payload.text);
        if (parsedResponse.action.payload.append && this.currentStoredData) {
          this.currentStoredData += '\n' + newText;
        } else {
          this.currentStoredData = newText;
        }
        parsedResponse.storedData = {
          text: this.currentStoredData,
          timestamp: Date.now()
        };
      } else if (parsedResponse.action.type === 'PRINT') {
        parsedResponse.action.payload.text = this.validatePrintData(parsedResponse.action.payload.text);
      } else if (parsedResponse.action.type === 'COMPLETE' || parsedResponse.action.type === 'FAILED') {
        // Clear stored data when task completes or fails
        this.currentStoredData = '';
      }
      
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

  private validateStoredData(text: string): string {
    if (text.length > this.MAX_STORED_LENGTH) {
      console.warn('Stored data exceeds maximum length, truncating...', {
        original: text.length,
        truncated: this.MAX_STORED_LENGTH
      });
      return text.slice(0, this.MAX_STORED_LENGTH);
    }
    return text;
  }

  private validatePrintData(text: string): string {
    if (text.length > this.MAX_PRINT_LENGTH) {
      console.warn('Print data exceeds maximum length, truncating...', {
        original: text.length,
        truncated: this.MAX_PRINT_LENGTH
      });
      return text.slice(0, this.MAX_PRINT_LENGTH);
    }
    return text;
  }
  
}