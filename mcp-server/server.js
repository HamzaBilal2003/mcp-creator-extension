#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';

// Storage for scraped data
let scrapedDataStore = [];
let lastUpdate = null;

// MCP Server
const server = new Server(
  {
    name: 'dom-scraper-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_scraped_data',
        description: 'Get the latest scraped data from the Chrome extension',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'query_scraped_data',
        description: 'Query scraped data with filters',
        inputSchema: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field name to filter',
            },
            value: {
              type: 'string',
              description: 'Value to match',
            },
          },
        },
      },
      {
        name: 'get_data_stats',
        description: 'Get statistics about scraped data',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'get_scraped_data') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: scrapedDataStore,
            count: scrapedDataStore.length,
            lastUpdate: lastUpdate,
          }, null, 2),
        },
      ],
    };
  }

  if (name === 'query_scraped_data') {
    const { field, value } = args;
    const filtered = scrapedDataStore.filter(item => 
      item[field] && item[field].toString().toLowerCase().includes(value.toLowerCase())
    );
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: filtered,
            count: filtered.length,
          }, null, 2),
        },
      ],
    };
  }

  if (name === 'get_data_stats') {
    const fields = scrapedDataStore.length > 0 ? Object.keys(scrapedDataStore[0]) : [];
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            totalRecords: scrapedDataStore.length,
            fields: fields,
            lastUpdate: lastUpdate,
          }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start MCP server on stdio
async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

// HTTP API for Chrome extension
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'running', dataCount: scrapedDataStore.length });
});

app.post('/store-data', (req, res) => {
  scrapedDataStore = req.body.data || [];
  lastUpdate = new Date().toISOString();
  res.json({ success: true, count: scrapedDataStore.length });
});

app.get('/data', (req, res) => {
  res.json({ data: scrapedDataStore, lastUpdate });
});

const HTTP_PORT = 3000;
app.listen(HTTP_PORT, () => {
  console.error(`HTTP API running on http://localhost:${HTTP_PORT}`);
});

// Start MCP server
startMcpServer();
