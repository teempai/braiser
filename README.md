# Braiser
AI-based browser automation tool

A Chrome extension that uses AI to automate web browsing tasks. You give an instruction and the AI attempts to complete your task autonomously by controlling a browser tab. Built with the help of o1 and Claude 3.5.

Status: Working but lots of known and unkown bugs.

## Features

- 🤖 AI-powered web automation
- 🎯 Natural language task descriptions
- ⚡ Real-time DOM interaction
- 📝 Detailed task execution logs 
- ⚙️ Configurable AI providers (only openai implemented)

## Installation

1. Clone the repository:

```
bash
git clone https://github.com/teempai/braiser.git
cd braiser
```

2. Install dependencies:

```
bash
npm i
```

3. Build the extension

```
bash
npm run build:extension
```

4. Load the extension in Chrome:
   
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` directory from the project
  
## Architecture

- `src/background`: Background service worker for extension orchestration
- `src/content`: Content script for DOM interaction
- `src/popup`: Extension popup UI
- `src/services`: Core services including AI client and DOM extraction
- `src/components`: Reusable React components
- `src/types`: TypeScript type definitions
