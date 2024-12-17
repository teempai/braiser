import { AIResponse } from '../../types';

export class AIResponseParser {
  parse(rawResponse: string): AIResponse {
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.action || !parsed.action.type) {
        throw new Error('Invalid response format: missing action or action type');
      }

      return {
        action: parsed.action,
        reasoning: parsed.reasoning || '',
        completed: parsed.action.type === 'COMPLETE',
        failed: parsed.action.type === 'FAILED'
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      throw new Error('Invalid AI response format');
    }
  }
}