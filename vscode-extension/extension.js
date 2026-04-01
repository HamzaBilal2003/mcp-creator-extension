// DOM Scraper MCP Runner — VS Code Extension
// Listens to MCP SSE stream → feeds data+command into Copilot Chat → notifies Chrome

const vscode = require('vscode');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

let statusBarItem;
let sseRequest = null;
let isListening = false;
let outputChannel;
let lastTaskFile = null;

// ── Activate ──────────────────────────────────────────────────────────────────

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('MCP Runner');
  log('DOM Scraper MCP Runner activated');

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'domScraperMcp.start';
  setStatus('idle');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('domScraperMcp.start', () => startListening(context)),
    vscode.commands.registerCommand('domScraperMcp.stop', () => stopListening()),
    vscode.commands.registerCommand('domScraperMcp.showLastTask', () => openLastTaskFile()),
  );

  // Auto-start if configured
  const config = vscode.workspace.getConfiguration('domScraperMcp');
  if (config.get('autoStart')) {
    startListening(context);
  }
}

function deactivate() {
  stopListening();
}

// ── Status bar helpers ────────────────────────────────────────────────────────

function setStatus(state) {
  const states = {
    idle:       { text: '$(radio-tower) MCP: Idle',       tooltip: 'Click to start MCP listener',  bg: undefined },
    listening:  { text: '$(sync~spin) MCP: Listening',    tooltip: 'Receiving MCP data events',    bg: new vscode.ThemeColor('statusBarItem.warningBackground') },
    working:    { text: '$(loading~spin) MCP: Running…',  tooltip: 'Copilot task in progress',     bg: new vscode.ThemeColor('statusBarItem.prominentBackground') },
    done:       { text: '$(check) MCP: Done ✓',           tooltip: 'Last task completed',          bg: undefined },
    error:      { text: '$(error) MCP: Error',            tooltip: 'Connection error — click to retry', bg: new vscode.ThemeColor('statusBarItem.errorBackground') },
  };
  const s = states[state] || states.idle;
  statusBarItem.text = s.text;
  statusBarItem.tooltip = s.tooltip;
  statusBarItem.backgroundColor = s.bg;
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toTimeString().split(' ')[0];
  outputChannel.appendLine(`[${ts}] ${msg}`);
  console.log(`[MCP Runner] ${msg}`);
}

// ── SSE connection ─────────────────────────────────────────────────────────────

function startListening(context) {
  if (isListening) { log('Already listening'); return; }

  const config = vscode.workspace.getConfiguration('domScraperMcp');
  const serverUrl = config.get('serverUrl') || 'http://localhost:3000';

  log(`Connecting to ${serverUrl}/events ...`);
  setStatus('listening');

  const url = new URL(`${serverUrl}/events`);
  const lib = url.protocol === 'https:' ? https : http;

  const req = lib.get(url.toString(), {
    headers: { Accept: 'text/event-stream' }
  }, (res) => {
    if (res.statusCode !== 200) {
      log(`SSE connection failed: HTTP ${res.statusCode}`);
      setStatus('error');
      scheduleReconnect(context);
      return;
    }

    isListening = true;
    vscode.window.setStatusBarMessage('$(sync~spin) MCP Runner connected', 3000);
    log('SSE stream connected');

    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep incomplete last part

      for (const block of parts) {
        parseSSEBlock(block, serverUrl);
      }
    });

    res.on('end', () => {
      log('SSE stream closed — reconnecting in 5s...');
      isListening = false;
      setStatus('error');
      scheduleReconnect(context);
    });

    res.on('error', (err) => {
      log(`SSE stream error: ${err.message}`);
      isListening = false;
      setStatus('error');
      scheduleReconnect(context);
    });
  });

  req.on('error', (err) => {
    log(`Cannot reach MCP server: ${err.message}`);
    setStatus('error');
    scheduleReconnect(context);
  });

  sseRequest = req;
}

function stopListening() {
  if (sseRequest) {
    sseRequest.destroy();
    sseRequest = null;
  }
  isListening = false;
  setStatus('idle');
  log('Stopped listening');
}

let reconnectTimer = null;
function scheduleReconnect(context) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    log('Attempting reconnect...');
    startListening(context);
  }, 5000);
}

// ── SSE event parser ──────────────────────────────────────────────────────────

function parseSSEBlock(block) {
  const lines = block.split('\n');
  let eventName = 'message';
  let dataStr = '';

  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    if (line.startsWith('data:')) dataStr = line.slice(5).trim();
  }

  if (!dataStr || eventName === 'message') return; // heartbeat / no data

  try {
    const payload = JSON.parse(dataStr);
    if (eventName === 'data-update') {
      handleDataUpdate(payload);
    } else if (eventName === 'connected') {
      log(`Connected — server has ${payload.dataCount} items stored`);
    }
  } catch (e) {
    log(`Failed to parse SSE payload: ${e.message}`);
  }
}

