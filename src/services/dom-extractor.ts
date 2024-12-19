import { PageElement } from '../types';

export class DOMExtractor {
  private isInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const buffer = 200; // 200px buffer above and below viewport
    return (
      rect.top >= -buffer &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight + buffer) &&
      rect.right <= window.innerWidth
    );
  }

  public extractElements(): PageElement[] {
    const elements: PageElement[] = [];
    const allElements = document.querySelectorAll('*');

    for (const element of allElements) {
      // Skip hidden elements
      if (this.isHidden(element)) {
        continue;
      }

      // Skip script and style elements
      if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) {
        continue;
      }

      // Only include elements in viewport or interactive elements
      const isInteractive = this.isInteractiveElement(element);
      const visibleText = this.getVisibleText(element);
      
      if ((isInteractive || visibleText) && (this.isInViewport(element) || isInteractive)) {
        elements.push(this.extractElementInfo(element));
      }
    }

    // Add scroll position information
    elements.push({
      type: 'scroll-position',
      text: `Page scrolled ${window.scrollY}px from top`,
      attributes: {},
      isVisible: true,
      path: 'window',
      isInteractive: false
    });

    return elements;
  }

  private isInteractiveElement(element: Element): boolean {
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'form'];
    const isClickable = element.hasAttribute('onclick') || 
                       element.getAttribute('role') === 'button';
    const isHoverable = window.getComputedStyle(element).cursor === 'pointer' ||
                       element.matches(':hover ~ *[style*="display: block"]') ||  // Detect if hovering shows elements
                       element.hasAttribute('onmouseover') ||
                       element.hasAttribute('onmouseenter');
    
    return interactiveTags.includes(element.tagName.toLowerCase()) || isClickable || isHoverable;
  }

  private extractElementInfo(element: Element): PageElement {
    const isInteractive = this.isInteractiveElement(element);
    const isForm = element instanceof HTMLFormElement;
    
    return {
      type: element.tagName.toLowerCase(),
      text: this.getVisibleText(element),
      attributes: isInteractive || isForm ? this.getRelevantAttributes(element) : {},
      isVisible: true,
      path: this.generateSelector(element),
      isInteractive,
      value: this.getElementValue(element),
      formState: isForm ? this.getFormState(element) : undefined
    };
  }

  private getFormState(form: HTMLFormElement): Record<string, any> {
    const formData: Record<string, any> = {};
    const inputs = form.querySelectorAll('input, textarea, select');
    
    inputs.forEach(input => {
      if (input instanceof HTMLInputElement || 
          input instanceof HTMLTextAreaElement || 
          input instanceof HTMLSelectElement) {
        formData[input.name || input.id || input.type] = input.value;
      }
    });
    
    return {
      isSubmitted: false,  // Forms start unsubmitted
      pendingInputs: formData
    };
  }

  private getElementValue(element: Element): string | undefined {
    if (element instanceof HTMLInputElement) {
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    return undefined;
  }

  private getVisibleText(element: Element): string {
    let text = '';

    // For interactive elements, prioritize accessible names and values
    if (this.isInteractiveElement(element)) {
      const value = this.getElementValue(element);
      text = element.getAttribute('aria-label') ||
             element.getAttribute('title') ||
             element.getAttribute('placeholder') ||
             value || // Include current value
             '';
    }

    // If no accessible name or value found, use text content
    if (!text) {
      text = element.textContent?.trim() || '';
    }

    // Limit text length and remove extra whitespace
    return text.slice(0, 150).replace(/\s+/g, ' ');
  }

  private getRelevantAttributes(element: Element): Record<string, string> {
    const relevantAttrs = [
      'type',     // For inputs
      'href',     // For links
      'role',     // For ARIA
      'aria-label', // For accessibility
      'placeholder', // For inputs
      'value'     // Add value attribute
    ];

    const attributes: Record<string, string> = {};
    for (const attr of relevantAttrs) {
      const value = element.getAttribute(attr);
      if (value) attributes[attr] = value;
    }

    // Add current value for input elements
    if (element instanceof HTMLInputElement) {
      attributes['currentValue'] = element.value;
    }

    return attributes;
  }

  private isHidden(element: Element): boolean {
    const style = window.getComputedStyle(element);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true'
    );
  }

  private generateSelector(element: Element): string {
    // Simplified selector generation focusing on common attributes
    if (element.id) {
      return `#${element.id}`;
    }

    // For inputs, include type
    if (element instanceof HTMLInputElement && element.type) {
      return `input[type="${element.type}"]`;
    }

    // Basic path with tag and nth-child
    let current = element;
    let selector = element.tagName.toLowerCase();
    
    while (current.parentElement && current !== document.body) {
      const parent = current.parentElement;
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(current as Element) + 1;
      selector = `${current.tagName.toLowerCase()}:nth-child(${index})`;
      current = parent;
    }

    return selector;
  }
}