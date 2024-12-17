export class StorageManager {
  async logTask(prompt: string, response: any) {
    const logs = await this.getLogs();
    logs.push({
      timestamp: Date.now(),
      prompt,
      response,
    });
    
    await chrome.storage.local.set({ taskLogs: logs });
  }

  async getLogs() {
    const data = await chrome.storage.local.get('taskLogs');
    return data.taskLogs || [];
  }

  async clearLogs() {
    await chrome.storage.local.remove('taskLogs');
  }

  async saveSettings(settings: any) {
    await chrome.storage.local.set({ settings });
  }

  async getSettings() {
    const data = await chrome.storage.local.get('settings');
    return data.settings;
  }
}