// ── Handle incoming data + command ────────────────────────────────────────────

async function handleDataUpdate(payload) {
  const { data, command, count, timestamp } = payload;

  log(`📥 Data update received: ${count} items at ${timestamp}`);

  if (!command || command.trim() === '') {
    log('No Copilot command set — skipping auto task (set one in the Chrome extension popup)');
    return;
  }

  setStatus('working');

  // 1. Write a task file to the workspace root with the data + command
  const taskContent = buildTaskFile(command, data, timestamp);
  const taskFilePath = await writeTaskFile(taskContent);
  lastTaskFile = taskFilePath;

  // 2. Build the full Copilot chat message
  const chatQuery = buildCopilotQuery(command, data);

  // 3. Open Copilot Chat with the pre-filled command
  const config = vscode.workspace.getConfiguration('domScraperMcp');
  const openChat = config.get('openCopilotChat');

  if (openChat) {
    try {
      // Open the task file first so user sees what was scraped
      const doc = await vscode.workspace.openTextDocument(taskFilePath);
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });

      // Open Copilot Chat with the generated query
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: chatQuery });

      log('🤖 Copilot Chat opened with task command');
    } catch (err) {
      log(`Could not open Copilot Chat automatically: ${err.message}`);
      log('Hint: Task file written to workspace — open it and paste into Copilot Chat');
      // Still open the task file
      try {
        const doc = await vscode.workspace.openTextDocument(taskFilePath);
        await vscode.window.showTextDocument(doc);
      } catch (_) {}
    }
  }

  // 4. Show notification in VS Code
  const action = await vscode.window.showInformationMessage(
    `🤖 MCP: New data received (${count} items). Copilot task started.`,
    'Show Task File',
    'Dismiss'
  );
  if (action === 'Show Task File') openLastTaskFile();

  // 5. Notify MCP server (which Chrome extension polls)
  await notifyMcpDone(
    `Copilot task started — ${count} items scraped`,
    `Command: ${command.substring(0, 100)}${command.length > 100 ? '…' : ''}`
  );

  setStatus('done');
  setTimeout(() => setStatus('listening'), 5000);
}

// ── Task file builder ─────────────────────────────────────────────────────────

function buildTaskFile(command, data, timestamp) {
  return `# MCP Copilot Task
> Generated: ${timestamp}
> Items scraped: ${data.length}

## Command
${command}

## Scraped Data (JSON)
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

---
*This file was auto-generated by DOM Scraper MCP Runner.*
*Copy the command above and paste it into GitHub Copilot Chat (@workspace).*
`;
}

async function writeTaskFile(content) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let dir;

  if (workspaceFolders && workspaceFolders.length > 0) {
    dir = workspaceFolders[0].uri.fsPath;
  } else {
    // Fallback: write next to the extension
    dir = path.join(require('os').homedir(), '.mcp-runner');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, '.copilot-task.md');
  fs.writeFileSync(filePath, content, 'utf8');
  log(`Task file written: ${filePath}`);
  return filePath;
}

function buildCopilotQuery(command, data) {
  const dataSnippet = JSON.stringify(data.slice(0, 5), null, 2); // first 5 items for brevity
  return `${command}

Here is the scraped data (${data.length} items total, showing first 5):
\`\`\`json
${dataSnippet}
\`\`\`
${data.length > 5 ? `\nThe full dataset is in \`.copilot-task.md\` in the workspace root.` : ''}`;
}

// ── Notify MCP server → Chrome extension polls this ──────────────────────────

async function notifyMcpDone(message, taskSummary) {
  const config = vscode.workspace.getConfiguration('domScraperMcp');
  const serverUrl = config.get('serverUrl') || 'http://localhost:3000';

  return new Promise((resolve) => {
    const body = JSON.stringify({ message, taskSummary });
    const url = new URL(`${serverUrl}/notify-done`);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/notify-done',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      log(`MCP notified (${res.statusCode})`);
      resolve();
    });

    req.on('error', (e) => {
      log(`Could not notify MCP: ${e.message}`);
      resolve();
    });

    req.write(body);
    req.end();
  });
}

// ── Open last task file ───────────────────────────────────────────────────────

async function openLastTaskFile() {
  if (!lastTaskFile || !fs.existsSync(lastTaskFile)) {
    vscode.window.showWarningMessage('No task file generated yet. Wait for MCP data to arrive.');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(lastTaskFile);
  await vscode.window.showTextDocument(doc);
}

module.exports = { activate, deactivate };
