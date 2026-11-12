/**
 * AuthManager: Direct Username/Password (SOAP) login. Passwords are never persisted;
 * expired sessions require the user to log in again.
 */

import { StoredTargetOrg } from './types';

const STORAGE_TARGET_ORGS_KEY = 'salesforce_data_seeder_target_orgs';
// Legacy key: older versions cached credentials here. Now only cleared, never written.
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

    // The password is used only for this SOAP login call and is never persisted.
    // Remove any credentials cached by older versions of the extension.
    try {
      await chrome.storage.session.remove(STORAGE_CREDENTIALS_SESSION_KEY);
    } catch {
      // continue
    }

    return storedOrg;
  }

  /**
   * Passwords are not stored, so an expired target session cannot be renewed silently.
   * The caller must surface this error and prompt the user to log in again.
   */
  public static async renewTargetSession(alias: string): Promise<StoredTargetOrg> {
    throw new Error(`Session for '${alias}' has expired. Please log in again to reconnect this org.`);
  }

  /**
   * Re-reads the source session from the active Salesforce tab cookie. Passwords are not
   * stored, so a Direct Login source session that expired requires the user to log in again.
   */
  public static async renewSourceSession(): Promise<{ instanceUrl: string; sessionId: string }> {
    const res = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ORG_SESSION' });
    if (res && res.success && res.data) {
      return res.data;
    }
    throw new Error('Source session expired. Please refresh the Salesforce tab or log in again via Direct Login.');
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
