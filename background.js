/**
 * Background Service Worker for Salesforce Data Seeder Extension (Manifest V3)
 */

import { AuthManager } from './authManager.js';

// Expose session storage to both service worker and side panel contexts
if (chrome.storage?.session?.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
}

// Setup side panel behavior on installation
chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  if (chrome.storage?.session?.setAccessLevel) {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
  }
});

function parseSalesforceDomain(urlString) {
  if (!urlString) return { isSalesforce: false };

  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    const isSalesforce =
      hostname.includes('.salesforce.com') ||
      hostname.includes('.force.com') ||
      hostname.includes('.salesforce-setup.com') ||
      hostname.includes('.cloudforce.com');

    if (!isSalesforce) {
      return { isSalesforce: false };
    }

    const isSandbox = hostname.includes('--') || hostname.includes('sandbox') || hostname.includes('cs');

    let apiHost = hostname;
    if (apiHost.includes('.develop.lightning.force.com')) {
      apiHost = apiHost.replace('.develop.lightning.force.com', '.my.salesforce.com');
    } else if (apiHost.includes('.lightning.force.com')) {
      apiHost = apiHost.replace('.lightning.force.com', '.my.salesforce.com');
    } else if (apiHost.includes('.salesforce-setup.com')) {
      apiHost = apiHost.replace('.salesforce-setup.com', '.my.salesforce.com');
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
async function findOrgSidCookie(apiHost, domain, tabUrl) {
  const allowedHosts = new Set([apiHost, domain].filter(Boolean).map(h => h.toLowerCase()));
  const isExactMatch = (c) =>
    c && c.name === 'sid' && c.value && c.domain &&
    allowedHosts.has(c.domain.replace(/^\./, '').toLowerCase());

  const urls = [];
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

async function getActiveSalesforceSession(tabId) {
  let activeTab;

  if (tabId) {
    try {
      activeTab = await chrome.tabs.get(tabId);
    } catch {}
  }

  if (!activeTab || !activeTab.url || !parseSalesforceDomain(activeTab.url).isSalesforce) {
    try {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab && currentTab.url && parseSalesforceDomain(currentTab.url).isSalesforce) {
        activeTab = currentTab;
      }
    } catch {}
  }

  // If the focused tab is not Salesforce (e.g. edge://extensions), automatically find any open Salesforce tab
  if (!activeTab || !activeTab.url || !parseSalesforceDomain(activeTab.url).isSalesforce) {
    try {
      const allTabs = await chrome.tabs.query({});
      const sfTab = allTabs.find(t => t.url && parseSalesforceDomain(t.url).isSalesforce);
      if (sfTab) {
        activeTab = sfTab;
      }
    } catch {}
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

  const sessionData = {
    instanceUrl,
    sessionId: sessionCookie.value,
    domain,
    isSandbox: isSandbox || false,
    source: 'cookie'
  };

  await chrome.storage.session.set({ activeSalesforceSession: sessionData });
  return sessionData;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
          const payload = message.payload;
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
          const sourceSessionData = {
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

        case 'RENEW_SOURCE_SESSION': {
          const renewed = await AuthManager.renewSourceSession();
          sendResponse({ success: true, data: renewed });
          break;
        }

        case 'RENEW_TARGET_SESSION': {
          const { alias } = message.payload || {};
          if (!alias) {
            sendResponse({ success: false, error: 'Alias is required.' });
            return;
          }
          const renewed = await AuthManager.renewTargetSession(alias);
          sendResponse({ success: true, data: renewed });
          break;
        }

        case 'GET_TARGET_ORGS': {
          const orgs = await AuthManager.getTargetOrgs();
          sendResponse({ success: true, data: orgs });
          break;
        }

        case 'CONNECT_TARGET_ORG_DIRECT': {
          const payload = message.payload;
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
          const { alias } = message.payload || {};
          if (!alias) {
            sendResponse({ success: false, error: 'Alias is required.' });
            return;
          }
          await AuthManager.disconnectTargetOrg(alias);
          sendResponse({ success: true, data: { disconnected: alias } });
          break;
        }

        case 'CLEAR_ALL_STORED_ORGS': {
          await AuthManager.clearAllStoredOrgs();
          sendResponse({ success: true, data: { cleared: true } });
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
            error: `Unhandled message action: ${message.type}`
          });
      }
    } catch (err) {
      console.error('Service Worker Error:', err);
      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown service worker error'
      });
    }
  })();

  return true;
});
