import { describe, it, expect } from 'vitest';
import { RecipeManager } from '../src/recipeManager';
import { SObjectDescribe } from '../src/types';

describe('RecipeManager', () => {
  it('builds RecordType translation map matched by DeveloperName', () => {
    const sourceDescribe: SObjectDescribe = {
      name: 'Account',
      label: 'Account',
      keyPrefix: '001',
      custom: false,
      createable: true,
      queryable: true,
      fields: [],
      childRelationships: [],
      recordTypeInfos: [
        {
          recordTypeId: '012_SOURCE_PATIENT',
          name: 'Patient Account',
          developerName: 'Patient_Account',
          available: true,
          defaultRecordTypeMapping: false,
          master: false
        },
        {
          recordTypeId: '012_SOURCE_PROVIDER',
          name: 'Provider Account',
          developerName: 'Provider_Account',
          available: true,
          defaultRecordTypeMapping: false,
          master: false
        }
      ]
    };

    const targetDescribe: SObjectDescribe = {
      name: 'Account',
      label: 'Account',
      keyPrefix: '001',
      custom: false,
      createable: true,
      queryable: true,
      fields: [],
      childRelationships: [],
      recordTypeInfos: [
        {
          recordTypeId: '012_TARGET_PATIENT_SANDBOX',
          name: 'Patient Account',
          developerName: 'Patient_Account',
          available: true,
          defaultRecordTypeMapping: false,
          master: false
        },
        {
          recordTypeId: '012_TARGET_PROVIDER_SANDBOX',
          name: 'Provider Account',
          developerName: 'Provider_Account',
          available: true,
          defaultRecordTypeMapping: false,
          master: false
        }
      ]
    };

    const rtMap = RecipeManager.buildRecordTypeTranslationMap(sourceDescribe, targetDescribe);

    expect(rtMap.size).toBe(2);
    expect(rtMap.get('012_SOURCE_PATIENT')).toBe('012_TARGET_PATIENT_SANDBOX');
    expect(rtMap.get('012_SOURCE_PROVIDER')).toBe('012_TARGET_PROVIDER_SANDBOX');
  });
});
