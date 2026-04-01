chrome.runtime.onInstalled.addListener(() => {
  console.log('[DOM Scraper MCP] extension installed v1.1');
});

// ── Scrape + send logic (runs in background when content.js triggers) ─────────

async function scrapeTab(tabId, schema) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
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
    args: [schema]
  });
  return results[0].result;
}

async function postToMcp(endpoint, body) {
  return fetch(`http://localhost:3000${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ── Listen for page-change messages from content.js ───────────────────────────

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action !== 'pageChanged') return;

  chrome.storage.local.get(['autoScrapeEnabled', 'scrapingSchema', 'copilotCommand'], async (result) => {
    if (!result.autoScrapeEnabled) return;
    if (!result.scrapingSchema) return;

    const tabId = sender.tab?.id;
    if (!tabId) return;

    try {
      const data = await scrapeTab(tabId, result.scrapingSchema);
      if (!data || data.length === 0) return;

      chrome.storage.local.set({ latestScrapedData: data });

      // Send data to MCP (this will also broadcast SSE to VS Code)
      const res = await postToMcp('/store-data', { data });
      const ok = res.ok;

      console.log(`[DOM Scraper MCP] Auto sent ${data.length} items — ${ok ? 'OK ✓' : 'MCP not responding'}`);

      // Also ensure the command template is up-to-date on the MCP server
      if (result.copilotCommand) {
        await postToMcp('/set-command', { command: result.copilotCommand });
      }
    } catch (err) {
      console.error('[DOM Scraper MCP] Auto scrape error:', err);
    }
  });
});

// ── Notification polling — check MCP every 4 seconds ─────────────────────────

async function checkForNotification() {
  try {
    const res = await fetch('http://localhost:3000/check-notification');
    if (!res.ok) return;

    const { pending, notification } = await res.json();
    if (!pending || !notification) return;

    // Show desktop notification
    chrome.notifications.create(`mcp-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icon.png',
      title: '✅ Copilot Task Complete',
      message: notification.message || 'Copilot finished — check VS Code for changes',
      contextMessage: notification.taskSummary || '',
      priority: 2,
      requireInteraction: true,
    });

    // Clear the notification from MCP so we don't show it again
    await postToMcp('/clear-notification', {});

    console.log('[DOM Scraper MCP] Notification shown:', notification.message);
  } catch {
    // MCP server not running — silently ignore
  }
}

// Poll every 4 seconds
setInterval(checkForNotification, 4000);

// Initial check on startup
checkForNotification();
