/**
 * SchemaEngine: Introspects SObject metadata, relationships, and reconciles schemas across orgs.
 * Includes local storage caching with TTL in chrome.storage.local.
 */

import { ApiClient } from './apiClient.js';

const SCHEMA_CACHE_PREFIX = 'sf_schema_cache_';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 2; // 2 Hours TTL

export class SchemaEngine {
  static API_VERSION = 'v61.0';

  /**
   * Fetches full DescribeSObjectResult for an object from cache or Salesforce REST API.
   * Supports passing auth token string OR targetOrg / sourceSession object.
   */
  static async describeSObject(instanceUrl, authContext, objectApiName, bypassCache = false) {
    const cleanInstanceUrl = instanceUrl.replace(/\/+$/, '');
    const cacheKey = `${SCHEMA_CACHE_PREFIX}${cleanInstanceUrl}_${objectApiName}`;

    // 1. Check Local Cache
    if (!bypassCache) {
      const cached = await this.getCachedDescribe(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 2. Resolve Auth Token & Request Options
    let authToken = '';
    const reqOptions = {};

    if (typeof authContext === 'string') {
      authToken = authContext;
    } else if (authContext && authContext.accessToken) {
      authToken = authContext.accessToken;
      reqOptions.targetOrg = authContext;
    } else if (authContext && authContext.sessionId) {
      authToken = authContext.sessionId;
      reqOptions.sourceSession = authContext;
    }

    // 3. Fetch from REST API with Auto-Renewal
    const endpoint = `${cleanInstanceUrl}/services/data/${this.API_VERSION}/sobjects/${objectApiName}/describe`;
    const describe = await ApiClient.executeRequest(endpoint, authToken, reqOptions);

    // 4. Cache Result
    await this.setCachedDescribe(cacheKey, describe, DEFAULT_TTL_MS);

    return describe;
  }

  /**
   * Fetches global describe list of all queryable and createable objects in the org.
   */
  static async getEligibleObjects(instanceUrl, authContext) {
    const cleanInstanceUrl = instanceUrl.replace(/\/+$/, '');
    const endpoint = `${cleanInstanceUrl}/services/data/${this.API_VERSION}/sobjects`;

    let authToken = '';
    const reqOptions = {};

    if (typeof authContext === 'string') {
      authToken = authContext;
    } else if (authContext && authContext.sessionId) {
      authToken = authContext.sessionId;
      reqOptions.sourceSession = authContext;
    } else if (authContext && authContext.accessToken) {
      authToken = authContext.accessToken;
      reqOptions.targetOrg = authContext;
    }

    const response = await ApiClient.executeRequest(endpoint, authToken, reqOptions);

    return response.sobjects
      .filter(obj => obj.queryable && obj.createable && !obj.deprecatedAndHidden)
      .map(obj => ({
        name: obj.name,
        label: obj.label,
        custom: obj.custom,
        keyPrefix: obj.keyPrefix
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Analyzes an SObject to extract all upstream Parent Lookups (identifying mandatory vs optional).
   */
  static getParentRelationships(describe) {
    const parents = [];

    for (const field of describe.fields) {
      if (
        field.type === 'reference' &&
        field.referenceTo &&
        field.referenceTo.length > 0 &&
        field.relationshipName
      ) {
        const parentObject = field.referenceTo[0];

        // Skip internal system lookups
        if (['User', 'Group', 'Profile', 'RecordType', 'Organization', 'Network'].includes(parentObject)) {
          continue;
        }

        const isRequired = field.nillable === false && field.createable;

        parents.push({
          relationshipName: field.relationshipName,
          fieldApiName: field.name,
          parentObjectApiName: parentObject,
          parentObjectLabel: parentObject,
          isRequired,
          selected: isRequired
        });
      }
    }

    return parents.sort((a, b) => (b.isRequired ? 1 : 0) - (a.isRequired ? 1 : 0));
  }

  /**
   * Analyzes an SObject to extract all downstream Child Relationships.
   */
  static getChildRelationships(describe) {
    const children = [];

    for (const rel of describe.childRelationships) {
      if (rel.relationshipName && !rel.deprecatedAndHidden) {
        children.push({
          relationshipName: rel.relationshipName,
          childObjectApiName: rel.childSObject,
          childObjectLabel: rel.relationshipName,
          foreignKeyField: rel.field,
          selected: false,
          selectedFields: []
        });
      }
    }

    return children.sort((a, b) => a.relationshipName.localeCompare(b.relationshipName));
  }

  /**
   * Compares source and target object describes, flagging missing custom fields.
   */
  static reconcileSchemas(sourceDescribe, targetDescribe) {
    const targetFieldsMap = new Map();
    for (const tf of targetDescribe.fields) {
      targetFieldsMap.set(tf.name.toLowerCase(), tf);
    }

    const fieldMappings = [];

    for (const sf of sourceDescribe.fields) {
      const targetField = targetFieldsMap.get(sf.name.toLowerCase());

      if (!targetField) {
        fieldMappings.push({
          fieldApiName: sf.name,
          fieldLabel: sf.label,
          sourceType: sf.type,
          targetType: 'N/A',
          status: 'MISSING_IN_TARGET',
          isCreateableInTarget: false,
          isRequiredInSource: !sf.nillable && sf.createable,
          selected: false
        });
        continue;
      }

      if (!targetField.createable) {
        fieldMappings.push({
          fieldApiName: sf.name,
          fieldLabel: sf.label,
          sourceType: sf.type,
          targetType: targetField.type,
          status: 'READ_ONLY_TARGET',
          isCreateableInTarget: false,
          isRequiredInSource: !sf.nillable && sf.createable,
          selected: false
        });
        continue;
      }

      if (sf.type !== targetField.type) {
        fieldMappings.push({
          fieldApiName: sf.name,
          fieldLabel: sf.label,
          sourceType: sf.type,
          targetType: targetField.type,
          status: 'TYPE_MISMATCH',
          isCreateableInTarget: targetField.createable,
          isRequiredInSource: !sf.nillable && sf.createable,
          selected: true
        });
        continue;
      }

      fieldMappings.push({
        fieldApiName: sf.name,
        fieldLabel: sf.label,
        sourceType: sf.type,
        targetType: targetField.type,
        status: 'MATCH',
        isCreateableInTarget: targetField.createable,
        isRequiredInSource: !sf.nillable && sf.createable,
        selected: true
      });
    }

    return fieldMappings;
  }

  static async getCachedDescribe(cacheKey) {
    try {
      const result = await chrome.storage.local.get(cacheKey);
      const entry = result[cacheKey];
      if (entry && Date.now() - entry.cachedAt < entry.ttlMs) {
        return entry.describe;
      }
    } catch {
      // ignore
    }
    return null;
  }

  static async setCachedDescribe(cacheKey, describe, ttlMs) {
    try {
      const entry = { describe, cachedAt: Date.now(), ttlMs };
      await chrome.storage.local.set({ [cacheKey]: entry });
    } catch {
      // ignore
    }
  }
}
