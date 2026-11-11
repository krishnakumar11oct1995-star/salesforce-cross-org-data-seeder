/**
 * AuthManager: Supports Direct Username/Password Login with Auto-Renewal
 */

import { StoredTargetOrg } from './types';

const STORAGE_TARGET_ORGS_KEY = 'salesforce_data_seeder_target_orgs';
const STORAGE_CREDENTIALS_SESSION_KEY = 'salesforce_session_creds_map';

export interface DirectLoginParams {
  alias: string;
  loginUrl: string;
  username: string;
  password: string;
}

export class AuthManager {
  /**
   * Logs into a Salesforce target org directly using Username & Password (NO Client ID required).
   */
  public static async loginWithUsernamePassword(params: DirectLoginParams): Promise<StoredTargetOrg> {
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

    const storedOrg: StoredTargetOrg = {
      alias,
      instanceUrl,
      loginUrl: cleanLoginUrl,
      accessToken: sessionId,
      issuedAt: Date.now(),
      clientId: 'DIRECT_SOAP_LOGIN',
      userId: userId || undefined,
      orgId: orgId || undefined
    };

    if (alias !== 'SOURCE_ORG') {
      await this.saveTargetOrg(storedOrg);
    }

    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = (credResult[STORAGE_CREDENTIALS_SESSION_KEY] as Record<string, DirectLoginParams>) || {};
      credMap[alias] = { alias, loginUrl: cleanLoginUrl, username, password };
      await chrome.storage.session.set({ [STORAGE_CREDENTIALS_SESSION_KEY]: credMap });
    } catch {
      // continue
    }

    return storedOrg;
  }

  /**
   * Transparently renews expired target org session using session-cached credentials.
   */
  public static async renewTargetSession(alias: string): Promise<StoredTargetOrg> {
    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = (credResult[STORAGE_CREDENTIALS_SESSION_KEY] as Record<string, DirectLoginParams>) || {};
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
    } catch (err: unknown) {
      throw new Error(`Failed to auto-renew session for '${alias}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public static async getTargetOrgs(): Promise<StoredTargetOrg[]> {
    const result = await chrome.storage.local.get(STORAGE_TARGET_ORGS_KEY);
    return (result[STORAGE_TARGET_ORGS_KEY] as StoredTargetOrg[]) || [];
  }

  public static async saveTargetOrg(org: StoredTargetOrg): Promise<void> {
    const existing = await this.getTargetOrgs();
    const index = existing.findIndex(o => o.alias === org.alias);

    if (index >= 0) {
      existing[index] = org;
    } else {
      existing.push(org);
    }

    await chrome.storage.local.set({ [STORAGE_TARGET_ORGS_KEY]: existing });
  }

  public static async disconnectTargetOrg(alias: string): Promise<void> {
    const existing = await this.getTargetOrgs();
    const filtered = existing.filter(o => o.alias !== alias);
    await chrome.storage.local.set({ [STORAGE_TARGET_ORGS_KEY]: filtered });

    try {
      const credResult = await chrome.storage.session.get(STORAGE_CREDENTIALS_SESSION_KEY);
      const credMap = (credResult[STORAGE_CREDENTIALS_SESSION_KEY] as Record<string, DirectLoginParams>) || {};
      delete credMap[alias];
      await chrome.storage.session.set({ [STORAGE_CREDENTIALS_SESSION_KEY]: credMap });
    } catch {
      // continue
    }
  }

  private static escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private static extractXmlTag(xml: string, tagName: string): string | null {
    const regex = new RegExp(`<(?:\w+:)?${tagName}>(.*?)</(?:\w+:)?${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1] : null;
  }
}
