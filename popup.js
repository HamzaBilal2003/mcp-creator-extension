let scrapedData = null;

// Check MCP server status on load
checkMcpStatus();

// Load saved data
chrome.storage.local.get(['scrapingSchema'], (result) => {
  if (result.scrapingSchema) {
    document.getElementById('schemaInput').value = JSON.stringify(result.scrapingSchema, null, 2);
  }
});

// Save direct JSON schema
document.getElementById('saveSchema').addEventListener('click', () => {
  const schemaText = document.getElementById('schemaInput').value.trim();

  if (!schemaText) {
    showResult('Please provide a JSON schema object', 'error');
    return;
  }

  try {
    const schema = JSON.parse(schemaText);
    
    // Basic validation
    if (!schema.selector) {
      throw new Error('Schema must contain at least a "selector" property.');
    }

    // Save schema
    chrome.storage.local.set({ 
      scrapingSchema: schema 
    });
    
    // Clean up old obsolete keys
    chrome.storage.local.remove(['apiKey', 'htmlPrompt']);

    showResult('Schema saved successfully!', 'success');
  } catch (error) {
    showResult(`Invalid JSON format: ${error.message}`, 'error');
  }
});

// Scrape current page
document.getElementById('scrapeData').addEventListener('click', async () => {
  showResult('Scraping page...', 'success');

  try {
    const result = await chrome.storage.local.get('scrapingSchema');
    if (!result.scrapingSchema) {
      showResult('Generate schema first', 'error');
      return;
    }

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

        const elements = document.querySelectorAll(baseSelector);
        
        elements.forEach(el => {
          // If no fields provided, extract the base attribute directly
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
            let attr = 'text'; // Default to text content

            // Parse for attribute syntax (e.g., "img@src", "a@href", "@href")
            const atIndex = rawSelector.lastIndexOf('@');
            if (atIndex !== -1) {
              cssSelector = rawSelector.substring(0, atIndex);
              attr = rawSelector.substring(atIndex + 1);
            }

            // If cssSelector is empty (e.g., "@href"), use the parent element itself
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
      args: [result.scrapingSchema]
    });

    scrapedData = results[0].result;
    chrome.storage.local.set({ latestScrapedData: scrapedData });
    showResult(`Scraped ${scrapedData.length} items`, 'success');
  } catch (error) {
    showResult(`Error: ${error.message}`, 'error');
  }
});

// Send to MCP server
document.getElementById('sendToMcp').addEventListener('click', async () => {
  const data = await chrome.storage.local.get('latestScrapedData');
  console.log('Latest scraped data:', data.latestScrapedData);
  
  if (!data.latestScrapedData || data.latestScrapedData.length === 0) {
    showResult('No scraped data available', 'error');
    return;
  }

  showResult('Sending to MCP server...', 'success');

  try {
    const response = await fetch('http://localhost:3000/store-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data.latestScrapedData })
    });

    if (response.ok) {
      showResult('Data sent to MCP successfully!', 'success');
      checkMcpStatus();
    } else {
      showResult('MCP server not responding', 'error');
    }
  } catch (error) {
    showResult('MCP server not running', 'error');
  }
});

async function checkMcpStatus() {
  const statusDiv = document.getElementById('mcpStatus');
  
  try {
    const response = await fetch('http://localhost:3000/health');
    if (response.ok) {
      statusDiv.className = 'status running';
      statusDiv.innerHTML = '<span class="dot green"></span><span>MCP Server: Running</span>';
    } else {
      throw new Error('Not running');
    }
  } catch (error) {
    statusDiv.className = 'status stopped';
    statusDiv.innerHTML = '<span class="dot red"></span><span>MCP Server: Stopped</span>';
  }
}

function showResult(message, type) {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = message;
  resultDiv.className = type;
  resultDiv.style.display = 'block';
}

// Check status every 5 seconds
setInterval(checkMcpStatus, 5000);
