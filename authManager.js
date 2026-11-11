/**
 * AuthManager: Supports Direct Username/Password Login with Auto-Renewal
 */

const STORAGE_TARGET_ORGS_KEY = 'salesforce_data_seeder_target_orgs';
const STORAGE_CREDENTIALS_SESSION_KEY = 'salesforce_session_creds_map';

export class AuthManager {
  /**
   * Logs into a Salesforce target org directly using Username & Password (NO Client ID required).
   */
  static async loginWithUsernamePassword(params) {
    const { alias, loginUrl, username, password } = params;
    const cleanLoginUrl = loginUrl.replace(/\/+$/, '');
    const soapEndpoint = `${cleanLoginUrl}/services/Soap/u/61.0`;

    const soapEnvelope = `<?xml version="1.0" encoding="utf-8" ?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>${this.escapeXml(username)}</n1:username>
      <n1:password>${this.escapeXml(password)}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>`;

    const response = await fetch(soapEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'SOAPAction': '""'
      },
      body: soapEnvelope
    });

    const responseText = await response.text();

    if (!response.ok || responseText.includes('<soapenv:Fault>') || responseText.includes('<faultcode>')) {
      const faultString = this.extractXmlTag(responseText, 'faultstring') || 'Authentication failed. Check your username, password, or security token.';
      if (faultString.includes('Use Any API Auth') || faultString.includes('SOAP API login')) {
        throw new Error(
          'Salesforce has restricted legacy SOAP API logins for this org. ' +
          'Instead of entering credentials, please click "⚡ Link Active Tab as Target" (or "⚡ Use Same Org") to connect directly via your active browser tab with zero credentials needed!'
        );
      }
      if (faultString.includes('LOGIN_MUST_USE_SECURITY_TOKEN')) {
        throw new Error(
          'Salesforce requires a Security Token for password logins from this location. ' +
          'Easy fix: Instead of typing a password, simply click "⚡ Link Active Tab as Target" (or "⚡ Use Same Org") — it authenticates instantly via your browser session with NO password or security token required!'
        );
      }
      throw new Error(`Salesforce Login Error: ${faultString}`);
    }

    const sessionId = this.extractXmlTag(responseText, 'sessionId');
    const serverUrl = this.extractXmlTag(responseText, 'serverUrl');
    const userId = this.extractXmlTag(responseText, 'userId');
    const orgId = this.extractXmlTag(responseText, 'organizationId');

    if (!sessionId || !serverUrl) {
      throw new Error('Failed to parse sessionId or serverUrl from login response.');
    }

    const urlObj = new URL(serverUrl);
    const instanceUrl = `${urlObj.protocol}//${urlObj.host}`;

    const storedOrg = {
      alias,
      instanceUrl,
      loginUrl: cleanLoginUrl,
      accessToken: sessionId,
      issuedAt: Date.now(),
      clientId: 'DIRECT_SOAP_LOGIN',
      userId,
      orgId
    };

    if (alias !== 'SOURCE_ORG') {
      await this.saveTargetOrg(storedOrg);
    }

    // Save credentials in session memory for automatic token renewal
    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = credResult[STORAGE_CREDENTIALS_SESSION_KEY] || {};
      credMap[alias] = { loginUrl: cleanLoginUrl, username, password };
      await chrome.storage.session.set({ [STORAGE_CREDENTIALS_SESSION_KEY]: credMap });
    } catch {
      // session storage fallback
    }

    return storedOrg;
  }

  /**
   * Transparently renews expired target org session using session-cached credentials.
   */
  static async renewTargetSession(alias) {
    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = credResult[STORAGE_CREDENTIALS_SESSION_KEY] || {};
      const savedCreds = credMap[alias];

      if (!savedCreds) {
        throw new Error(`Session for '${alias}' has expired and credentials are not cached in session. Please re-authenticate.`);
      }

      console.info(`[AuthManager] Auto-renewing session for '${alias}'...`);
      return await this.loginWithUsernamePassword({
        alias,
        loginUrl: savedCreds.loginUrl,
        username: savedCreds.username,
        password: savedCreds.password
      });
    } catch (err) {
      throw new Error(`Failed to auto-renew session for '${alias}': ${err.message}`);
    }
  }

  /**
   * Transparently renews expired source org session.
   */
  static async renewSourceSession() {
    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = credResult[STORAGE_CREDENTIALS_SESSION_KEY] || {};
      const savedCreds = credMap['SOURCE_ORG'];

      if (!savedCreds) {
        // Try getting fresh active session cookie from background
        const res = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ORG_SESSION' });
        if (res && res.success && res.data) {
          return res.data;
        }
        throw new Error('Source session expired. Please refresh the Salesforce tab or use Direct Login.');
      }

      console.info(`[AuthManager] Auto-renewing Source Org session...`);
      const renewedOrg = await this.loginWithUsernamePassword({
        alias: 'SOURCE_ORG',
        loginUrl: savedCreds.loginUrl,
        username: savedCreds.username,
        password: savedCreds.password
      });

      const sourceSessionData = {
        instanceUrl: renewedOrg.instanceUrl,
        sessionId: renewedOrg.accessToken,
        domain: new URL(renewedOrg.instanceUrl).hostname,
        isSandbox: savedCreds.loginUrl.includes('test.salesforce.com'),
        source: 'oauth'
      };

      await chrome.storage.session.set({ activeSalesforceSession: sourceSessionData });
      return sourceSessionData;
    } catch (err) {
      throw new Error(`Failed to auto-renew source session: ${err.message}`);
    }
  }

  static async getTargetOrgs() {
    const result = await chrome.storage.local.get(STORAGE_TARGET_ORGS_KEY);
    return result[STORAGE_TARGET_ORGS_KEY] || [];
  }

  static async saveTargetOrg(org) {
    const existing = await this.getTargetOrgs();
    const index = existing.findIndex(o => o.alias === org.alias);

    if (index >= 0) {
      existing[index] = org;
    } else {
      existing.push(org);
    }

    await chrome.storage.local.set({ [STORAGE_TARGET_ORGS_KEY]: existing });
  }

  static async disconnectTargetOrg(alias) {
    const existing = await this.getTargetOrgs();
    const filtered = existing.filter(o => o.alias !== alias);
    await chrome.storage.local.set({ [STORAGE_TARGET_ORGS_KEY]: filtered });

    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = credResult[STORAGE_CREDENTIALS_SESSION_KEY] || {};
      delete credMap[alias];
      await chrome.storage.session.set({ [STORAGE_CREDENTIALS_SESSION_KEY]: credMap });
    } catch {
      // continue
    }
  }

  static async clearAllStoredOrgs() {
    await chrome.storage.local.remove(STORAGE_TARGET_ORGS_KEY);
    try {
      await chrome.storage.session.remove(STORAGE_CREDENTIALS_SESSION_KEY);
      await chrome.storage.session.remove('activeSalesforceSession');
    } catch {
      // continue
    }
  }

  static escapeXml(unsafe) {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  static extractXmlTag(xml, tagName) {
    const regex = new RegExp(`<(?:\w+:)?${tagName}>(.*?)</(?:\w+:)?${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1] : null;
  }
}
