/**
 * ApiClient: High-resilience Salesforce REST API client for Chrome Extensions.
 * Supports transparent auto token refresh/renewal, exponential backoff, rate limit handling, and Composite Graph parsing.
 */

import { AuthManager } from './authManager';
import {
  CompositeGraphApiResponse,
  CompositeGraphPayload,
  SalesforceOrgSession,
  StoredTargetOrg
} from './types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  maxRetries?: number;
  baseDelayMs?: number;
  targetOrg?: StoredTargetOrg;
  sourceSession?: SalesforceOrgSession;
}

export class ApiClient {
  public static API_VERSION = 'v61.0';

  public static isAuthError(errorMsg = ''): boolean {
    const msg = String(errorMsg).toUpperCase();
    return (
      msg.includes('INVALID_SESSION_ID') ||
      msg.includes('SESSION EXPIRED') ||
      msg.includes('SESSION TIMEOUT') ||
      msg.includes('UNAUTHORIZED') ||
      msg.includes('HTTP 401')
    );
  }

  public static async executeRequest<T = unknown>(
    endpointUrl: string,
    authToken: string,
    options: RequestOptions = {}
  ): Promise<T> {
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
        const fetchHeaders: Record<string, string> = {
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

        if (response.status === 429 || response.status === 503) {
          if (attempt < maxRetries) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelayMs * Math.pow(2, attempt);
            console.warn(`[ApiClient] Hit ${response.status}. Retrying in ${delay}ms...`);
            await this.sleep(delay);
            attempt++;
            continue;
          }
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const errorMsg = this.extractErrorMessage(data, response.status);

          if (this.isAuthError(errorMsg) && attempt === 0) {
            if (targetOrg && targetOrg.alias) {
              console.info(`[ApiClient] Session expired for ${targetOrg.alias}. Auto-renewing...`);
              try {
                const refreshed = await AuthManager.renewTargetSession(targetOrg.alias);
                targetOrg.accessToken = refreshed.accessToken;
                activeToken = refreshed.accessToken;
                attempt++;
                continue;
              } catch (renewErr: unknown) {
                console.warn(`[ApiClient] Target auto-renewal failed: ${renewErr instanceof Error ? renewErr.message : String(renewErr)}`);
              }
            } else if (sourceSession) {
              console.info(`[ApiClient] Source session expired. Auto-renewing...`);
              try {
                const renewedSource = await AuthManager.renewSourceSession();
                activeToken = renewedSource.sessionId;
                attempt++;
                continue;
              } catch (renewErr: unknown) {
                console.warn(`[ApiClient] Source auto-renewal failed: ${renewErr instanceof Error ? renewErr.message : String(renewErr)}`);
              }
            }
          }

          throw new Error(errorMsg);
        }

        return data as T;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (this.isAuthError(message)) {
          throw err;
        }

        if (attempt >= maxRetries) {
          throw err;
        }

        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[ApiClient] Request failure: ${message}. Retrying in ${delay}ms...`);
        await this.sleep(delay);
        attempt++;
      }
    }

    throw new Error(`Request to ${endpointUrl} exceeded maximum retries.`);
  }

  public static async querySOQL<T = unknown>(
    instanceUrl: string,
    sessionId: string,
    soql: string,
    maxRecords = 2000,
    context: RequestOptions = {}
  ): Promise<T[]> {
    const cleanInstanceUrl = instanceUrl.replace(/\/+$/, '');
    let queryUrl = `${cleanInstanceUrl}/services/data/${this.API_VERSION}/query?q=${encodeURIComponent(soql)}`;
    const records: T[] = [];

    while (queryUrl && records.length < maxRecords) {
      const response = await this.executeRequest<{ records: T[]; done: boolean; nextRecordsUrl?: string }>(
        queryUrl,
        sessionId,
        context
      );

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

  public static async postCompositeGraph(
    targetOrg: StoredTargetOrg,
    payload: CompositeGraphPayload
  ): Promise<CompositeGraphApiResponse> {
    const cleanInstanceUrl = targetOrg.instanceUrl.replace(/\/+$/, '');
    const endpoint = `${cleanInstanceUrl}/services/data/${this.API_VERSION}/composite/graph`;

    return await this.executeRequest<CompositeGraphApiResponse>(endpoint, targetOrg.accessToken, {
      method: 'POST',
      body: payload,
      targetOrg
    });
  }

  public static parseCompositeGraphErrors(response: CompositeGraphApiResponse): string[] {
    const errors: string[] = [];

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

        if (Array.isArray(sub.body)) {
          const msgs = sub.body
            .map(b => {
              const bObj = b as Record<string, unknown>;
              const fields = Array.isArray(bObj.fields) && bObj.fields.length > 0 ? ` (Fields: ${bObj.fields.join(', ')})` : '';
              return `${bObj.message || bObj.errorCode || JSON.stringify(bObj)}${fields}`;
            })
            .join('; ');
          detail += msgs;
        } else if (sub.body && typeof sub.body === 'object') {
          const bodyMap = sub.body as Record<string, unknown>;
          detail += String(bodyMap.message || bodyMap.error || JSON.stringify(bodyMap));
        } else {
          detail += 'Unknown subrequest failure.';
        }

        errors.push(detail);
      }
    }

    return errors;
  }

  private static extractErrorMessage(data: unknown, statusCode: number): string {
    if (!data) return `HTTP Error ${statusCode}`;

    if (Array.isArray(data)) {
      return data.map(d => (d as Record<string, unknown>).message || (d as Record<string, unknown>).errorCode || JSON.stringify(d)).join(' | ');
    }

    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      return String(obj.message || obj.error_description || obj.error || `HTTP Error ${statusCode}`);
    }

    return `HTTP ${statusCode}: ${String(data)}`;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
