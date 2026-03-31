chrome.runtime.onInstalled.addListener(() => {
  console.log('DOM Scraper MCP extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
});
