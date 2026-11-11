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

  let { isSalesforce, domain, apiHost, instanceUrl, isSandbox } = parseSalesforceDomain(activeTab.url);
  if (!isSalesforce || !domain || !instanceUrl) return null;

  let sessionCookie = null;

  // Retrieve all 'sid' cookies across browser
  let allSidCookies = [];
  try {
    allSidCookies = await chrome.cookies.getAll({ name: 'sid' });
  } catch {}

  if (allSidCookies && allSidCookies.length > 0) {
    // 1. Prefer cookie matching .my.salesforce.com (canonical REST API host)
    const mySalesforceCookie = allSidCookies.find(c =>
      c.value &&
      c.domain &&
      c.domain.includes('.my.salesforce.com') &&
      !c.domain.startsWith('login.') &&
      !c.domain.startsWith('test.')
    );

    if (mySalesforceCookie) {
      sessionCookie = mySalesforceCookie;
      const cleanDomain = mySalesforceCookie.domain.replace(/^\./, '');
      apiHost = cleanDomain;
      instanceUrl = `https://${cleanDomain}`;
    } else {
      // 2. Cookie matching apiHost or domain
      sessionCookie = allSidCookies.find(c =>
        c.value &&
        c.domain &&
        (apiHost.includes(c.domain.replace(/^\./, '')) || domain.includes(c.domain.replace(/^\./, '')))
      );

      // 3. Fallback: any salesforce.com sid cookie
      if (!sessionCookie) {
        sessionCookie = allSidCookies.find(c => c.value && c.domain && c.domain.includes('salesforce.com'));
      }
    }
  }

  // If still not found, check activeTab url directly
  if (!sessionCookie && activeTab.url) {
    try {
      const tabCookies = await chrome.cookies.getAll({ url: activeTab.url });
      sessionCookie = tabCookies.find(c => c.name === 'sid' && c.value);
    } catch {}
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
              error: 'No active Salesforce session detected in current tab. Please refresh the Salesforce tab.'
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
