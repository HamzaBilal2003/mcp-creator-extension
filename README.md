# DOM Scraper MCP - Complete Automation Pipeline

This project contains three parts that work together to completely automate web scraping and code generation:
1. **Chrome Extension**: Scrapes data from web pages.
2. **MCP Server**: Acts as the central hub to receive data and broadcast tasks.
3. **VS Code Extension**: Listens for tasks from the server and auto-runs GitHub Copilot with your instructions.

---

## 🚀 Setup Guide (For a New Device)

Follow these steps exactly to set up the entire pipeline on a new machine.

### Part 1: Start the MCP Server
This server handles communication between your browser and VS Code.

1. Open a terminal and navigate to the `mcp-server` folder.
2. Install dependencies (only needed once):
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node server.js
   ```
*(Leave this terminal window open in the background!)*

### Part 2: Install the VS Code Extension
We have already packaged the extension into a `.vsix` file, meaning you **do not** need to build or compile anything on the new device!

1. Open a new terminal and navigate to the `vscode-extension` folder.
2. Run this exact command to install the extension into VS Code:
   ```bash
   code --install-extension dom-scraper-mcp-runner-1.0.0.vsix
   ```
3. **CRITICAL:** Fully close all VS Code windows and reopen VS Code to apply the installation.
4. Once VS Code restarts, look at the bottom right status bar. You should see `$(sync~spin) MCP: Listening`. This means VS Code is connected to your MCP server!

### Part 3: Install the Chrome Extension
1. Open Google Chrome.
2. Type `chrome://extensions/` into the URL bar.
3. Turn on **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** in the top left.
5. Select the main project folder (`mcp-creator-extension`).

---

## 🛠️ How to Use the Automation

Once everything is installed and your MCP server is running (`node server.js`), follow these steps:

1. **Pin the extension** in Chrome and click the puzzle icon to open the popup.
2. **Set your Schema**: Enter the JSON selector for the data you want to scrape and click **Save Schema**.
3. **Set your Copilot Command**: In the `🤖 Copilot Command Template` box, tell Copilot exactly what to do with the data. 
   - *Example:* `"Using the scraped data, please generate a React UI component and save it to the workspace."*
   - Click **Save & Send Command to MCP**.
4. **Turn on Automation**: Toggle the `⚡ Auto Scrape & Send` switch to **ON**.
5. **Browse!** Navigate to any page matching your schema. 
   - The Chrome extension will automatically scrape the data.
   - It sends the data to the MCP server.
   - VS Code will instantly pop open the GitHub Copilot Chat window with your data and command pre-filled!
6. **Press Enter** in Copilot Chat to execute the task.
7. Once Copilot finishes, you will receive a Desktop Notification letting you know to check the results.

---

## ⚙️ VS Code Commands & Settings

You can always control the VS Code extension manually. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and type `MCP Runner`:

| Command | Description |
|---|---|
| `MCP Runner: Start Listening` | Connect to the MCP server manually |
| `MCP Runner: Stop Listening` | Disconnect from the MCP server |
| `MCP Runner: Show Last Task File` | Open the `.copilot-task.md` file from your last scrape |

### Status Bar Indicators (Bottom Right)
| Icon | Meaning |
|---|---|
| `$(radio-tower) MCP: Idle` | Not connected |
| `$(sync~spin) MCP: Listening` | Connected, waiting for data |
| `$(loading~spin) MCP: Running…` | Copilot task in progress |
| `$(check) MCP: Done ✓` | Last task completed |
| `$(error) MCP: Error` | Connection error (auto-retries in 5s, check if the server is running!) |

### Failsafe Task File
Every time new data arrives, the extension automatically writes a `.copilot-task.md` file to the root directory of your workspace. If Copilot Chat ever fails to open automatically, you can open this file and just copy-paste the pre-formatted request into your chat!
