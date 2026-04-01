#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';

// ── Storage ──────────────────────────────────────────────────────────────────
let scrapedDataStore = [];
let lastUpdate = null;
let commandTemplate = '';          // Copilot command saved from popup
let pendingNotification = null;    // Set by VS Code when task is done

// ── SSE clients list ──────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(eventName, payload) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'dom-scraper-mcp', version: '1.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_scraped_data',
      description: 'Get the latest scraped data from the Chrome extension',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'query_scraped_data',
      description: 'Query scraped data with filters',
      inputSchema: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Field name to filter' },
          value: { type: 'string', description: 'Value to match' },
        },
      },
    },
    {
      name: 'get_data_stats',
      description: 'Get statistics about scraped data',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_command_template',
      description: 'Get the current Copilot command template set by the user',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'get_scraped_data') {
    return {
      content: [{ type: 'text', text: JSON.stringify({ data: scrapedDataStore, count: scrapedDataStore.length, lastUpdate }, null, 2) }],
    };
  }

  if (name === 'query_scraped_data') {
    const { field, value } = args;
    const filtered = scrapedDataStore.filter(
      item => item[field] && item[field].toString().toLowerCase().includes(value.toLowerCase())
    );
    return {
      content: [{ type: 'text', text: JSON.stringify({ data: filtered, count: filtered.length }, null, 2) }],
    };
  }

  if (name === 'get_data_stats') {
    const fields = scrapedDataStore.length > 0 ? Object.keys(scrapedDataStore[0]) : [];
    return {
      content: [{ type: 'text', text: JSON.stringify({ totalRecords: scrapedDataStore.length, fields, lastUpdate }, null, 2) }],
    };
  }

  if (name === 'get_command_template') {
    return {
      content: [{ type: 'text', text: JSON.stringify({ commandTemplate }, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

// ── Express HTTP API ──────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'running', dataCount: scrapedDataStore.length, hasCommand: !!commandTemplate });
});

// Store scraped data — also fires SSE event to VS Code
app.post('/store-data', (req, res) => {
  scrapedDataStore = req.body.data || [];
  lastUpdate = new Date().toISOString();

  // Broadcast to all VS Code SSE subscribers
  broadcastSSE('data-update', {
    data: scrapedDataStore,
    count: scrapedDataStore.length,
    command: commandTemplate,
    timestamp: lastUpdate,
  });

  res.json({ success: true, count: scrapedDataStore.length });
});

// Get all data
app.get('/data', (req, res) => {
  res.json({ data: scrapedDataStore, lastUpdate });
});

// Save copilot command template (sent from Chrome extension popup)
app.post('/set-command', (req, res) => {
  commandTemplate = req.body.command || '';
  console.error(`[MCP] Command template updated: ${commandTemplate.substring(0, 80)}...`);
  res.json({ success: true });
});

// Get current command template
app.get('/get-command', (req, res) => {
  res.json({ command: commandTemplate });
});

// ── SSE endpoint for VS Code extension ───────────────────────────────────────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send keep-alive ping every 20s
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 20000);

  // Send current state on connect
  res.write(`event: connected\ndata: ${JSON.stringify({ dataCount: scrapedDataStore.length, command: commandTemplate })}\n\n`);

  sseClients.add(res);
  console.error(`[MCP] VS Code SSE client connected (total: ${sseClients.size})`);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
    console.error(`[MCP] VS Code SSE client disconnected (total: ${sseClients.size})`);
  });
});

// ── Notification endpoints (VS Code → MCP → Chrome) ──────────────────────────

// VS Code calls this when Copilot task is done
app.post('/notify-done', (req, res) => {
  pendingNotification = {
    message: req.body.message || 'Copilot task completed',
    timestamp: new Date().toISOString(),
    taskSummary: req.body.taskSummary || '',
  };
  console.error('[MCP] Notification queued:', pendingNotification.message);
  res.json({ success: true });
});

// Chrome extension polls this to check if a notification is pending
app.get('/check-notification', (req, res) => {
  res.json({ pending: !!pendingNotification, notification: pendingNotification });
});

// Chrome extension clears notification after showing it
app.post('/clear-notification', (req, res) => {
  pendingNotification = null;
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const HTTP_PORT = 3000;
app.listen(HTTP_PORT, () => {
  console.error(`HTTP API running on http://localhost:${HTTP_PORT}`);
  console.error(`SSE stream available at http://localhost:${HTTP_PORT}/events`);
});

startMcpServer();
