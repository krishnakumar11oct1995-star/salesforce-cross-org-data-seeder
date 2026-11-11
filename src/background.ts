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

  let sessionCookie: chrome.cookies.Cookie | undefined | null = null;

  // 1. Check API domain
  if (apiHost) {
    try {
      const apiDomainCookies = await chrome.cookies.getAll({ domain: apiHost });
      sessionCookie = apiDomainCookies.find(c => c.name === 'sid' && c.value);
    } catch {
      // continue
    }
  }

  // 2. Check tab URL
  if (!sessionCookie) {
    try {
      const tabCookies = await chrome.cookies.getAll({ url: activeTab.url });
      sessionCookie = tabCookies.find(c => c.name === 'sid' && c.value);
    } catch {
      // continue
    }
  }

  // 3. Fallback to all matching cookies
  if (!sessionCookie) {
    const allCookies = await chrome.cookies.getAll({ name: 'sid' });
    sessionCookie = allCookies.find(c => apiHost && apiHost.includes(c.domain.replace(/^\./, '')));
    if (!sessionCookie) {
      sessionCookie = allCookies.find(c => domain.includes(c.domain.replace(/^\./, '')));
    }
    if (!sessionCookie && allCookies.length > 0) {
      sessionCookie = allCookies[0];
    }
  }

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
              error: 'No active Salesforce session detected in current tab. Please refresh the Salesforce tab.'
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
