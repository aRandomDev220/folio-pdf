import { mimeHandler } from './api';
import { legacyRules } from './rules';

const viewer = () => chrome.runtime.getURL('viewer.html');
const headerMatching = () => Number(navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/)?.[1] || 0) >= 128;
let configuration: Promise<void> = Promise.resolve();
function configure() {
  configuration = configuration.catch(() => {}).then(async () => {
    const { autoOpen = true } = await chrome.storage.local.get('autoOpen');
    const installed = await chrome.declarativeNetRequest.getDynamicRules();
    // New native stream handling must never race a legacy network redirect.
    const rules = !mimeHandler() && autoOpen !== false ? legacyRules(viewer(), headerMatching()) : [];
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: installed.map((rule) => rule.id), addRules: rules });
    chrome.action.setBadgeText({ text: '' });
  });
  return configuration;
}

chrome.runtime.onInstalled.addListener(() => {
  void configure();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'folio-open', title: 'Open PDF in Folio', contexts: ['link'], targetUrlPatterns: ['http://*/*.pdf*', 'https://*/*.pdf*', 'file://*/*.pdf*'] });
  });
});
chrome.runtime.onStartup.addListener(() => { void configure(); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: viewer() }); });
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'folio-open' && info.linkUrl) void chrome.tabs.create({ url: viewer() + '#source=' + info.linkUrl });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'set-auto-open' && typeof message.enabled === 'boolean') {
    void chrome.storage.local.set({ autoOpen: message.enabled }).then(configure).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (message?.type === 'open-native' && typeof message.url === 'string' && sender.tab?.id != null) {
    const tabId = sender.tab.id;
    let url: URL;
    try { url = new URL(message.url); if (!['http:', 'https:', 'file:'].includes(url.protocol)) return; } catch { return; }
    // A tab-scoped bypass survives PDF redirects until Folio is reopened or the
    // tab closes. This prevents loops even for extensionless redirect targets.
    const id = 100000 + tabId;
    void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [{ id, priority: 10000, action: { type: 'allowAllRequests' }, condition: { tabIds: [tabId], resourceTypes: ['main_frame'] } }] })
      .then(() => chrome.tabs.update(tabId, { url: url.href })).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener((tabId) => { void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [100000 + tabId] }); });
// Restore Folio handling when its viewer is reopened in this tab.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url?.startsWith(viewer())) void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [100000 + tabId] });
});
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (mimeHandler() || details.frameId !== 0) return;
  let source: URL;
  try { source = new URL(details.url); } catch { return; }
  if (source.protocol !== 'file:' || !source.pathname.toLowerCase().endsWith('.pdf')) return;
  void chrome.storage.local.get('autoOpen').then(async ({ autoOpen = true }) => {
    if (autoOpen === false) return;
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (allowed && !rules.some((rule) => rule.id === 100000 + details.tabId))
      await chrome.tabs.update(details.tabId, { url: viewer() + '#source=' + details.url });
  });
}, { url: [{ schemes: ['file'] }] });

// Service workers are restarted frequently; restore dynamic rule selection.
void configure().catch(() => {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setTitle({ title: 'Folio — automatic PDF opening could not be enabled. Open PDFs from the file picker.' });
});
