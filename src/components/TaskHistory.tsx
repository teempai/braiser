import React from 'react';
import { CheckCircle, XCircle, Loader } from 'lucide-react';
import { ExecutionState } from '../types';

interface TaskHistoryProps {
  tasks: ExecutionState[];
}

export function TaskHistory({ tasks }: TaskHistoryProps) {
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatStartingMessage = (message: string) => {
    // Extract just the task text without AI Reasoning
    const taskText = message.replace('Starting task: ', '');
    const reasoningIndex = taskText.indexOf('AI Reasoning:');
    const cleanTaskText = reasoningIndex !== -1 
      ? taskText.substring(0, reasoningIndex).trim()
      : taskText.trim();
    return `Starting "${cleanTaskText}"`;
  };

  const formatFailedMessage = (message: string) => {
    try {
      const failedObj = JSON.parse(message);
      return failedObj.reason || 'Task failed';
    } catch {
      return message;
    }
  };

  return (
    <div className="space-y-4">
      {tasks.map((task, taskIndex) => {
        // Get all logs and filter out AI responses
        const actionLogs = task.logs
          .filter(log => 
            log.message && // Check if log.message exists
            !log.message.startsWith('AI Response:') &&
            !log.message.startsWith('AI Reasoning:')
          )
          .map(log => ({
            ...log,
            // Format start and failed messages
            message: log.message
              ? log.message.startsWith('Starting task:') 
                ? formatStartingMessage(log.message)
                : log.message.startsWith('{') && log.message.includes('"reason"')
                  ? formatFailedMessage(log.message)
                  : log.message
              : '' // Default to empty string if log.message is undefined
          }))
          .reverse(); // Reverse the logs array to show newest first

        return (
          <div key={taskIndex} className="space-y-2">
            {/* Actions */}
            {actionLogs.map((log, logIndex) => {
              const isError = log.type === 'error';
              const isProcessing = task.status === 'running' && logIndex === 0;
              const isStarting = log.message.startsWith('Starting "');

              return (
                <div 
                  key={logIndex}
                  className="bg-white border rounded-lg p-3 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    {isProcessing ? (
                      <Loader className="w-5 h-5 text-blue-500 animate-spin" />
                    ) : isError ? (
                      <XCircle className="w-5 h-5 text-red-500" />
                    ) : (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    )}
                    
                    <div className="flex-1">
                      <div className={`text-sm ${isStarting ? 'text-gray-500' : 'text-gray-600'}`}>
                        {log.message}
                      </div>
                      {log.type === 'error' && (
                        <div className="text-xs text-red-500 mt-1">{log.message}</div>
                      )}
                    </div>
                    
                    <div className="text-xs text-gray-400">
                      {formatTimestamp(log.timestamp)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}