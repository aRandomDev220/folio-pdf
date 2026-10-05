// Response-header matching is newer than some @types/chrome releases.
export type Rule = chrome.declarativeNetRequest.Rule & { condition: chrome.declarativeNetRequest.RuleCondition & {
  responseHeaders?: { header: string; values?: string[] }[];
  excludedResponseHeaders?: { header: string; values?: string[] }[];
} };
