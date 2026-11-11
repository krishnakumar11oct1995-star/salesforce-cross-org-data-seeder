/**
 * GraphBuilder: Constructs Salesforce REST Composite Graph payloads (/services/data/v61.0/composite/graph).
 * Supports 3-tier hierarchy (Parent -> Root -> Child), RecordType DeveloperName translation,
 * OwnerId re-assignment, PII Anonymization, and in-graph parent deduplication.
 */

import {
  ChildRelationshipConfig,
  CompositeGraph,
  CompositeGraphPayload,
  CompositeSubrequest,
  ParentRelationshipConfig,
  PiiMaskingConfig,
  SObjectRecordData
} from './types';

export interface PicklistFieldMeta {
  restricted: boolean;
  nillable: boolean;
  activeValues: Set<string>;
  defaultValue?: string;
}

export interface GraphBuildOptions {
  rootObjectApiName: string;
  rootRecords: SObjectRecordData[];
  parentConfigs: ParentRelationshipConfig[];
  childConfigs: ChildRelationshipConfig[];
  parentRecordMap?: Map<string, SObjectRecordData>;
  targetExistingParentIds?: Map<string, string>; // Source Parent ID -> Target Existing Record ID
  targetValidFieldsPerObject?: Map<string, Set<string>>;
  targetPicklistsPerObject?: Map<string, Map<string, PicklistFieldMeta>>; // SObject -> (lowerFieldName -> meta)
  externalIdFieldPerObject?: Map<string, string>;
  recordTypeMapPerObject?: Map<string, Map<string, string>>; // SObject -> (SourceRTId -> TargetRTId)
  targetOwnerId?: string;
  piiMasking?: PiiMaskingConfig;
  staticFieldOverrides?: Map<string, Record<string, unknown>>;
  maxNodesPerGraph?: number;
  maxGraphsPerPayload?: number;
}

export class GraphBuilder {
  private static API_VERSION = 'v61.0';
  private static AUDIT_FIELDS = new Set([
    'id',
    'createddate',
    'createdbyid',
    'lastmodifieddate',
    'lastmodifiedbyid',
    'systemmodstamp',
    'isdeleted',
    'attributes'
  ]);

