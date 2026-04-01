chrome.runtime.onInstalled.addListener(() => {
  console.log('[DOM Scraper MCP] extension installed');
});

// ── Scrape + send logic (mirror of popup.js, runs in background) ─────────────

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
          if (baseAttr === 'text' || !baseAttr) {
            val = el.textContent ? el.textContent.trim() : null;
          } else if (baseAttr === 'html') {
            val = el.innerHTML;
          } else {
            val = el.getAttribute(baseAttr);
          }
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
            if (attr === 'text') {
              item[key] = field.textContent ? field.textContent.trim() : null;
            } else if (attr === 'html') {
              item[key] = field.innerHTML;
            } else {
              item[key] = field.getAttribute(attr);
            }
          } else {
            item[key] = null;
          }
        }
        items.push(item);
      });

      return items;
    },
    args: [schema]
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

// ── Listen for page-change messages from content.js ──────────────────────────

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action !== 'pageChanged') return;

  // Check if auto-scrape is enabled
  chrome.storage.local.get(['autoScrapeEnabled', 'scrapingSchema'], async (result) => {
    if (!result.autoScrapeEnabled) return;
    if (!result.scrapingSchema) return;

    const tabId = sender.tab?.id;
    if (!tabId) return;

    try {
      const data = await scrapeTab(tabId, result.scrapingSchema);
      if (!data || data.length === 0) return;

      chrome.storage.local.set({ latestScrapedData: data });
      const ok = await sendToMcp(data);
      console.log(
        `[DOM Scraper MCP] Auto sent ${data.length} items — ${ok ? 'OK' : 'MCP not responding'}`
      );
    } catch (err) {
      console.error('[DOM Scraper MCP] Auto scrape error:', err);
    }
  });
});
