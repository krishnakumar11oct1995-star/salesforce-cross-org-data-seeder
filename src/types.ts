/**
 * Type Definitions for Salesforce Data Seeding Chrome Extension (Manifest V3)
 */

export interface SalesforceOrgSession {
  orgId?: string;
  userId?: string;
  instanceUrl: string;
  sessionId: string;
  domain: string;
  isSandbox: boolean;
  orgName?: string;
  source: 'cookie' | 'oauth';
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string;
  signature: string;
  issued_at: string;
  token_type: string;
  scope?: string;
}

export interface StoredTargetOrg {
  alias: string;
  instanceUrl: string;
  loginUrl: string;
  accessToken: string;
  refreshToken?: string;
  issuedAt: number;
  expiresIn?: number;
  clientId: string;
  userId?: string;
  orgId?: string;
  isCustomDomain?: boolean;
}

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/* ==================== Schema & Metadata Types ==================== */

export interface RecordTypeInfo {
  recordTypeId: string;
  name: string;
  developerName?: string;
  available: boolean;
  defaultRecordTypeMapping: boolean;
  master: boolean;
  active?: boolean;
}

export interface FieldDescribe {
  name: string;
  label: string;
  type: string;
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  calculated: boolean;
  idLookup: boolean;
  unique: boolean;
  custom: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  length?: number;
}

export interface ChildRelationshipDescribe {
  childSObject: string;
  field: string;
  relationshipName: string | null;
  cascadeDelete: boolean;
}

export interface SObjectDescribe {
  name: string;
  label: string;
  keyPrefix: string | null;
  custom: boolean;
  createable: boolean;
  queryable: boolean;
  fields: FieldDescribe[];
  childRelationships: ChildRelationshipDescribe[];
  recordTypeInfos?: RecordTypeInfo[];
}

export interface CachedSchemaEntry {
  describe: SObjectDescribe;
  cachedAt: number;
  ttlMs: number;
}

export interface ParentRelationshipConfig {
  relationshipName: string;
  fieldApiName: string;
  parentObjectApiName: string;
  parentObjectLabel: string;
  isRequired: boolean;
  selected: boolean;
  externalIdField?: string;
}

export interface ChildRelationshipConfig {
  relationshipName: string;
  childObjectApiName: string;
  childObjectLabel: string;
  foreignKeyField: string;
  selected: boolean;
  selectedFields: string[];
}

export interface FieldMappingItem {
  fieldApiName: string;
  fieldLabel: string;
  sourceType: string;
  targetType: string;
  status: 'MATCH' | 'TYPE_MISMATCH' | 'MISSING_IN_TARGET' | 'READ_ONLY_TARGET';
  isCreateableInTarget: boolean;
  isRequiredInSource: boolean;
  selected: boolean;
}

/* ==================== Anonymization & Transformation Types ==================== */

export interface PiiMaskingConfig {
  maskEmails: boolean;
  maskPhones: boolean;
  anonymizeNames: boolean;
}

export interface AdvancedSeedingOptions {
  autoMapRecordTypes: boolean;
  reassignOwnerToTargetUser: boolean;
  piiMasking: PiiMaskingConfig;
  staticFieldOverrides?: Record<string, Record<string, unknown>>; // SObject -> { Field: Value }
}

/* ==================== Seeding Recipe (Template) Types ==================== */

export interface SeedingRecipe {
  id: string;
  name: string;
  description?: string;
  rootObject: string;
  recordLimit: number;
  whereClause: string;
  selectedParents: string[]; // List of fieldApiNames
  selectedChildren: string[]; // List of relationshipNames
  options: AdvancedSeedingOptions;
  createdAt: number;
}

/* ==================== Composite Graph API Types ==================== */

export interface CompositeSubrequest {
  url: string;
  method: 'POST' | 'PATCH' | 'GET' | 'DELETE';
  referenceId: string;
  body?: Record<string, unknown>;
}

export interface CompositeGraph {
  graphId: string;
  compositeRequest: CompositeSubrequest[];
}

export interface CompositeGraphPayload {
  graphs: CompositeGraph[];
}

export interface CompositeSubrequestResponse {
  body: Record<string, unknown> | Array<Record<string, unknown>> | null;
  httpHeaders: Record<string, string>;
  httpStatusCode: number;
  referenceId: string;
}

export interface CompositeGraphResponseItem {
  graphId: string;
  graphResponse: {
    compositeResponse: CompositeSubrequestResponse[];
  };
  isSuccessful: boolean;
}

export interface CompositeGraphApiResponse {
  graphs: CompositeGraphResponseItem[];
}

export interface SObjectRecordData {
  attributes?: { type: string; url: string };
  Id?: string;
  [key: string]: unknown;
}

/* ==================== Extension Message Contracts ==================== */

export type ExtensionMessageType =
  | 'GET_ACTIVE_ORG_SESSION'
  | 'LOGIN_SOURCE_ORG'
  | 'GET_TARGET_ORGS'
  | 'CONNECT_TARGET_ORG_DIRECT'
  | 'DISCONNECT_TARGET_ORG'
  | 'GET_RECIPES'
  | 'SAVE_RECIPE'
  | 'DELETE_RECIPE'
  | 'PURGE_SEEDED_DATA'
  | 'OPEN_SIDE_PANEL'
  | 'HEALTH_CHECK';

export interface ExtensionMessage<T = unknown> {
  type: ExtensionMessageType;
  payload?: T;
}

export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