  /**
   * Builds an array of Composite Graph payloads chunked according to Salesforce API limits.
   */
  public static buildPayloadBatches(options: GraphBuildOptions): CompositeGraphPayload[] {
    const {
      rootObjectApiName,
      rootRecords,
      parentConfigs,
      childConfigs,
      parentRecordMap = new Map(),
      targetExistingParentIds = new Map(),
      targetValidFieldsPerObject = new Map(),
      targetPicklistsPerObject = new Map(),
      externalIdFieldPerObject = new Map(),
      recordTypeMapPerObject = new Map(),
      targetOwnerId,
      piiMasking = { maskEmails: false, maskPhones: false, anonymizeNames: false },
      staticFieldOverrides = new Map(),
      maxNodesPerGraph = 500,
      maxGraphsPerPayload = 15
    } = options;

    const allGraphs: CompositeGraph[] = [];
    let currentGraphIdIndex = 1;

    for (let rIdx = 0; rIdx < rootRecords.length; rIdx++) {
      const rootRec = rootRecords[rIdx];
      const sourceRootId = rootRec.Id || `root_${rIdx + 1}`;
      const graphRequests: CompositeSubrequest[] = [];
      const parentSubrequestRegistry = new Set<string>();

      // 1. TIER 1: Process Upstream Parents needed by Root OR Children
      const allParentIdsNeeded = new Set<string>();

      // Parents referenced by Root record
      for (const parentConfig of parentConfigs) {
        if (!parentConfig.selected) continue;
        const parentLookupVal = rootRec[parentConfig.fieldApiName] as string | undefined;
        if (parentLookupVal) allParentIdsNeeded.add(parentLookupVal);
      }

      // Parents referenced by Child records (cross-tier lookup dependencies)
      for (const childConfig of childConfigs) {
        if (!childConfig.selected) continue;
        const childRelName = childConfig.relationshipName;
        const childData = rootRec[childRelName] as { records?: SObjectRecordData[] } | SObjectRecordData[] | undefined;
        const childRecordsList: SObjectRecordData[] = Array.isArray(childData)
          ? childData
          : (childData && typeof childData === 'object' && Array.isArray(childData.records))
            ? childData.records
            : [];

        for (const childRec of childRecordsList) {
          for (const [, val] of Object.entries(childRec)) {
            if (typeof val === 'string' && (parentRecordMap.has(val) || (targetExistingParentIds && targetExistingParentIds.has(val)))) {
              allParentIdsNeeded.add(val);
            }
          }
        }
      }

      // Generate Tier 1 Parent Subrequests (Topologically Ordered)
      const emitParentSubrequest = (parentId: string) => {
        if (!parentRecordMap.has(parentId)) return;
        if (targetExistingParentIds && targetExistingParentIds.has(parentId)) return;

        const parentRec = parentRecordMap.get(parentId)!;
        const parentObject = (parentRec.attributes?.type as string) ||
          parentConfigs.find(p => p.selected && rootRec[p.fieldApiName] === parentId)?.parentObjectApiName ||
          'Parent';
        const parentRefId = `ref_Parent_${parentObject}_${parentId.substring(0, 15)}`;

        if (parentSubrequestRegistry.has(parentRefId)) return;

        // Recursively emit any upstream parents referenced by this parent record
        for (const [, val] of Object.entries(parentRec)) {
          if (typeof val === 'string' && parentRecordMap.has(val) && val !== parentId) {
            emitParentSubrequest(val);
          }
        }

        const parentSubreq = this.createSubrequest({
          objectApiName: parentObject,
          record: parentRec,
          referenceId: parentRefId,
          extIdField: externalIdFieldPerObject.get(parentObject),
          validFields: targetValidFieldsPerObject.get(parentObject),
          targetPicklistMap: targetPicklistsPerObject.get(parentObject),
          recordTypeMap: recordTypeMapPerObject.get(parentObject),
          targetOwnerId,
          piiMasking,
          staticOverrides: staticFieldOverrides.get(parentObject),
          targetExistingParentIds,
          parentRecordMap
        });

        graphRequests.push(parentSubreq);
        parentSubrequestRegistry.add(parentRefId);
      };

      for (const parentId of allParentIdsNeeded) {
        emitParentSubrequest(parentId);
      }

      // 2. TIER 2: Process Root Record
      const rootRefId = `ref_${rootObjectApiName}_${sourceRootId.substring(0, 15)}`;
      const rootSanitizedBody = this.sanitizeRecordFields({
        objectApiName: rootObjectApiName,
        record: rootRec,
        validTargetFields: targetValidFieldsPerObject.get(rootObjectApiName),
        targetPicklistMap: targetPicklistsPerObject.get(rootObjectApiName),
        recordTypeMap: recordTypeMapPerObject.get(rootObjectApiName),
        targetOwnerId,
        piiMasking,
        staticOverrides: staticFieldOverrides.get(rootObjectApiName)
      });

      // Link root lookup fields to Parent reference IDs or existing target parent IDs
      for (const parentConfig of parentConfigs) {
        if (!parentConfig.selected) continue;

        const parentLookupVal = rootRec[parentConfig.fieldApiName] as string | undefined;
        if (parentLookupVal) {
          if (targetExistingParentIds && targetExistingParentIds.has(parentLookupVal)) {
            // Directly link to target existing parent ID!
            rootSanitizedBody[parentConfig.fieldApiName] = targetExistingParentIds.get(parentLookupVal);
          } else if (parentRecordMap.has(parentLookupVal)) {
            // Link to newly created parent subrequest reference
            const parentObject = (parentRecordMap.get(parentLookupVal)?.attributes?.type as string) || parentConfig.parentObjectApiName;
            const parentRefId = `ref_Parent_${parentObject}_${parentLookupVal.substring(0, 15)}`;
            rootSanitizedBody[parentConfig.fieldApiName] = `@{${parentRefId}.id}`;
          }
        }
      }

      const rootSubreq = this.createSubrequest({
        objectApiName: rootObjectApiName,
        record: rootSanitizedBody,
        referenceId: rootRefId,
        sourceRecordId: sourceRootId,
        extIdField: externalIdFieldPerObject.get(rootObjectApiName),
        validFields: targetValidFieldsPerObject.get(rootObjectApiName),
        alreadySanitized: true
      });
      graphRequests.push(rootSubreq);

      // 3. TIER 3: Process Child Sub-Trees
      for (const childConfig of childConfigs) {
        if (!childConfig.selected) continue;

        const childRelName = childConfig.relationshipName;
        const childObject = childConfig.childObjectApiName;
        const childData = rootRec[childRelName] as { records?: SObjectRecordData[] } | SObjectRecordData[] | undefined;

        let childRecordsList: SObjectRecordData[] = [];
        if (childData && Array.isArray(childData)) {
          childRecordsList = childData;
        } else if (childData && typeof childData === 'object' && Array.isArray(childData.records)) {
          childRecordsList = childData.records;
        }

        let childCounter = 1;
        for (const childRec of childRecordsList) {
          const childRefId = `ref_${childObject}_${sourceRootId.substring(0, 8)}_${childCounter++}`;
          const childSanitized = this.sanitizeRecordFields({
            objectApiName: childObject,
            record: childRec,
            validTargetFields: targetValidFieldsPerObject.get(childObject),
            targetPicklistMap: targetPicklistsPerObject.get(childObject),
            fieldWhitelist: childConfig.selectedFields,
            recordTypeMap: recordTypeMapPerObject.get(childObject),
            targetOwnerId,
            piiMasking,
            staticOverrides: staticFieldOverrides.get(childObject)
          });

          // 1. Point child foreign key to Root Record reference
          childSanitized[childConfig.foreignKeyField] = `@{${rootRefId}.id}`;

          // 2. Resolve cross-tier parent references or target matched IDs on child lookup fields
          for (const [key, val] of Object.entries(childRec)) {
            if (typeof val === 'string') {
              if (targetExistingParentIds && targetExistingParentIds.has(val)) {
                // Directly link to target existing parent ID!
                childSanitized[key] = targetExistingParentIds.get(val);
              } else if (parentRecordMap.has(val)) {
                // Link to Tier 1 parent subrequest reference!
                const parentRec = parentRecordMap.get(val)!;
                const parentObject = (parentRec.attributes?.type as string) ||
                  parentConfigs.find(p => p.selected && rootRec[p.fieldApiName] === val)?.parentObjectApiName ||
                  'Parent';
                const parentRefId = `ref_Parent_${parentObject}_${val.substring(0, 15)}`;
                childSanitized[key] = `@{${parentRefId}.id}`;
              }
            }
          }

          const childSubreq = this.createSubrequest({
            objectApiName: childObject,
            record: childSanitized,
            referenceId: childRefId,
            sourceRecordId: childRec.Id,
            extIdField: externalIdFieldPerObject.get(childObject),
            validFields: targetValidFieldsPerObject.get(childObject),
            alreadySanitized: true
          });
          graphRequests.push(childSubreq);

          if (graphRequests.length >= maxNodesPerGraph) break;
        }
      }

      allGraphs.push({
        graphId: `graph_${rootObjectApiName}_${currentGraphIdIndex++}`,
        compositeRequest: graphRequests
      });
    }

    // Chunk graphs into batches of up to maxGraphsPerPayload (15 graphs per batch)
    const payloadBatches: CompositeGraphPayload[] = [];
    for (let i = 0; i < allGraphs.length; i += maxGraphsPerPayload) {
      payloadBatches.push({
        graphs: allGraphs.slice(i, i + maxGraphsPerPayload)
      });
    }

    return payloadBatches;
  }

