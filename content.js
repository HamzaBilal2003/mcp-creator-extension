// Content script — watches for page/DOM changes and notifies background if auto-scrape is enabled

let debounceTimer = null;
let lastUrl = location.href;

function notifyPageChanged() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ action: 'pageChanged' });
  }, 800); // debounce so rapid DOM mutations don't spam
}

// ── 1. MutationObserver: catch SPA content swaps ────────────────────────────
const observer = new MutationObserver((mutations) => {
  // Only react to meaningful mutations (added/removed nodes, not attr tweaks)
  const significant = mutations.some(
    (m) => m.addedNodes.length > 0 || m.removedNodes.length > 0
  );
  if (significant) {
    notifyPageChanged();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// ── 2. URL change detection (history API / hash changes) ─────────────────────
function checkUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    notifyPageChanged();
  }
}

// history.pushState / replaceState don't fire events — patch them
(function patchHistory() {
  const wrap = (original) =>
    function (...args) {
      const result = original.apply(this, args);
      checkUrlChange();
      return result;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
})();

// popstate fires on back/forward navigation
window.addEventListener('popstate', checkUrlChange);

// hashchange covers hash-only SPA routing
window.addEventListener('hashchange', checkUrlChange);

// ── 3. Respond to direct HTML requests from the popup ────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getHTML') {
    sendResponse({ html: document.documentElement.outerHTML });
  }
  return true;
});

console.log('[DOM Scraper MCP] content script loaded, watching for page changes');
