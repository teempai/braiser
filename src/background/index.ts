import { AIClient } from '../services/ai-client';
import { AIResponse, ExecutionState, PageState, AIAction } from '../types';
import { StorageManager } from '../services/storage';

class BackgroundService {
  private aiClient: AIClient;
  private storage: StorageManager;
  private windowId: number | null = null;
  private targetTabId: number | null = null;
  private executionState: ExecutionState = {
    status: 'idle',
    currentStep: 0,
    totalSteps: 0,
    logs: []
  };
  private currentTask: {
    prompt: string;
  } | null = null;
  private lastPageState: PageState | null = null;

  constructor() {
    this.aiClient = new AIClient();
    this.storage = new StorageManager();
    this.initializeListeners();
  }

  private initializeListeners() {
    chrome.action.onClicked.addListener(async (tab) => {
      console.log('Extension clicked on tab:', tab);
  
      try {
        // Only create a new tab if we're on a browser internal page
        if (!this.targetTabId || (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')))) {
          const newTab = await chrome.tabs.create({
            url: 'https://duckduckgo.com',
            active: true
          });
          this.targetTabId = newTab.id;
          this.targetTabUrl = newTab.url || '';
          
          // Wait for the new tab to load
          await new Promise<void>((resolve) => {
            const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
              if (tabId === newTab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        } else {
          // Use existing tab
          this.targetTabId = tab.id;
          this.targetTabUrl = tab.url || '';
        }
  
        await this.openAssistantWindow();
      } catch (error) {
        console.error('Failed to initialize extension:', error);
      }
    });
  
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Background received message:', message);
      
      (async () => {
        try {
          switch (message.type) {
            case 'START_TASK':
              await this.handleNewTask(message.prompt);
              sendResponse({ success: true });
              break;
              
            case 'PAGE_STATE_UPDATE':
              await this.handlePageStateUpdate(message.state);
              sendResponse({ success: true });
              break;
              
            case 'EXECUTION_STOP':
              this.stopExecution();
              sendResponse({ success: true });
              break;
  
            default:
              console.warn('Unknown message type:', message.type);
              sendResponse({ success: false, error: 'Unknown message type' });
          }
        } catch (error) {
          console.error('Error handling message:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          sendResponse({ success: false, error: errorMessage });
          this.updateExecutionState({
            status: 'error',
            error: errorMessage,
            logs: [...this.executionState.logs, {
              type: 'error',
              message: errorMessage,
              timestamp: new Date().toISOString()
            }]
          });
        }
      })();
      
      return true;
    });
  }

  private async openAssistantWindow() {
    // Close existing window if it exists
    if (this.windowId !== null) {
      try {
        await chrome.windows.remove(this.windowId);
      } catch (error) {
        console.warn('Failed to close existing window:', error);
      }
    }

    // Create new window
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL('popup/index.html'),
      type: 'popup',
      width: 400,
      height: 1200,
      focused: true
    });

    this.windowId = window.id || null;

    // Reset state when window is closed
    chrome.windows.onRemoved.addListener((windowId) => {
      if (windowId === this.windowId) {
        this.windowId = null;
        this.targetTabId = null;
        this.stopExecution();
      }
    });
  }

  private async handleNewTask(prompt: string) {
    if (this.executionState.status === 'running') {
      throw new Error('A task is already running.');
    }
  
    try {
      if (!this.targetTabId) {
        throw new Error('No target tab found');
      }
  
      // Reset state for new task
      this.currentTask = { prompt };
      this.lastPageState = null;
  
      const response = await this.aiClient.getNextAction(prompt, this.lastPageState);
      
      if (!response.action) {
        throw new Error('No action received from AI');
      }
  
      this.currentTask = {
        prompt,
        actions: [response.action],
        currentActionIndex: 0
      };
  
      this.updateExecutionState({
        status: 'running',
        currentStep: 1,
        totalSteps: 1,
        currentAction: response.action,
        logs: [{
          type: 'info',
          message: `Starting task: ${prompt}\nAI Reasoning: ${response.reasoning || 'No reasoning provided'}`,
          timestamp: new Date().toISOString()
        }]
      });
  
      await this.executeAction(response.action);
    } catch (error) {
      console.error('Error starting task:', error);
      throw error;
    }
  }
  
  private async executeAction(action: AIAction): Promise<void> {
    if (!this.targetTabId) {
      throw new Error('No target tab found');
    }
  
    try {
      // Log the action we're about to execute
      this.updateExecutionState({
        currentAction: action,
        logs: [...this.executionState.logs, {
          type: 'info',
          message: this.getActionDescription(action),
          timestamp: new Date().toISOString()
        }]
      });
  
      // Handle new actions
      if (action.type === 'STORE') {
        // STORE is handled by AIClient, no need for additional processing
        return;
      }
  
      if (action.type === 'PRINT') {
        this.updateExecutionState({
          logs: [...this.executionState.logs, {
            type: 'info',
            message: action.payload.text,
            timestamp: new Date().toISOString()
          }]
        });
        return;
      }
  
      // For navigation actions, use the special navigate handler
      if (action.type === 'NAVIGATE') {
        await this.navigate(action.payload.url);
        return;
      }
  
      // For other actions, try to execute with retry logic
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          switch (action.type) {
            case 'CLICK':
              await this.executeInTab(this.targetTabId, 'click', action.payload);
              break;
            case 'TYPE':
              await this.executeInTab(this.targetTabId, 'type', action.payload);
              break;
            case 'SUBMIT':
              await this.executeInTab(this.targetTabId, 'submit', action.payload);
              break;
            case 'SCROLL':
              await this.executeInTab(this.targetTabId, 'scroll', action.payload);
              break;
            case 'HOVER':
              await this.executeInTab(this.targetTabId, 'hover', action.payload);
              break;
            case 'STORE':
              // Already handled by AIClient
              break;
            case 'PRINT':
              // Already handled earlier in this function
              break;
            case 'NAVIGATE':
              // Already handled earlier in this function
              break;
            case 'COMPLETE':
              this.updateExecutionState({
                status: 'idle',
                logs: [...this.executionState.logs, {
                  type: 'info',
                  message: 'Task completed successfully',
                  timestamp: new Date().toISOString()
                }]
              });
              break;
            case 'FAILED':
              this.updateExecutionState({
                status: 'error',
                error: action.payload?.reason || 'Task failed',
                logs: [...this.executionState.logs, {
                  type: 'error',
                  message: action.payload?.reason || 'Task failed',
                  timestamp: new Date().toISOString()
                }]
              });
              break;
            default:
              throw new Error(`Unsupported action type: ${action.type}`);
          }
          // If we get here, the action succeeded
          return;
        } catch (error) {
          attempts++;
          if (attempts === maxAttempts) {
            throw error;
          }
          
          // Wait before retrying and reinject content script
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            await this.reinjectContentScript();
          } catch (e) {
            console.warn('Failed to reinject content script:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error executing action:', error);
      throw error;
    }
  }

  private async reinjectContentScript(): Promise<void> {
    if (!this.targetTabId) return;
  
    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.targetTabId },
        files: ['content/content.js']
      });
      
      // Give the content script time to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Request initial page state
      await this.executeInTab(this.targetTabId, 'get_page_state', {});
    } catch (error) {
      console.warn('Error reinjecting content script:', error);
      throw error;
    }
  }

  private getActionDescription(action: AIAction): string {
    switch (action.type) {
      case 'NAVIGATE':
        return `Navigating to ${action.payload.url}`;
      case 'CLICK':
        return `Clicking element "${action.payload.selector}"`;
      case 'TYPE':
        return `Typing "${action.payload.text}" into "${action.payload.selector}"`;
      case 'SUBMIT':
        return `Submitting form "${action.payload.selector}"`;
      case 'SCROLL':
        return `Scrolling ${action.payload.direction} by ${action.payload.amount}px`;
      case 'HOVER':
        return `Hovering over element "${action.payload.selector}"`;
      case 'STORE':
        return `Storing ${action.payload.append ? 'additional ' : ''}data`;
      case 'PRINT':
        return 'Displaying information to user';
      case 'COMPLETE':
        return 'Task completed successfully';
      case 'FAILED':
        return `Task failed: ${action.payload?.reason || 'Unknown reason'}`;
      default:
        return JSON.stringify(action);
    }
  }
  
  private async handlePageStateUpdate(state: PageState) {
    this.lastPageState = state;
    console.log('Received page state update:', state);
    
    // Only proceed if we have an active task
    if (this.currentTask && this.executionState.status === 'running') {
      try {
        // Get next action from AI based on current state
        const response = await this.aiClient.getNextAction(
          this.currentTask.prompt,
          this.lastPageState
        );
  
        if (response.action) {
          // Update execution state with new action
          this.updateExecutionState({
            currentAction: response.action,
            logs: [
              ...this.executionState.logs,
              {
                type: 'info',
                message: `AI Response: ${response.reasoning}`,
                timestamp: new Date().toISOString()
              }
            ]
          });
  
          // Execute the next action
          await this.executeAction(response.action);
        } else if (response.completed) {
          this.updateExecutionState({
            status: 'idle',
            logs: [
              ...this.executionState.logs,
              {
                type: 'info',
                message: 'Task completed successfully',
                timestamp: new Date().toISOString()
              }
            ]
          });
          this.currentTask = null;
        }
      } catch (error) {
        console.error('Error processing page state update:', error);
        this.updateExecutionState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  private async navigate(url: string): Promise<void> {
    if (!this.targetTabId) {
      throw new Error('No target tab found');
    }
  
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Navigation timeout'));
      }, 10000); // Increased timeout
  
      // Wait for navigation to complete
      const onUpdatedListener = async (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === this.targetTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdatedListener);
          
          try {
            // Inject content script
            await chrome.scripting.executeScript({
              target: { tabId: this.targetTabId },
              files: ['content/content.js'] // Make sure this matches your build output
            });
  
            // Give the content script time to initialize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Request page state explicitly
            await this.executeInTab(this.targetTabId, 'get_page_state', {});
            
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        }
      };
  
      chrome.tabs.onUpdated.addListener(onUpdatedListener);
      
      // Start the navigation
      chrome.tabs.update(this.targetTabId, { url }, (tab) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          reject(chrome.runtime.lastError);
        }
      });
    });
  }

  private async executeInTab(tabId: number, action: string, payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Action timeout'));
      }, 5000);
  
      chrome.tabs.sendMessage(tabId, { type: action, payload }, response => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (!response?.success) {
          reject(new Error(response?.error || 'Action failed'));
        } else {
          resolve();
        }
      });
    });
  }

  private updateExecutionState(updates: Partial<ExecutionState>) {
    this.executionState = { 
      ...this.executionState, 
      ...updates,
      // Remove totalSteps since we're doing one action at a time
      totalSteps: 0
    };
    
    // Broadcast state update to all extension views
    chrome.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: this.executionState
    }).catch(error => {
      console.warn('Failed to broadcast state update:', error);
    });
  }

  private stopExecution() {
    this.currentTask = null;
    this.executionState = {
      status: 'idle',
      currentStep: 0,
      totalSteps: 0,
      logs: [
        ...this.executionState.logs,
        {
          type: 'info',
          message: 'Task execution stopped by user',
          timestamp: new Date().toISOString(),
        },
      ],
    };
    this.lastPageState = null;
  }
}

// Initialize the background service
const backgroundService = new BackgroundService();