  private static createSubrequest(params: {
    objectApiName: string;
    record: SObjectRecordData;
    referenceId: string;
    sourceRecordId?: string;
    extIdField?: string;
    validFields?: Set<string>;
    targetPicklistMap?: Map<string, PicklistFieldMeta>;
    recordTypeMap?: Map<string, string>;
    targetOwnerId?: string;
    piiMasking?: PiiMaskingConfig;
    staticOverrides?: Record<string, unknown>;
    alreadySanitized?: boolean;
    targetExistingParentIds?: Map<string, string>;
    parentRecordMap?: Map<string, SObjectRecordData>;
  }): CompositeSubrequest {
    const { objectApiName, record, referenceId, extIdField, validFields, targetPicklistMap, recordTypeMap, targetOwnerId, piiMasking, staticOverrides, alreadySanitized, targetExistingParentIds, parentRecordMap } = params;
    const body = alreadySanitized
      ? { ...record }
      : this.sanitizeRecordFields({
          objectApiName,
          record,
          validTargetFields: validFields,
          targetPicklistMap,
          recordTypeMap,
          targetOwnerId,
          piiMasking,
          staticOverrides,
          targetExistingParentIds,
          parentRecordMap
        });

    const extIdVal = extIdField ? (record[extIdField] as string | undefined) : undefined;

    if (extIdField && extIdVal && extIdField.toLowerCase() !== 'id') {
      const cleanBody = { ...body };
      delete cleanBody[extIdField];

      return {
        url: `/services/data/${this.API_VERSION}/sobjects/${objectApiName}/${extIdField}/${encodeURIComponent(extIdVal)}`,
        method: 'PATCH',
        referenceId,
        body: cleanBody
      };
    }

    return {
      url: `/services/data/${this.API_VERSION}/sobjects/${objectApiName}`,
      method: 'POST',
      referenceId,
      body
    };
  }

