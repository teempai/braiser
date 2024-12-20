import { AIClient } from '../services/ai-client';
import { AIResponse, ExecutionState, PageState, AIAction } from '../types';
import { StorageManager } from '../services/storage';

class BackgroundService {
  private aiClient: AIClient;
  private storage: StorageManager;
  private windowId: number | null = null;
  private targetTabId: number | null = null;
  private targetTabUrl: string | null = null;
  private _pageStateUpdateTimeout: number | null = null;
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
  private lastActionResult: { success: boolean; error?: string } = { success: true };
  private contentScriptReadyTabs: Set<number> = new Set();
  private errorCount: number = 0;
  private readonly MAX_ERRORS: number = 5; // Set your desired maximum number of errors

  constructor() {
    this.aiClient = new AIClient();
    this.storage = new StorageManager();
    this.initializeListeners();
  }

  private initializeListeners() {
    // Listener for the extension icon click
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
  
      // Handle CONTENT_SCRIPT_READY message
      if (message.type === 'CONTENT_SCRIPT_READY' && sender.tab?.id) {
        console.log(`Content script ready in tab ${sender.tab.id}`);
        this.contentScriptReadyTabs.add(sender.tab.id);
        sendResponse({ success: true });
        return; // Early return to avoid processing other message types
      }
  
      // Async function to handle other messages
      const handleMessage = async () => {
        try {
          switch (message.type) {
            case 'START_TASK':
              await this.handleNewTask(message.prompt);
              return { success: true };
              break;
              
            case 'PAGE_STATE_UPDATE':
              await this.handlePageStateUpdate(message.state);
              return { success: true };
              break;
              
            case 'EXECUTION_STOP':
              this.stopExecution();
              return { success: true };
              break;

            default:
              console.warn('Unknown message type:', message.type);
              sendResponse({ success: false, error: 'Unknown message type' });
          }
        } catch (error) {
          console.error('Error handling message:', error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          };
        }
      };
    
      // Handle the async response properly
      handleMessage().then(sendResponse);
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

  private async handleNewTask(prompt: string): Promise<void> {
    this.stopExecution(); // Stop any existing execution
  
    this.executionState = {
      status: 'running',
      currentStep: 0,
      totalSteps: 0,
      logs: []
    };
  
    this.currentTask = { prompt };
    this.errorCount = 0; // Reset error count when starting a new task
  
    await this.requestNextAction();
  }

  private async reinjectContentScript(): Promise<void> {
    if (!this.targetTabId) {
      throw new Error('No target tab found');
    }
  
    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.targetTabId },
        files: ['content/content.js']
      });
      console.log('Content script reinjected successfully');
    } catch (error) {
      console.error('Failed to reinject content script:', error);
      throw error;
    }
  }
  
  private async executeAction(action: AIAction): Promise<void> {
    if (!this.targetTabId) {
      throw new Error('No target tab found');
    }
  
    let success = false;
    let lastError: any = null;
  
    try {
      // Update execution state
      this.executionState.currentStep += 1;
      this.executionState.logs.push(`Executing action: ${action.type}`);
  
      await this.performAction(action);
  
      success = true;
      // Reset error count on success
      this.errorCount = 0;
    } catch (error) {
      console.error('Error executing action:', error);
      lastError = error;
      success = false;
  
      // Increment error count on failure
      this.errorCount += 1;
  
      // Check if error count exceeds maximum allowed
      if (this.errorCount >= this.MAX_ERRORS) {
        console.error('Maximum error limit reached. Stopping execution.');
  
        // Update execution state to indicate failure
        this.executionState.status = 'failed';
        this.executionState.logs.push('Task failed due to too many errors.');
  
        // Optionally, send a notification to the user or UI component
        // You can implement a method to update the UI if necessary
        // this.notifyTaskFailed('Task failed due to too many errors.');
  
        // Stop execution
        this.stopExecution();
        return;
      }
    }
  
    // Report the result back to the AI client
    this.lastActionResult = { success, error: lastError ? lastError.message : undefined };
  
    // Request next action from AI client if execution has not stopped
    if (this.executionState.status === 'running') {
      // Continue execution
      await this.requestNextAction();
    }
  }

  private async performAction(action: AIAction) {
    // Include the action execution logic here (similar to your existing code)
    // For example:
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
      case 'NAVIGATE':
        await this.navigate(action.payload.url);
        break;
      case 'PRINT':
        this.updateExecutionState({
          logs: [...this.executionState.logs, {
            type: 'info',
            message: action.payload.text,
            timestamp: new Date().toISOString()
          }]
        });
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
    }
  }

  private async requestNextAction(): Promise<void> {
    if (!this.currentTask) {
      console.warn('No current task.');
      return;
    }

    try {
      // Get next action from AI based on current state
      const response = await this.aiClient.getNextAction(
        this.currentTask.prompt,
        this.lastPageState,
        this.lastActionResult
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
      console.error('Error requesting next action:', error);
      // Handle error, possibly update execution state
    }
  }

  private async requestPageStateUpdate() {
    await this.executeInTab(this.targetTabId!, 'get_page_state', {});
  }
  
  private async handleActionFailure() {
    // Inform the AI client that the last action failed, allowing it to adjust
    const response = await this.aiClient.getNextAction(
      this.currentTask!.prompt,
      this.lastPageState,
      this.lastActionResult
    );
  
    // Proceed with handling the AI's response
    await this.handleAIResponse(response);
  }
  
  private async handleAIResponse(response: AIResponse) {
    if (response.action) {
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
    if (this._pageStateUpdateTimeout) {
      clearTimeout(this._pageStateUpdateTimeout);
    }
  
    this._pageStateUpdateTimeout = setTimeout(async () => {
      try {
        this.lastPageState = state;
        console.log('Received page state update:', state);
        
        // Only proceed if we have an active task
        if (this.currentTask && this.executionState.status === 'running') {
          // Get next action from AI based on current state
          const response = await this.aiClient.getNextAction(
            this.currentTask.prompt,
            this.lastPageState,
            this.lastActionResult
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
        }
      } catch (error) {
        console.error('Error processing page state update:', error);
      } finally {
        this._pageStateUpdateTimeout = null;
      }
    }, 500);
  }

  private async navigate(url: string): Promise<void> {
    if (!this.targetTabId) {
      throw new Error('No target tab found');
    }
  
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Navigation timeout'));
      }, 15000); // Increased timeout
  
      const onUpdatedListener = async (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === this.targetTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdatedListener);
          clearTimeout(timeout);
          try {
            // Wait for page to finish loading
            await new Promise(resolve => setTimeout(resolve, 2000)); // Adjust delay as needed
            await this.reinjectContentScript();
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      };
  
      chrome.tabs.onUpdated.addListener(onUpdatedListener);
  
      chrome.tabs.update(this.targetTabId, { url }, (tab) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          reject(chrome.runtime.lastError);
        }
      });
    });
  }

  private async executeInTab(tabId: number, action: string, payload: any): Promise<void> {
    if (!this.contentScriptReadyTabs.has(tabId)) {
      console.log(`Waiting for content script to be ready in tab ${tabId}`);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Content script did not become ready in time'));
        }, 5000);

        const interval = setInterval(() => {
          if (this.contentScriptReadyTabs.has(tabId)) {
            clearTimeout(timeout);
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }
    const sendMessage = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Action timeout'));
        }, 5000);
  
        chrome.tabs.sendMessage(tabId, { type: action, payload }, response => {
          clearTimeout(timeout);
  
          if (chrome.runtime.lastError) {
            // Check for specific error indicating missing content script
            if (chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
              console.warn('Content script not found in tab. Attempting to inject.');
              this.reinjectContentScript()
                .then(() => {
                  // Try sending the message again after re-injection
                  sendMessage().then(resolve).catch(reject);
                })
                .catch(err => {
                  reject(err);
                });
            } else {
              reject(chrome.runtime.lastError);
            }
          } else if (!response?.success) {
            reject(new Error(response?.error || 'Action failed'));
          } else {
            resolve();
          }
        });
      });
    };
  
    // Start by sending the message
    return sendMessage();
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
    this.executionState.status = 'idle';
    this.errorCount = 0; // Reset error count when stopping execution
  }
} 

// Initialize the background service
const backgroundService = new BackgroundService();