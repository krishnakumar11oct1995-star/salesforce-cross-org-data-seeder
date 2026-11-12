/**
 * Background Service Worker for Salesforce Data Seeder Extension (Manifest V3)
 */

import { AuthManager } from './authManager';
import {
  ExtensionMessage,
  ExtensionResponse,
  SalesforceOrgSession
} from './types';

chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

function parseSalesforceDomain(urlString?: string): { isSalesforce: boolean; domain?: string; apiHost?: string; instanceUrl?: string; isSandbox?: boolean } {
  if (!urlString) return { isSalesforce: false };

  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    const isSalesforce =
      hostname.endsWith('.salesforce.com') ||
      hostname.endsWith('.force.com') ||
      hostname.endsWith('.my.salesforce.com') ||
      hostname.endsWith('.lightning.force.com');

    if (!isSalesforce) {
      return { isSalesforce: false };
    }

    const isSandbox = hostname.includes('--') || hostname.includes('sandbox') || hostname.includes('cs');

    let apiHost = hostname;
    if (hostname.includes('.lightning.force.com')) {
      apiHost = hostname.replace('.lightning.force.com', '.my.salesforce.com');
    }

    return {
      isSalesforce: true,
      domain: hostname,
      apiHost,
      instanceUrl: `https://${apiHost}`,
      isSandbox
    };
  } catch {
    return { isSalesforce: false };
  }
}

/**
 * Finds the 'sid' cookie belonging to exactly this org. Only cookies whose domain
 * equals the org's API host or the tab's host are accepted -- never another org's session.
 */
async function findOrgSidCookie(
  apiHost: string | undefined,
  domain: string | undefined,
  tabUrl: string | undefined
): Promise<chrome.cookies.Cookie | null> {
  const allowedHosts = new Set([apiHost, domain].filter((h): h is string => !!h).map(h => h.toLowerCase()));
  const isExactMatch = (c: chrome.cookies.Cookie): boolean =>
    !!c && c.name === 'sid' && !!c.value && !!c.domain &&
    allowedHosts.has(c.domain.replace(/^\./, '').toLowerCase());

  const urls: string[] = [];
  if (apiHost) urls.push(`https://${apiHost}/`);
  if (tabUrl) urls.push(tabUrl);

  for (const url of urls) {
    try {
      const cookies = await chrome.cookies.getAll({ url, name: 'sid' });
      const match = cookies.find(isExactMatch);
      if (match) return match;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function getActiveSalesforceSession(tabId?: number): Promise<SalesforceOrgSession | null> {
  let activeTab: chrome.tabs.Tab | undefined;

  if (tabId) {
    activeTab = await chrome.tabs.get(tabId);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
  }

  if (!activeTab || !activeTab.url) return null;

  const { isSalesforce, domain, apiHost, instanceUrl, isSandbox } = parseSalesforceDomain(activeTab.url);
  if (!isSalesforce || !domain || !instanceUrl) return null;

  // Exact domain match only: never fall back to another org's session cookie.
  const sessionCookie = await findOrgSidCookie(apiHost, domain, activeTab.url);

  if (!sessionCookie || !sessionCookie.value) {
    return {
      instanceUrl,
      sessionId: '',
      domain,
      isSandbox: isSandbox || false,
      source: 'cookie'
    };
  }

  const sessionData: SalesforceOrgSession = {
    instanceUrl,
    sessionId: sessionCookie.value,
    domain,
    isSandbox: isSandbox || false,
    source: 'cookie'
  };

  await chrome.storage.session.set({ activeSalesforceSession: sessionData });
  return sessionData;
}

chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  sender,
  sendResponse: (response: ExtensionResponse) => void
) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_ACTIVE_ORG_SESSION': {
          const session = await getActiveSalesforceSession(sender.tab?.id);
          if (!session || !session.sessionId) {
            sendResponse({
              success: false,
              error: 'No Salesforce session cookie found for the exact org domain of this tab domain. Log in to that org in this tab (or refresh it), then retry.'
            });
          } else {
            sendResponse({ success: true, data: session });
          }
          break;
        }

        case 'LOGIN_SOURCE_ORG': {
          const payload = message.payload as {
            loginUrl: string;
            username: string;
            password: string;
          };
          if (!payload || !payload.loginUrl || !payload.username || !payload.password) {
            sendResponse({ success: false, error: 'Login URL, Username, and Password are required.' });
            return;
          }
          const sourceOrg = await AuthManager.loginWithUsernamePassword({
            alias: 'SOURCE_ORG',
            loginUrl: payload.loginUrl,
            username: payload.username,
            password: payload.password
          });
          const sourceSessionData: SalesforceOrgSession = {
            instanceUrl: sourceOrg.instanceUrl,
            sessionId: sourceOrg.accessToken,
            domain: new URL(sourceOrg.instanceUrl).hostname,
            isSandbox: payload.loginUrl.includes('test.salesforce.com'),
            source: 'oauth'
          };
          await chrome.storage.session.set({ activeSalesforceSession: sourceSessionData });
          sendResponse({ success: true, data: sourceSessionData });
          break;
        }

        case 'GET_TARGET_ORGS': {
          const orgs = await AuthManager.getTargetOrgs();
          sendResponse({ success: true, data: orgs });
          break;
        }

        case 'CONNECT_TARGET_ORG_DIRECT': {
          const payload = message.payload as {
            alias: string;
            loginUrl: string;
            username: string;
            password: string;
          };
          if (!payload || !payload.alias || !payload.loginUrl || !payload.username || !payload.password) {
            sendResponse({
              success: false,
              error: 'Alias, Login URL, Username, and Password are required.'
            });
            return;
          }
          const connectedOrg = await AuthManager.loginWithUsernamePassword(payload);
          sendResponse({ success: true, data: connectedOrg });
          break;
        }

        case 'DISCONNECT_TARGET_ORG': {
          const { alias } = (message.payload as { alias: string }) || {};
          if (!alias) {
            sendResponse({ success: false, error: 'Alias is required.' });
            return;
          }
          await AuthManager.disconnectTargetOrg(alias);
          sendResponse({ success: true, data: { disconnected: alias } });
          break;
        }

        case 'OPEN_SIDE_PANEL': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.windowId && chrome.sidePanel?.open) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Could not open side panel.' });
          }
          break;
        }

        case 'HEALTH_CHECK': {
          sendResponse({ success: true, data: { status: 'ONLINE', timestamp: Date.now() } });
          break;
        }

        default:
          sendResponse({
            success: false,
            error: `Unhandled message action: ${(message as ExtensionMessage).type}`
          });
      }
    } catch (err: unknown) {
      console.error('Service Worker Error:', err);
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown service worker error'
      });
    }
  })();

  return true;
});