  public static sanitizeRecordFields(params: {
    objectApiName?: string;
    record: SObjectRecordData;
    validTargetFields?: Set<string>;
    targetPicklistMap?: Map<string, PicklistFieldMeta>;
    fieldWhitelist?: string[];
    recordTypeMap?: Map<string, string>;
    targetOwnerId?: string;
    piiMasking?: PiiMaskingConfig;
    staticOverrides?: Record<string, unknown>;
    targetExistingParentIds?: Map<string, string>;
    parentRecordMap?: Map<string, SObjectRecordData>;
  }): Record<string, unknown> {
    const {
      record,
      validTargetFields,
      targetPicklistMap,
      fieldWhitelist,
      recordTypeMap,
      targetOwnerId,
      piiMasking = { maskEmails: false, maskPhones: false, anonymizeNames: false },
      staticOverrides,
      targetExistingParentIds,
      parentRecordMap
    } = params;

    const sanitized: Record<string, unknown> = {};
    const isPersonAccount = record['IsPersonAccount'] === true || Boolean(record['FirstName'] || record['LastName'] || record['PersonContactId']);
    const whitelistSet = fieldWhitelist && fieldWhitelist.length > 0 ? new Set(fieldWhitelist.map(f => f.toLowerCase())) : null;
    const recordUniqueSeed = (record.Id || Math.random().toString(36).substring(7)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);

    for (const [key, value] of Object.entries(record)) {
      const lowerKey = key.toLowerCase();

      if (this.AUDIT_FIELDS.has(lowerKey) || (typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).records !== undefined)) {
        continue;
      }

      if (value === null || value === undefined) continue;
      if (whitelistSet && !whitelistSet.has(lowerKey)) continue;
      if (validTargetFields && !validTargetFields.has(lowerKey)) continue;
      if (!isPersonAccount && lowerKey.endsWith('__pc')) continue;
      if (isPersonAccount && lowerKey === 'name') continue; // Standard Name is calculated on Person Accounts (FirstName + LastName)

      let transformedVal = value;

      // 1. RecordTypeId Translation
      if (lowerKey === 'recordtypeid' && recordTypeMap && typeof value === 'string') {
        const mappedRT = recordTypeMap.get(value);
        if (mappedRT) {
          transformedVal = mappedRT;
        }
      }

      // 1b. Picklist Validation & Schema Drift Resolution (prevents "bad value for restricted picklist field")
      if (targetPicklistMap && targetPicklistMap.has(lowerKey) && typeof transformedVal === 'string') {
        const pMeta = targetPicklistMap.get(lowerKey)!;
        if (pMeta.restricted && !pMeta.activeValues.has(transformedVal)) {
          if (pMeta.nillable) {
            continue; // Optional field: strip invalid value to allow clean record insertion
          } else if (pMeta.defaultValue) {
            transformedVal = pMeta.defaultValue; // Required field: fallback to active default
          }
        }
      }

      // 2. OwnerId Reassignment & Inactive User Protection
      if (lowerKey === 'ownerid') {
        if (targetOwnerId) {
          transformedVal = targetOwnerId;
        } else {
          continue; // Strip OwnerId so target Salesforce assigns the active context user
        }
      }

      // 2b. Map or strip foreign source lookup IDs (e.g. 500... Case IDs, or parent lookups like CM_Payer__c, Provider__c)
      if (
        typeof value === 'string' &&
        !value.startsWith('@{') &&
        (lowerKey.endsWith('__c') || lowerKey.endsWith('id')) &&
        lowerKey !== 'id' &&
        lowerKey !== 'recordtypeid' &&
        lowerKey !== 'ownerid'
      ) {
        if (targetExistingParentIds && targetExistingParentIds.has(value)) {
          transformedVal = targetExistingParentIds.get(value)!;
        } else if (parentRecordMap && parentRecordMap.has(value)) {
          const pRec = parentRecordMap.get(value)!;
          const pObj = (pRec.attributes?.type as string) || 'Parent';
          transformedVal = `@{ref_Parent_${pObj}_${value.substring(0, 15)}.id}`;
        } else if (/^[a-zA-Z0-9_]{15,18}$/.test(value)) {
          // Unmapped foreign lookup ID from source org — strip to prevent "insufficient access rights on cross-reference id"
          continue;
        }
      }

      // 3. PII Masking: Emails (Only apply to actual email string values, never boolean flags like HasOptedOutOfEmail)
      if (piiMasking.maskEmails && typeof value === 'string' && typeof value !== 'boolean') {
        const isBooleanFieldName = lowerKey.startsWith('is') || lowerKey.startsWith('has') || lowerKey.includes('opt') || lowerKey.includes('bounced');
        if (!isBooleanFieldName && (value.includes('@') || lowerKey === 'email' || lowerKey.endsWith('email__c'))) {
          transformedVal = `test.user_${recordUniqueSeed}@example.invalid`;
        }
      }

      // 4. PII Masking: Phones (Only apply to phone string values, never booleans like HasOptedOutOfFax)
      if (piiMasking.maskPhones && typeof value === 'string' && typeof value !== 'boolean') {
        const isBooleanFieldName = lowerKey.startsWith('is') || lowerKey.startsWith('has') || lowerKey.includes('opt') || lowerKey.includes('donot');
        if (!isBooleanFieldName && (lowerKey.includes('phone') || lowerKey.includes('mobile') || lowerKey.includes('fax'))) {
          transformedVal = `(555) 019-${recordUniqueSeed.substring(0, 4)}`;
        }
      }

      // 5. PII Masking: Names
      if (piiMasking.anonymizeNames && typeof value === 'string') {
        if (lowerKey === 'firstname') transformedVal = `TestUser_${recordUniqueSeed}`;
        if (lowerKey === 'lastname') transformedVal = `Sample_${recordUniqueSeed}`;
        if (lowerKey === 'name' && !lowerKey.includes('developer') && !lowerKey.includes('type')) {
          transformedVal = `Test Record ${recordUniqueSeed}`;
        }
      }

      sanitized[key] = transformedVal;
    }

    // Apply Static Overrides
    if (staticOverrides) {
      for (const [overrideKey, overrideVal] of Object.entries(staticOverrides)) {
        sanitized[overrideKey] = overrideVal;
      }
    }

    return sanitized;
  }
}
