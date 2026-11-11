/**
 * useSeederStore: Central Zustand store for the Salesforce Data Seeder Extension.
 * Handles state synchronization and session persistence via chrome.storage.session.
 */

import { create } from 'zustand';
import {
  ChildRelationshipConfig,
  FieldMappingItem,
  ParentRelationshipConfig,
  SalesforceOrgSession,
  SObjectDescribe,
  StoredTargetOrg
} from '../types';

export interface StorageEstimation {
  rootCount: number;
  parentCount: number;
  childCount: number;
  totalRecords: number;
  estimatedKb: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface ExecutionProgress {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalBatches: number;
  completedBatches: number;
  successfulGraphs: number;
  failedGraphs: number;
  totalRecordsProcessed: number;
  errors: string[];
}

export interface SeederState {
  currentStep: number;
  isLoading: boolean;
  loadingMessage: string;

  // Step 1: Orgs
  sourceSession: SalesforceOrgSession | null;
  targetOrgs: StoredTargetOrg[];
  selectedTargetAlias: string;
  targetExternalIdField: string;

  // Step 2: Root Object
  eligibleObjects: Array<{ name: string; label: string; custom: boolean }>;
  selectedRootObject: string;
  whereClause: string;
  recordLimit: number;

  // Step 3: Relationships
  rootDescribe: SObjectDescribe | null;
  parentConfigs: ParentRelationshipConfig[];
  childConfigs: ChildRelationshipConfig[];

  // Step 4: Schema & Storage
  fieldMappings: FieldMappingItem[];
  storageEstimation: StorageEstimation;
  targetQuotaMb: number;

  // Step 5: Execution
  executionProgress: ExecutionProgress;
  logs: LogEntry[];

  // Actions
  setStep: (step: number) => void;
  setLoading: (loading: boolean, msg?: string) => void;
  setSourceSession: (session: SalesforceOrgSession | null) => void;
  setTargetOrgs: (orgs: StoredTargetOrg[]) => void;
  setSelectedTargetAlias: (alias: string) => void;
  setTargetExternalIdField: (field: string) => void;
  setEligibleObjects: (objs: Array<{ name: string; label: string; custom: boolean }>) => void;
  setSelectedRootObject: (obj: string) => void;
  setWhereClause: (clause: string) => void;
  setRecordLimit: (limit: number) => void;
  setRootDescribe: (describe: SObjectDescribe | null) => void;
  setParentConfigs: (parents: ParentRelationshipConfig[]) => void;
  toggleParentSelection: (fieldApiName: string) => void;
  setChildConfigs: (children: ChildRelationshipConfig[]) => void;
  toggleChildSelection: (relationshipName: string) => void;
  setFieldMappings: (mappings: FieldMappingItem[]) => void;
  updateStorageEstimation: (estimation: StorageEstimation) => void;
  setTargetQuotaMb: (quota: number) => void;
  setExecutionProgress: (progress: Partial<ExecutionProgress>) => void;
  addLog: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  clearLogs: () => void;
  resetState: () => void;
}

const INITIAL_PROGRESS: ExecutionProgress = {
  status: 'IDLE',
  totalBatches: 0,
  completedBatches: 0,
  successfulGraphs: 0,
  failedGraphs: 0,
  totalRecordsProcessed: 0,
  errors: []
};

const INITIAL_STORAGE: StorageEstimation = {
  rootCount: 0,
  parentCount: 0,
  childCount: 0,
  totalRecords: 0,
  estimatedKb: 0
};

export const useSeederStore = create<SeederState>((set, get) => ({
  currentStep: 1,
  isLoading: false,
  loadingMessage: '',

  sourceSession: null,
  targetOrgs: [],
  selectedTargetAlias: '',
  targetExternalIdField: 'Source_Record_Id__c',

  eligibleObjects: [],
  selectedRootObject: '',
  whereClause: '',
  recordLimit: 50,

  rootDescribe: null,
  parentConfigs: [],
  childConfigs: [],

  fieldMappings: [],
  storageEstimation: INITIAL_STORAGE,
  targetQuotaMb: 200,

  executionProgress: INITIAL_PROGRESS,
  logs: [],

  setStep: (step) => set({ currentStep: Math.max(1, Math.min(5, step)) }),
  setLoading: (isLoading, loadingMessage = '') => set({ isLoading, loadingMessage }),
  setSourceSession: (sourceSession) => set({ sourceSession }),
  setTargetOrgs: (targetOrgs) => set({ targetOrgs }),
  setSelectedTargetAlias: (selectedTargetAlias) => set({ selectedTargetAlias }),
  setTargetExternalIdField: (targetExternalIdField) => set({ targetExternalIdField }),

  setEligibleObjects: (eligibleObjects) => set({ eligibleObjects }),
  setSelectedRootObject: (selectedRootObject) => set({ selectedRootObject }),
  setWhereClause: (whereClause) => set({ whereClause }),
  setRecordLimit: (recordLimit) => set({ recordLimit }),

  setRootDescribe: (rootDescribe) => set({ rootDescribe }),
  setParentConfigs: (parentConfigs) => set({ parentConfigs }),
  toggleParentSelection: (fieldApiName) => {
    const parents = get().parentConfigs.map(p =>
      p.fieldApiName === fieldApiName ? { ...p, selected: !p.selected } : p
    );
    set({ parentConfigs: parents });
  },

  setChildConfigs: (childConfigs) => set({ childConfigs }),
  toggleChildSelection: (relationshipName) => {
    const children = get().childConfigs.map(c =>
      c.relationshipName === relationshipName ? { ...c, selected: !c.selected } : c
    );
    set({ childConfigs: children });
  },

  setFieldMappings: (fieldMappings) => set({ fieldMappings }),
  updateStorageEstimation: (storageEstimation) => set({ storageEstimation }),
  setTargetQuotaMb: (targetQuotaMb) => set({ targetQuotaMb }),

  setExecutionProgress: (progress) =>
    set((state) => ({ executionProgress: { ...state.executionProgress, ...progress } })),

  addLog: (message, type = 'info') =>
    set((state) => ({
      logs: [
        ...state.logs,
        {
          id: `${Date.now()}_${Math.random()}`,
          timestamp: new Date().toLocaleTimeString(),
          message,
          type
        }
      ]
    })),

  clearLogs: () => set({ logs: [] }),

  resetState: () =>
    set({
      currentStep: 1,
      selectedRootObject: '',
      whereClause: '',
      recordLimit: 50,
      rootDescribe: null,
      parentConfigs: [],
      childConfigs: [],
      fieldMappings: [],
      storageEstimation: INITIAL_STORAGE,
      executionProgress: INITIAL_PROGRESS
    })
}));
