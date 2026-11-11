/**
 * ApiClient: High-resilience Salesforce REST API client for Chrome Extensions.
 * Supports transparent auto token refresh/renewal, exponential backoff, rate limit handling, and Composite Graph parsing.
 */

import { AuthManager } from './authManager.js';

export class ApiClient {
  static API_VERSION = 'v61.0';

  /**
   * Checks if an error string represents an expired or invalid Salesforce session.
   */
  static isAuthError(errorMsg = '') {
    const msg = String(errorMsg).toUpperCase();
    return (
      msg.includes('INVALID_SESSION_ID') ||
      msg.includes('SESSION EXPIRED') ||
      msg.includes('SESSION TIMEOUT') ||
      msg.includes('UNAUTHORIZED') ||
      msg.includes('HTTP 401')
    );
  }

  /**
   * Executes an authenticated fetch request with auto-renewal and backoff.
   */
  static async executeRequest(endpointUrl, authToken, options = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      maxRetries = 3,
      baseDelayMs = 1000,
      targetOrg,
      sourceSession
    } = options;

    let attempt = 0;
    let activeToken = authToken;

    while (attempt <= maxRetries) {
      try {
        const fetchHeaders = {
          'Authorization': `Bearer ${activeToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...headers
        };

        const response = await fetch(endpointUrl, {
          method,
          headers: fetchHeaders,
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
        });

        // Handle Rate Limiting (429) or Server Busy (503)
        if (response.status === 429 || response.status === 503) {
          if (attempt < maxRetries) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelayMs * Math.pow(2, attempt);
            console.warn(`[ApiClient] Hit ${response.status}. Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
            await this.sleep(delay);
            attempt++;
            continue;
          }
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const errorMsg = this.extractErrorMessage(data, response.status);

          // Transparent Token Renewal on 401 / Session Expired
          if (this.isAuthError(errorMsg) && attempt === 0) {
            if (targetOrg && targetOrg.alias) {
              console.info(`[ApiClient] Session expired for ${targetOrg.alias}. Auto-renewing...`);
              try {
                const refreshed = await AuthManager.renewTargetSession(targetOrg.alias);
                targetOrg.accessToken = refreshed.accessToken;
                activeToken = refreshed.accessToken;
                attempt++;
                continue;
              } catch (renewErr) {
                console.warn(`[ApiClient] Target auto-renewal failed: ${renewErr.message}`);
              }
            } else if (sourceSession) {
              console.info(`[ApiClient] Source session expired. Auto-renewing...`);
              try {
                const renewedSource = await AuthManager.renewSourceSession();
                activeToken = renewedSource.sessionId;
                attempt++;
                continue;
              } catch (renewErr) {
                console.warn(`[ApiClient] Source auto-renewal failed: ${renewErr.message}`);
              }
            }
          }

          // Auto-recovery for 404 (e.g. if URL targeted a UI-only domain like .lightning.force.com or .develop.my.salesforce.com)
          if (response.status === 404 && attempt === 0) {
            try {
              const urlObj = new URL(endpointUrl);
              let altHost = null;

              if (urlObj.hostname.includes('.develop.my.salesforce.com')) {
                altHost = urlObj.hostname.replace('.develop.my.salesforce.com', '.my.salesforce.com');
              } else if (urlObj.hostname.includes('.develop.lightning.force.com')) {
                altHost = urlObj.hostname.replace('.develop.lightning.force.com', '.my.salesforce.com');
              } else if (urlObj.hostname.includes('.lightning.force.com')) {
                altHost = urlObj.hostname.replace('.lightning.force.com', '.my.salesforce.com');
              } else if (urlObj.hostname.includes('.salesforce-setup.com')) {
                altHost = urlObj.hostname.replace('.salesforce-setup.com', '.my.salesforce.com');
              }

              if (altHost && altHost !== urlObj.hostname) {
                urlObj.hostname = altHost;
                endpointUrl = urlObj.toString();
                console.warn(`[ApiClient] 404 encountered. Auto-redirecting to canonical REST API host: ${endpointUrl}`);
                attempt++;
                continue;
              }
            } catch {}
          }

          throw new Error(errorMsg);
        }

        return data;
      } catch (err) {
        // Do not retry blindly on unrecoverable authentication errors
        if (this.isAuthError(err.message)) {
          throw err;
        }

        if (attempt >= maxRetries) {
          throw err;
        }

        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[ApiClient] Request failure: ${err.message}. Retrying in ${delay}ms...`);
        await this.sleep(delay);
        attempt++;
      }
    }

    throw new Error(`Request to ${endpointUrl} exceeded maximum retries.`);
  }

  /**
   * Executes a SOQL query against an org and handles queryMore pagination if needed.
   */
  static async querySOQL(instanceUrl, sessionId, soql, maxRecords = 2000, context = {}) {
    const cleanInstanceUrl = instanceUrl.replace(/\/+$/, '');
    let queryUrl = `${cleanInstanceUrl}/services/data/${this.API_VERSION}/query?q=${encodeURIComponent(soql)}`;
    const records = [];

    while (queryUrl && records.length < maxRecords) {
      const response = await this.executeRequest(queryUrl, sessionId, context);

      if (response.records && Array.isArray(response.records)) {
        records.push(...response.records);
      }

      if (response.done || !response.nextRecordsUrl || records.length >= maxRecords) {
        break;
      }

      queryUrl = `${cleanInstanceUrl}${response.nextRecordsUrl}`;
    }

    return records.slice(0, maxRecords);
  }

  /**
   * Sends a Composite Graph payload (/services/data/v61.0/composite/graph) to a Target Org.
   * Auto-renews target token if expired.
   */
  static async postCompositeGraph(targetOrg, payload) {
    const cleanInstanceUrl = targetOrg.instanceUrl.replace(/\/+$/, '');
    const endpoint = `${cleanInstanceUrl}/services/data/${this.API_VERSION}/composite/graph`;

    return await this.executeRequest(endpoint, targetOrg.accessToken, {
      method: 'POST',
      body: payload,
      targetOrg
    });
  }

  /**
   * Parses Composite Graph API responses to extract granular record-level errors,
   * prioritizing root-cause errors over generic transaction rollback messages.
   */
  static parseCompositeGraphErrors(response) {
    const rootErrors = [];
    const rollbackErrors = [];

    if (!response || !response.graphs) {
      return ['Empty or malformed Composite Graph response received.'];
    }

    for (const graph of response.graphs) {
      if (graph.isSuccessful) continue;

      const subResponses = graph.graphResponse?.compositeResponse || [];
      for (const sub of subResponses) {
        if (sub.httpStatusCode >= 200 && sub.httpStatusCode < 300) continue;

        const refId = sub.referenceId || 'UNKNOWN_REF';
        let detail = `[${graph.graphId}] ${refId} (HTTP ${sub.httpStatusCode}): `;

        let isRollback = false;
        if (Array.isArray(sub.body)) {
          const msgs = sub.body
            .map(b => {
              const msg = b.message || b.errorCode || JSON.stringify(b);
              if (msg.includes('rolled back since another operation')) isRollback = true;
              const fieldStr = Array.isArray(b.fields) && b.fields.length > 0 ? ` (Fields: ${b.fields.join(', ')})` : '';
              return `${msg}${fieldStr}`;
            })
            .join('; ');
          detail += msgs;
        } else if (sub.body && typeof sub.body === 'object') {
          const bodyMap = sub.body;
          const msg = bodyMap.message || bodyMap.error || JSON.stringify(bodyMap);
          if (msg.includes('rolled back since another operation')) isRollback = true;
          detail += msg;
        } else {
          detail += 'Unknown subrequest failure.';
        }

        if (isRollback) {
          rollbackErrors.push(detail);
        } else {
          rootErrors.push(detail);
        }
      }
    }

    return rootErrors.length > 0 ? rootErrors : rollbackErrors;
  }

  static extractErrorMessage(data, statusCode) {
    if (!data) return `HTTP Error ${statusCode}`;

    if (Array.isArray(data)) {
      return data.map(d => d.message || d.errorCode || JSON.stringify(d)).join(' | ');
    }

    if (typeof data === 'object') {
      return data.message || data.error_description || data.error || `HTTP Error ${statusCode}`;
    }

    return `HTTP ${statusCode}: ${String(data)}`;
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
