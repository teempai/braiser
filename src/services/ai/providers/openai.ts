import OpenAI from 'openai';
import { AIConfig, DEFAULT_CONFIG } from '../config';

export class OpenAIProvider {  // Remove extends BaseAIProvider
  private client: OpenAI;
  
  constructor(config: AIConfig) {
    this.client = new OpenAI({ 
      apiKey: config.apiKey 
    });
  }

  async generateCompletion(messages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create({
        model: DEFAULT_CONFIG.model!,
        messages,
        max_tokens: DEFAULT_CONFIG.maxTokens!,
        temperature: DEFAULT_CONFIG.temperature!
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No completion content received from OpenAI');
      }

      return content;
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }
}