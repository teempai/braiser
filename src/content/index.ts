import { PageState } from '../types';
import { DOMExtractor } from '../services/dom-extractor';

class ContentScript {
  private domExtractor: DOMExtractor;
  private debounceTimeout: number | undefined;
  private lastStateHash: string | null = null;
  private isInitialStateSet = false;

  constructor() {
    this.domExtractor = new DOMExtractor();
    this.initializeListeners();
    this.sendInitialState();
  }

  private initializeListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message);
  
      const processMessage = async () => {
        try {
          let success = false;
          
          switch (message.type.toLowerCase()) {
            case 'get_page_state':
              await this.sendPageState();
              success = true;
              break;
            case 'click':
              await handleClick(message.payload);
              success = true;
              break;
            case 'type':
              await handleType(message.payload);
              success = true;
              break;
            case 'submit':
              await handleSubmit(message.payload);
              success = true;
              break;
            case 'scroll':
              await handleScroll(message.payload);
              success = true;
              break;
            case 'hover':
              await handleHover(message.payload);
              success = true;
              break;  
            default:
              throw new Error(`Unknown action type: ${message.type}`);
          }
  
          if (success) {
            // Wait a moment for any DOM updates to settle
            await new Promise(resolve => setTimeout(resolve, 100));
            await this.sendPageState();
            sendResponse({ success: true });
          }
        } catch (error) {
          console.error('Error processing message:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      };
  
      processMessage().then(() => {
        // Ensure sendResponse is called
        // This is already handled in your existing code
      }).catch(error => {
        console.error('Error in content script:', error);
        sendResponse({ success: false, error: error.message });
      });
      
      return true; // Will respond asynchronously
    });
  
    // Listen for DOM changes
    const observer = new MutationObserver(this.handleDOMChanges.bind(this));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['value', 'checked', 'selected', 'disabled'] // Only observe relevant attributes
    });
  }
  
  private async sendInitialState() {
    // Wait for page to be fully loaded
    if (document.readyState !== 'complete') {
      await new Promise(resolve => {
        window.addEventListener('load', resolve, { once: true });
      });
    }
    
    // Add a small delay to ensure dynamic content is loaded
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Try multiple times to send initial state
    for (let i = 0; i < 3; i++) {
      try {
        await this.sendPageState();
        console.log('Initial page state sent successfully');
        break;
      } catch (error) {
        console.warn(`Attempt ${i + 1} to send initial state failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  private async sendPageState() {
    try {
      const state: PageState = {
        url: window.location.href,
        title: document.title,
        elements: this.domExtractor.extractElements(),
        timestamp: Date.now()
      };

      // Create a simple hash of the state to check for meaningful changes
      const stateHash = this.hashState(state);
      
      // Only send if it's the initial state or if there's a meaningful change
      if (!this.isInitialStateSet || stateHash !== this.lastStateHash) {
        console.log('Sending page state update:', {
          url: state.url,
          elementCount: state.elements.length
        });
        
        this.lastStateHash = stateHash;
        this.isInitialStateSet = true;

        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'PAGE_STATE_UPDATE', state },
            response => {
              if (chrome.runtime.lastError) {
                console.error('Error sending page state:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            }
          );
        });
      }
    } catch (error) {
      console.error('Error preparing page state:', error);
      throw error;
    }
  }

  private handleDOMChanges(mutations: MutationRecord[]) {
    // Filter out non-significant mutations
    const significantChange = mutations.some(mutation => {
      // Consider page load related changes as significant
      if (!this.isInitialStateSet) {
        return true;
      }

      // Regular mutation filtering logic
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        return false;
      }
      
      if (mutation.target instanceof Element && this.domExtractor.isHidden(mutation.target)) {
        return false;
      }

      if (mutation.target instanceof HTMLInputElement) {
        return mutation.type === 'attributes' && mutation.attributeName === 'value';
      }

      return (
        mutation.type === 'childList' ||
        mutation.type === 'characterData' ||
        (mutation.type === 'attributes' && 
         ['checked', 'selected', 'disabled', 'href'].includes(mutation.attributeName || ''))
      );
    });

    if (significantChange) {
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }
      this.debounceTimeout = setTimeout(() => this.sendPageState(), 500) as unknown as number;
    }
  }

  private hashState(state: PageState): string {
    // Create a simplified version of the state for comparison
    const simplifiedState = {
      url: state.url,
      title: state.title,
      elementCount: state.elements.length,
      visibleElements: state.elements
        .filter(el => el.isVisible)
        .map(el => `${el.type}:${el.path}:${el.text}`)
        .join('|')
    };
    return JSON.stringify(simplifiedState);
  }
}

async function waitForSelector(selector: string, timeout = 5000): Promise<Element> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Element with selector "${selector}" not found after ${timeout}ms`);
}

async function handleClick(payload: { selector: string }) {
  const element = await waitForSelector(payload.selector);
  if (element instanceof HTMLElement) {
    element.click();
    console.log(`Clicked element with selector: ${payload.selector}`);
  } else {
    throw new Error(`Element found for selector "${payload.selector}" is not a clickable element`);
  }
}

async function handleType(payload: { selector: string; text: string }) {
  const element = (await waitForSelector(payload.selector)) as HTMLInputElement;
  if (element) {
    console.log(`Found element for typing with selector: ${payload.selector}`);
    element.focus();

    // Clear any existing value
    element.value = '';

    // Simulate typing character by character
    for (const char of payload.text) {
      const eventInit: KeyboardEventInit = {
        key: char,
        code: char,
        bubbles: true,
        cancelable: true,
      };

      element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      element.value += char;
      element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50)); // Slight delay between keystrokes
    }

    // Dispatch change event at the end
    element.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`Typed text into element with selector: ${payload.selector}`);
  } else {
    throw new Error(`Element with selector "${payload.selector}" is not an input element`);
  }
}

async function handleSubmit(payload: { selector: string }) {
  const element = await waitForSelector(payload.selector);
  if (element instanceof HTMLFormElement) {
    element.submit();
    console.log(`Submitted form with selector: ${payload.selector}`);
  } else if (element instanceof HTMLElement) {
    element.click();
    console.log(`Clicked element to submit with selector: ${payload.selector}`);
  } else {
    throw new Error(`Element with selector "${payload.selector}" is not a valid form or clickable element`);
  }
}

async function handleScroll(payload: { direction: "up" | "down", amount: number }) {
  const currentScroll = window.scrollY;
  const scrollAmount = payload.direction === "down" ? payload.amount : -payload.amount;
  
  window.scrollTo({
    top: currentScroll + scrollAmount,
    behavior: 'smooth'
  });
  
  // Wait for scroll to complete
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function handleHover(payload: { selector: string }) {
  const element = await waitForSelector(payload.selector);
  if (element instanceof HTMLElement) {
    // Simulate both mouseenter and mouseover events
    element.dispatchEvent(new MouseEvent('mouseenter', { 
      bubbles: true,
      cancelable: true,
      view: window
    }));
    
    element.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      view: window
    }));

    // Wait a moment for any dropdown to appear
    await new Promise(resolve => setTimeout(resolve, 300));
    
    console.log(`Hovered over element with selector: ${payload.selector}`);
  } else {
    throw new Error(`Element with selector "${payload.selector}" is not a hoverable element`);
  }
}

// Initialize content script using an IIFE
(async () => {
  console.log('Content script initializing...');
  const contentScript = new ContentScript();

  // Notify background script that content script is ready
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
})();