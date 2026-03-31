# DOM Scraper MCP Extension

Chrome extension that scrapes DOM data using Gemini AI and provides it to VS Code Copilot via MCP server.

## Architecture

```
Chrome Extension → Gemini API (generate schema) → Scrape Page → MCP Server → VS Code Copilot
```

## Quick Start

### 1. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the root folder (containing `manifest.json`)
5. Extension icon appears in toolbar

### 2. Setup MCP Server

```bash
cd mcp-server
npm install
node server.js
```

Server runs on:
- **MCP**: stdio (for VS Code)
- **HTTP**: http://localhost:3000 (for extension)

### 3. Configure VS Code Copilot

#### For GitHub Copilot Chat:

Edit VS Code settings.json (`Cmd/Ctrl + Shift + P` → "Preferences: Open User Settings (JSON)"):

```json
{
  "github.copilot.chat.mcp.servers": {
    "dom-scraper": {
      "command": "node",
      "args": ["/FULL/PATH/TO/mcp-server/server.js"]
    }
  }
}
```

**Replace `/FULL/PATH/TO/` with actual absolute path**

Example:
- Windows: `"C:\\Users\\YourName\\dom-scraper-mcp\\mcp-server\\server.js"`
- Mac/Linux: `"/Users/yourname/dom-scraper-mcp/mcp-server/server.js"`

#### Verify Connection:

1. Open VS Code Copilot Chat
2. Type: `@workspace what MCP tools are available?`
3. Should see: `get_scraped_data`, `query_scraped_data`, `get_data_stats`

### 4. Usage Workflow

#### Step 1: Get Gemini API Key
1. Go to https://aistudio.google.com/app/apikey
2. Create free API key
3. Copy it

#### Step 2: Generate Schema
1. Navigate to target website
2. Click extension icon
3. Paste Gemini API key
4. Enter prompt: `"Extract all product cards with title, price, and image URL"`
5. Click "Generate Schema"

#### Step 3: Scrape Data
1. Click "Scrape Current Page"
2. Extension extracts data using generated schema
3. Click "Send to MCP Server"

#### Step 4: Use in Copilot
Open VS Code Copilot Chat and ask:

```
Get the scraped data and analyze it
```

```
What products have price over $50?
```

```
Create a summary table of all scraped items
```

## MCP Tools

### `get_scraped_data`
Returns all scraped data with metadata

### `query_scraped_data`
Filter data by field and value
```
{
  "field": "price",
  "value": "99"
}
```

### `get_data_stats`
Get statistics (count, fields, last update)

## Extension Features

- **Schema Generation**: AI-powered schema creation using Gemini
- **DOM Scraping**: Intelligent data extraction
- **Status Monitor**: Real-time MCP server status
- **LocalStorage**: Saves API key and schemas

## Troubleshooting

### Extension can't connect to MCP server
- Ensure server is running: `node mcp-server/server.js`
- Check http://localhost:3000/health in browser

### Copilot doesn't see MCP tools
- Verify absolute path in settings.json
- Restart VS Code
- Check Copilot Chat output for MCP connection errors

### Schema generation fails
- Verify Gemini API key is valid
- Check browser console for errors
- Ensure page HTML is accessible

### No data scraped
- Verify schema selectors match page structure
- Check browser console
- Try regenerating schema with better prompt

## Example Prompts for Schema Generation

```
Extract all article titles, dates, and author names
```

```
Find product cards with name, price, rating, and availability
```

```
Get all table rows with company name, stock price, and change
```

```
Scrape job listings with title, company, location, and salary
```

## Files Structure

```
dom-scraper-mcp/
├── manifest.json          # Extension config
├── popup.html            # Extension UI
├── popup.js              # Extension logic
├── background.js         # Service worker
├── content.js            # DOM access
├── icon.png              # Extension icon
└── mcp-server/
    ├── package.json      # Node dependencies
    └── server.js         # MCP + HTTP server
```

## Development

### Add Custom Tools

Edit `mcp-server/server.js`, add to `ListToolsRequestSchema` and `CallToolRequestSchema` handlers.

### Modify UI

Edit `popup.html` and `popup.js` for extension interface changes.

## License

MIT
