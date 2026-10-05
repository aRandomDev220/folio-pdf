import type { Rule } from './types';

export function legacyRules(viewerUrl: string, headerMatching: boolean): Rule[] {
  // Put the unmodified source URL in the hash. It cannot escape into viewer query
  // parameters, and signed URL encodings survive without decode/re-encode.
  const redirect = { type: 'redirect', redirect: { regexSubstitution: `${viewerUrl}#source=\\0` } } as Rule['action'];
  const condition: Rule['condition'] = { resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType], requestMethods: ['get'], excludedInitiatorDomains: [new URL(viewerUrl).host] };
  const rules: Rule[] = [{
    id: 1, priority: 1, action: redirect,
    condition: { ...condition, regexFilter: '^https?://[^?#]+\\.pdf([?].*)?$', isUrlFilterCaseSensitive: false,
      ...(headerMatching ? { excludedResponseHeaders: [{ header: 'content-disposition', values: ['attachment*'] }] } : {}),
    },
  }];
  if (headerMatching) rules.push({
    id: 2, priority: 2, action: redirect,
    condition: { ...condition, regexFilter: '^https?://.*',
      responseHeaders: [{ header: 'content-type', values: ['application/pdf', 'application/pdf;*'] }],
      excludedResponseHeaders: [{ header: 'content-disposition', values: ['attachment*'] }],
    },
  });
  return rules;
}
