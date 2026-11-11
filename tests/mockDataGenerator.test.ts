import { describe, expect, it } from 'vitest';
import { MockDataGenerator } from '../src/mockDataGenerator';
import { SObjectDescribe } from '../src/types';

describe('MockDataGenerator', () => {
  const accountDescribe: SObjectDescribe = {
    name: 'Account',
    label: 'Account',
    custom: false,
    fields: [
      { name: 'Id', label: 'Account ID', type: 'id', createable: false, nillable: false, updateable: false, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'Name', label: 'Account Name', type: 'string', createable: true, nillable: false, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'BillingCity', label: 'Billing City', type: 'string', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'BillingState', label: 'Billing State', type: 'string', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'AnnualRevenue', label: 'Annual Revenue', type: 'currency', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      {
        name: 'Type',
        label: 'Type',
        type: 'picklist',
        createable: true,
        nillable: true,
        updateable: true,
        calculated: false,
        referenceTo: [],
        childRelationship: false,
        picklistValues: [
          { active: true, defaultValue: true, label: 'Customer - Direct', value: 'Customer - Direct' },
          { active: true, defaultValue: false, label: 'Customer - Channel', value: 'Customer - Channel' }
        ]
      }
    ],
    childRelationships: []
  };

  const contactDescribe: SObjectDescribe = {
    name: 'Contact',
    label: 'Contact',
    custom: false,
    fields: [
      { name: 'Id', label: 'Contact ID', type: 'id', createable: false, nillable: false, updateable: false, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'FirstName', label: 'First Name', type: 'string', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'LastName', label: 'Last Name', type: 'string', createable: true, nillable: false, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'Email', label: 'Email', type: 'email', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'Phone', label: 'Phone', type: 'phone', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
      { name: 'AccountId', label: 'Account ID', type: 'reference', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: ['Account'], childRelationship: false }
    ],
    childRelationships: []
  };

  it('generates a single synthetic record adhering to field types and picklist constraints', () => {
    const mockAcct = MockDataGenerator.generateSingleRecord(accountDescribe, 1);

    expect(mockAcct.Name).toBeDefined();
    expect(typeof mockAcct.Name).toBe('string');
    expect(mockAcct.BillingCity).toBeDefined();
    expect(mockAcct.AnnualRevenue).toBe(1250);
    expect(['Customer - Direct', 'Customer - Channel']).toContain(mockAcct.Type);
    expect(mockAcct.Id).toBeUndefined(); // Id is not createable
  });

  it('generates 3-tier synthetic dataset with parent lookups and child relationships linked', () => {
    const parentDescribes = new Map<string, SObjectDescribe>();
    parentDescribes.set('Account', accountDescribe);

    const childDescribes = new Map<string, SObjectDescribe>();
    // For this test, Contact is Root, Account is Parent
    const dataset = MockDataGenerator.generate3TierDataset({
      rootDescribe: contactDescribe,
      parentConfigs: [
        {
          relationshipName: 'Account',
          fieldApiName: 'AccountId',
          parentObjectApiName: 'Account',
          parentObjectLabel: 'Account',
          isRequired: true,
          selected: true
        }
      ],
      parentDescribes,
      childConfigs: [],
      childDescribes,
      rootCount: 5
    });

    expect(dataset.rootRecords).toHaveLength(5);
    expect(dataset.parentRecordMap.size).toBeGreaterThan(0);

    for (const rootRec of dataset.rootRecords) {
      expect(rootRec.AccountId).toBeDefined();
      expect(dataset.parentRecordMap.has(rootRec.AccountId as string)).toBe(true);
      expect(rootRec.LastName).toBeDefined();
      expect(rootRec.Email).toContain('@');
      expect(rootRec.Phone).toContain('(555) 012-');
    }
  });

  it('safely bypasses Latitudes, Longitudes, GeocodeAccuracy, and empty optional picklists', () => {
    const complexDescribe: SObjectDescribe = {
      name: 'Account',
      label: 'Account',
      custom: false,
      fields: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, nillable: false, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
        { name: 'BillingLatitude', label: 'Billing Latitude', type: 'double', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
        { name: 'BillingLongitude', label: 'Billing Longitude', type: 'double', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
        { name: 'BillingGeocodeAccuracy', label: 'Geocode Accuracy', type: 'picklist', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
        { name: 'CleanStatus', label: 'Clean Status', type: 'picklist', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
        { name: 'Location__Latitude__s', label: 'Custom Lat', type: 'double', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false },
        { name: 'Restricted_Empty_Picklist__c', label: 'Empty Picklist', type: 'picklist', createable: true, nillable: true, updateable: true, calculated: false, referenceTo: [], childRelationship: false, picklistValues: [] }
      ],
      childRelationships: []
    };

    const mock = MockDataGenerator.generateSingleRecord(complexDescribe, 1);

    expect(mock.Name).toBeDefined();
    expect(mock.BillingLatitude).toBeUndefined();
    expect(mock.BillingLongitude).toBeUndefined();
    expect(mock.BillingGeocodeAccuracy).toBeUndefined();
    expect(mock.CleanStatus).toBeUndefined();
    expect(mock.Location__Latitude__s).toBeUndefined();
    expect(mock.Restricted_Empty_Picklist__c).toBeUndefined();
  });
});
