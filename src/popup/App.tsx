import React, { useState, useEffect, useRef } from 'react';
import { Settings, Play, Pause, StopCircle, AlertCircle, Loader } from 'lucide-react';
import { ExecutionState } from '../types';
import { SettingsForm } from '../components/SettingsForm';
import { TaskHistory } from '../components/TaskHistory';

function App() {
  const [prompt, setPrompt] = useState('');
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    currentStep: 0,
    totalSteps: 0,
    logs: []
  });
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ExecutionState[]>([]);
  const taskHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for state updates from background script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATE') {
        setExecutionState(message.state);
        
        // If this is a new task or status change, update tasks
        if (message.state.logs?.length > 0) {
          setTasks(prevTasks => {
            // Check if this is a new task
            const isNewTask = prevTasks.length === 0 || 
              prevTasks[0].logs[0]?.timestamp !== message.state.logs[0]?.timestamp;

            if (isNewTask) {
              // Add new task to the beginning of the list
              return [message.state, ...prevTasks];
            } else {
              // Update the most recent task
              return [message.state, ...prevTasks.slice(1)];
            }
          });

          // Scroll to top for new tasks
          if (taskHistoryRef.current) {
            taskHistoryRef.current.scrollTop = 0;
          }
        }

        if (message.state.error) {
          setError(message.state.error);
        }
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await chrome.runtime.sendMessage({ 
        type: 'START_TASK', 
        prompt 
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start task');
    }
  };

  const handleControl = (action: 'resume' | 'stop') => {
    chrome.runtime.sendMessage({ type: `EXECUTION_${action.toUpperCase()}` });
  };

  return (
    <div className="w-[400px] h-full flex flex-col bg-white">
      <div className="flex-none p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Braiser v0.1</h1>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded hover:bg-gray-100"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {showSettings ? (
          <SettingsForm onClose={() => setShowSettings(false)} />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                What would you like the AI to do?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="e.g., 'Go to example.com and fill out the contact form' or 'Find the best price for a product on Google'"
                className="w-full h-24 p-2 border rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex space-x-2">
              <button
                type="submit"
                disabled={executionState.status === 'running' || !prompt.trim()}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start
              </button>
              {executionState.status === 'running' && (
                <button
                  type="button"
                  onClick={() => handleControl('stop')}
                  className="p-2 rounded hover:bg-gray-100"
                  title="Stop"
                >
                  <StopCircle className="w-5 h-5" />
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Task History Section - Modified for better scrolling */}
      <div 
        ref={taskHistoryRef}
        className="flex-1 overflow-y-auto bg-gray-50"
      >
        <div className="p-4 space-y-4">
          {tasks.map((task, index) => (
            <TaskHistory key={index} tasks={[task]} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;