// Content script for DOM access
console.log('DOM Scraper MCP content script loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getHTML') {
    sendResponse({ html: document.documentElement.outerHTML });
  }
  return true;
});
