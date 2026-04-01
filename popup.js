let scrapedData = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function showResult(message, type) {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = message;
  resultDiv.className = type;
  resultDiv.style.display = 'block';
}

async function checkMcpStatus() {
  const statusDiv = document.getElementById('mcpStatus');
  try {
    const response = await fetch('http://localhost:3000/health');
    if (response.ok) {
      statusDiv.className = 'status running';
      statusDiv.innerHTML = '<span class="dot green"></span><span>MCP Server: Running</span>';
    } else throw new Error('not ok');
  } catch {
    statusDiv.className = 'status stopped';
    statusDiv.innerHTML = '<span class="dot red"></span><span>MCP Server: Stopped</span>';
  }
}

function setAutoBadge(enabled) {
  const badge = document.getElementById('autoBadge');
  badge.textContent = enabled ? 'ON' : 'OFF';
  badge.className = `auto-badge ${enabled ? 'on' : 'off'}`;
}

function setCommandBadge(hasSaved) {
  const badge = document.getElementById('commandStatus');
  badge.textContent = hasSaved ? 'saved ✓' : 'not set';
  badge.className = `cmd-badge ${hasSaved ? 'saved' : ''}`;
}

// ─── Scrape / Send helpers (shared by manual buttons & auto mode) ────────────

async function scrapeCurrentPage() {
  const stored = await chrome.storage.local.get('scrapingSchema');
  if (!stored.scrapingSchema) return null;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: (schema) => {
      const items = [];
      let baseSelector = schema.selector;
      let baseAttr = null;

      const baseAtIndex = schema.selector.lastIndexOf('@');
      if (baseAtIndex !== -1) {
        baseSelector = schema.selector.substring(0, baseAtIndex);
        baseAttr = schema.selector.substring(baseAtIndex + 1);
      }

      document.querySelectorAll(baseSelector).forEach(el => {
        if (!schema.fields || Object.keys(schema.fields).length === 0) {
          let val = null;
          if (baseAttr === 'text' || !baseAttr) val = el.textContent?.trim() ?? null;
          else if (baseAttr === 'html') val = el.innerHTML;
          else val = el.getAttribute(baseAttr);
          items.push({ extractedValue: val });
          return;
        }
        const item = {};
        for (const [key, rawSelector] of Object.entries(schema.fields)) {
          let cssSelector = rawSelector;
          let attr = 'text';
          const atIndex = rawSelector.lastIndexOf('@');
          if (atIndex !== -1) {
            cssSelector = rawSelector.substring(0, atIndex);
            attr = rawSelector.substring(atIndex + 1);
          }
          const field = cssSelector ? el.querySelector(cssSelector) : el;
          if (field) {
            if (attr === 'text') item[key] = field.textContent?.trim() ?? null;
            else if (attr === 'html') item[key] = field.innerHTML;
            else item[key] = field.getAttribute(attr);
          } else item[key] = null;
        }
        items.push(item);
      });

      return items;
    },
    args: [stored.scrapingSchema]
  });

  return results[0].result;
}

async function sendToMcp(data) {
  const response = await fetch('http://localhost:3000/store-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
  return response.ok;
}

async function sendCommandToMcp(command) {
  await fetch('http://localhost:3000/set-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  });
}

async function autoScrapeAndSend() {
  showResult('⚡ Auto scraping...', 'success');
  try {
    const data = await scrapeCurrentPage();
    if (!data) { showResult('Auto scrape: no schema saved', 'error'); return; }

    scrapedData = data;
    chrome.storage.local.set({ latestScrapedData: data });

    const ok = await sendToMcp(data);
    if (ok) {
      showResult(`⚡ Auto sent ${data.length} items to MCP ✓`, 'success');
      checkMcpStatus();
    } else {
      showResult('⚡ Auto send: MCP server not responding', 'error');
    }
  } catch (err) {
    showResult(`⚡ Auto scrape error: ${err.message}`, 'error');
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────

checkMcpStatus();

// Load saved schema
chrome.storage.local.get(['scrapingSchema'], (result) => {
  if (result.scrapingSchema) {
    document.getElementById('schemaInput').value = JSON.stringify(result.scrapingSchema, null, 2);
  }
});

// Load saved command template
chrome.storage.local.get(['copilotCommand'], (result) => {
  if (result.copilotCommand) {
    document.getElementById('commandInput').value = result.copilotCommand;
    setCommandBadge(true);
  }
});

// Load auto-scrape toggle state & run immediately if enabled
chrome.storage.local.get(['autoScrapeEnabled'], async (result) => {
  const enabled = !!result.autoScrapeEnabled;
  document.getElementById('autoScrapeToggle').checked = enabled;
  setAutoBadge(enabled);
  if (enabled) await autoScrapeAndSend();
});

// ─── Toggle ──────────────────────────────────────────────────────────────────

document.getElementById('autoScrapeToggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  chrome.storage.local.set({ autoScrapeEnabled: enabled });
  setAutoBadge(enabled);
  showResult(
    enabled ? '⚡ Auto scrape enabled — triggers on every page change' : 'Auto scrape disabled',
    enabled ? 'success' : 'error'
  );
});

// ─── Save Command Template ────────────────────────────────────────────────────

document.getElementById('saveCommand').addEventListener('click', async () => {
  const command = document.getElementById('commandInput').value.trim();
  if (!command) {
    showResult('Please enter a Copilot command first', 'error');
    return;
  }

  chrome.storage.local.set({ copilotCommand: command });
  setCommandBadge(true);

  try {
    await sendCommandToMcp(command);
    showResult('🤖 Command saved & sent to MCP server', 'success');
  } catch {
    showResult('🤖 Command saved locally (MCP not reachable)', 'error');
  }
});

// ─── Manual: Save Schema ─────────────────────────────────────────────────────

document.getElementById('saveSchema').addEventListener('click', () => {
  const schemaText = document.getElementById('schemaInput').value.trim();
  if (!schemaText) { showResult('Please provide a JSON schema object', 'error'); return; }
  try {
    const schema = JSON.parse(schemaText);
    if (!schema.selector) throw new Error('Schema must contain at least a "selector" property.');
    chrome.storage.local.set({ scrapingSchema: schema });
    chrome.storage.local.remove(['apiKey', 'htmlPrompt']);
    showResult('Schema saved successfully!', 'success');
  } catch (error) {
    showResult(`Invalid JSON format: ${error.message}`, 'error');
  }
});

// ─── Manual: Scrape ──────────────────────────────────────────────────────────

document.getElementById('scrapeData').addEventListener('click', async () => {
  showResult('Scraping page...', 'success');
  try {
    const data = await scrapeCurrentPage();
    if (!data) { showResult('Generate schema first', 'error'); return; }
    scrapedData = data;
    chrome.storage.local.set({ latestScrapedData: data });
    showResult(`Scraped ${data.length} items`, 'success');
  } catch (error) {
    showResult(`Error: ${error.message}`, 'error');
  }
});

// ─── Manual: Send to MCP ─────────────────────────────────────────────────────

document.getElementById('sendToMcp').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get('latestScrapedData');
  if (!stored.latestScrapedData || stored.latestScrapedData.length === 0) {
    showResult('No scraped data available', 'error');
    return;
  }
  showResult('Sending to MCP server...', 'success');
  try {
    const ok = await sendToMcp(stored.latestScrapedData);
    if (ok) { showResult('Data sent to MCP successfully!', 'success'); checkMcpStatus(); }
    else showResult('MCP server not responding', 'error');
  } catch {
    showResult('MCP server not running', 'error');
  }
});

// ─── Periodic MCP health check ────────────────────────────────────────────────
setInterval(checkMcpStatus, 5000);
