import { describe, it, expect } from 'vitest';
import { GraphBuilder } from '../src/graphBuilder';
import {
  ChildRelationshipConfig,
  ParentRelationshipConfig,
  SObjectRecordData
} from '../src/types';

describe('GraphBuilder (Composite Graph Payload Generation)', () => {
  const mockParentConfigs: ParentRelationshipConfig[] = [
    {
      relationshipName: 'Account',
      fieldApiName: 'AccountId',
      parentObjectApiName: 'Account',
      parentObjectLabel: 'Account',
      isRequired: true,
      selected: true
    }
  ];

  const mockChildConfigs: ChildRelationshipConfig[] = [
    {
      relationshipName: 'OpportunityLineItems',
      childObjectApiName: 'OpportunityLineItem',
      childObjectLabel: 'Line Items',
      foreignKeyField: 'OpportunityId',
      selected: true,
      selectedFields: ['UnitPrice', 'Quantity']
    }
  ];

  it('preserves 3-tier relational integrity (Parent -> Root -> Child) with @{ref.id} references', () => {
    const rootRecords: SObjectRecordData[] = [
      {
        Id: '0060000001RootA',
        Name: 'Q3 Enterprise Deal',
        AccountId: '0010000001ParentA',
        StageName: 'Prospecting',
        OpportunityLineItems: [
          { Id: '00k0000001ChildA', UnitPrice: 5000, Quantity: 2 }
        ]
      }
    ];

    const parentMap = new Map<string, SObjectRecordData>();
    parentMap.set('0010000001ParentA', {
      Id: '0010000001ParentA',
      Name: 'Acme Health Corp'
    });

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Opportunity',
      rootRecords,
      parentConfigs: mockParentConfigs,
      childConfigs: mockChildConfigs,
      parentRecordMap: parentMap
    });

    expect(batches).toHaveLength(1);
    expect(batches[0].graphs).toHaveLength(1);

    const graph = batches[0].graphs[0];
    expect(graph.compositeRequest).toHaveLength(3);

    // Tier 1: Parent Subrequest
    const parentNode = graph.compositeRequest[0];
    expect(parentNode.referenceId).toBe('ref_Parent_Account_0010000001Paren');
    expect(parentNode.url).toBe('/services/data/v61.0/sobjects/Account');
    expect(parentNode.method).toBe('POST');
    expect(parentNode.body?.Name).toBe('Acme Health Corp');
    expect(parentNode.body?.Id).toBeUndefined(); // Stripped

    // Tier 2: Root Subrequest referencing Parent
    const rootNode = graph.compositeRequest[1];
    expect(rootNode.referenceId).toBe('ref_Opportunity_0060000001RootA');
    expect(rootNode.url).toBe('/services/data/v61.0/sobjects/Opportunity');
    expect(rootNode.body?.AccountId).toBe('@{ref_Parent_Account_0010000001Paren.id}');

    // Tier 3: Child Subrequest referencing Root
    const childNode = graph.compositeRequest[2];
    expect(childNode.url).toBe('/services/data/v61.0/sobjects/OpportunityLineItem');
    expect(childNode.body?.OpportunityId).toBe('@{ref_Opportunity_0060000001RootA.id}');
    expect(childNode.body?.UnitPrice).toBe(5000);
  });

  it('deduplicates shared parent records within the same composite graph', () => {
    const rootRecords: SObjectRecordData[] = [
      { Id: '0060000001Root1', Name: 'Deal 1', AccountId: '001SHARED_PARENT' },
      { Id: '0060000001Root2', Name: 'Deal 2', AccountId: '001SHARED_PARENT' }
    ];

    const parentMap = new Map<string, SObjectRecordData>();
    parentMap.set('001SHARED_PARENT', { Id: '001SHARED_PARENT', Name: 'Shared Clinic' });

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Opportunity',
      rootRecords,
      parentConfigs: mockParentConfigs,
      childConfigs: [],
      parentRecordMap: parentMap
    });

    const graph1 = batches[0].graphs[0];
    const parentNodesInGraph = graph1.compositeRequest.filter((r) =>
      r.referenceId.startsWith('ref_Parent_')
    );

    expect(parentNodesInGraph).toHaveLength(1);
    expect(parentNodesInGraph[0].referenceId).toBe('ref_Parent_Account_001SHARED_PAREN');

    expect(graph1.compositeRequest[1].body?.AccountId).toBe(
      '@{ref_Parent_Account_001SHARED_PAREN.id}'
    );
  });

  it('enforces External ID PATCH Upsert when custom external ID field is present', () => {
    const rootRecords: SObjectRecordData[] = [
      { Id: '0060000001RootX', Name: 'Upsert Deal', Legacy_Id__c: 'LEGACY_9999' }
    ];

    const extIdMap = new Map<string, string>();
    extIdMap.set('Opportunity', 'Legacy_Id__c');

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Opportunity',
      rootRecords,
      parentConfigs: [],
      childConfigs: [],
      externalIdFieldPerObject: extIdMap
    });

    const rootNode = batches[0].graphs[0].compositeRequest[0];
    expect(rootNode.method).toBe('PATCH');
    expect(rootNode.url).toBe('/services/data/v61.0/sobjects/Opportunity/Legacy_Id__c/LEGACY_9999');
    expect(rootNode.body?.Legacy_Id__c).toBeUndefined();
  });

  it('translates RecordType IDs and reassigns OwnerId across sandboxes', () => {
    const rootRecords: SObjectRecordData[] = [
      {
        Id: '0010000000SourceRec',
        Name: 'Test Corp',
        RecordTypeId: '012_SOURCE_PROD_ID',
        OwnerId: '005_OLD_INACTIVE_USER'
      }
    ];

    const rtMap = new Map<string, Map<string, string>>();
    const acctRtMap = new Map<string, string>();
    acctRtMap.set('012_SOURCE_PROD_ID', '012_TARGET_SANDBOX_ID');
    rtMap.set('Account', acctRtMap);

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Account',
      rootRecords,
      parentConfigs: [],
      childConfigs: [],
      recordTypeMapPerObject: rtMap,
      targetOwnerId: '005_CURRENT_TARGET_USER'
    });

    const body = batches[0].graphs[0].compositeRequest[0].body;
    expect(body?.RecordTypeId).toBe('012_TARGET_SANDBOX_ID');
    expect(body?.OwnerId).toBe('005_CURRENT_TARGET_USER');
  });

  it('anonymizes PII data (Emails, Phones, Names) without corrupting boolean flags', () => {
    const rawRecord: SObjectRecordData = {
      Id: '0030000000Person',
      FirstName: 'John',
      LastName: 'Doe',
      Email: 'jdoe@realpatient.com',
      Phone: '201-555-9876',
      HasOptedOutOfEmail: true,
      HasOptedOutOfFax: false,
      DoNotCall: false
    };

    const sanitized = GraphBuilder.sanitizeRecordFields({
      record: rawRecord,
      piiMasking: {
        maskEmails: true,
        maskPhones: true,
        anonymizeNames: true
      }
    });

    expect(sanitized.FirstName).toContain('TestUser_');
    expect(sanitized.LastName).toContain('Sample_');
    expect(sanitized.Email).toContain('@example.invalid');
    expect(sanitized.Phone).toContain('(555) 019-');
    expect(sanitized.HasOptedOutOfEmail).toBe(true);
    expect(sanitized.HasOptedOutOfFax).toBe(false);
    expect(sanitized.DoNotCall).toBe(false);
  });

  it('chunks large dataset into maximum 15 graphs per batch payload', () => {
    const largeRoots: SObjectRecordData[] = Array.from({ length: 45 }, (_, i) => ({
      Id: `0060000000Root_${i}`,
      Name: `Deal ${i}`
    }));

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Opportunity',
      rootRecords: largeRoots,
      parentConfigs: [],
      childConfigs: [],
      maxGraphsPerPayload: 15
    });

    expect(batches).toHaveLength(3);
    expect(batches[0].graphs).toHaveLength(15);
    expect(batches[1].graphs).toHaveLength(15);
    expect(batches[2].graphs).toHaveLength(15);
  });

  it('sanitizes Person Account fields (__pc) on standard Business Accounts', () => {
    const businessAccount: SObjectRecordData = {
      Id: '0010000000BizAcct',
      Name: 'Apex Health Systems',
      IsPersonAccount: false,
      Pregnant__pc: true,
      Surgical_Candidate__pc: false
    };

    const sanitized = GraphBuilder.sanitizeRecordFields({
      record: businessAccount
    });

    expect(sanitized.Name).toBe('Apex Health Systems');
    expect(sanitized.Pregnant__pc).toBeUndefined();
    expect(sanitized.Surgical_Candidate__pc).toBeUndefined();
    expect(sanitized.Id).toBeUndefined();
  });

  it('skips read-only Name on Person Accounts when FirstName and LastName are present', () => {
    const personAccount: SObjectRecordData = {
      Id: '0010000000Patient',
      Name: 'Jane Doe',
      FirstName: 'Jane',
      LastName: 'Doe',
      IsPersonAccount: true
    };

    const sanitized = GraphBuilder.sanitizeRecordFields({
      record: personAccount
    });

    expect(sanitized.Name).toBeUndefined();
    expect(sanitized.FirstName).toBe('Jane');
    expect(sanitized.LastName).toBe('Doe');
  });

  it('generates PATCH upsert subrequests for parents when externalIdField is mapped', () => {
    const parentRecs = new Map<string, SObjectRecordData>();
    parentRecs.set('001_PARENT_ACCT', {
      Id: '001_PARENT_ACCT',
      Name: 'Aetna Health',
      Payer_Id__c: 'PAYER_999'
    });

    const rootRecords: SObjectRecordData[] = [
      {
        Id: 'a2Y_ROOT_ENC',
        Name: 'ENC-001',
        Payer__c: '001_PARENT_ACCT'
      }
    ];

    const extIdMap = new Map<string, string>();
    extIdMap.set('Payer__c', 'Payer_Id__c');

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Encounter__c',
      rootRecords,
      parentConfigs: [
        {
          relationshipName: 'Payer__r',
          fieldApiName: 'Payer__c',
          parentObjectApiName: 'Payer__c',
          parentObjectLabel: 'Payer',
          isRequired: true,
          selected: true
        }
      ],
      childConfigs: [],
      parentRecordMap: parentRecs,
      externalIdFieldPerObject: extIdMap
    });

    const subrequests = batches[0].graphs[0].compositeRequest;
    const parentSubreq = subrequests.find(s => s.referenceId.startsWith('ref_Parent_Payer__c'));

    expect(parentSubreq).toBeDefined();
    expect(parentSubreq?.method).toBe('PATCH');
    expect(parentSubreq?.url).toContain('/Payer_Id__c/PAYER_999');
  });

  it('skips parent subrequest and directly links root lookup when targetExistingParentIds is provided', () => {
    const parentRecs = new Map<string, SObjectRecordData>();
    parentRecs.set('001_SOURCE_ACCT_ID', {
      Id: '001_SOURCE_ACCT_ID',
      Name: 'Aetna Health',
      Payer_Id__c: 'PAYER_999'
    });

    const rootRecords: SObjectRecordData[] = [
      {
        Id: 'a2Y_ROOT_ENC',
        Name: 'ENC-001',
        Payer__c: '001_SOURCE_ACCT_ID'
      }
    ];

    const existingTargetMap = new Map<string, string>();
    existingTargetMap.set('001_SOURCE_ACCT_ID', '001_TARGET_EXISTING_PAYER_ID');

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Encounter__c',
      rootRecords,
      parentConfigs: [
        {
          relationshipName: 'Payer__r',
          fieldApiName: 'Payer__c',
          parentObjectApiName: 'Payer__c',
          parentObjectLabel: 'Payer',
          isRequired: true,
          selected: true
        }
      ],
      childConfigs: [],
      parentRecordMap: parentRecs,
      targetExistingParentIds: existingTargetMap
    });

    const subrequests = batches[0].graphs[0].compositeRequest;
    const parentSubreq = subrequests.find(s => s.referenceId.startsWith('ref_Parent_Payer__c'));
    const rootSubreq = subrequests.find(s => s.referenceId.startsWith('ref_Encounter__c'));

    // Should NOT create parent subrequest because it already exists in target
    expect(parentSubreq).toBeUndefined();

    // Root record should directly point to existing target parent ID
    expect(rootSubreq?.body?.Payer__c).toBe('001_TARGET_EXISTING_PAYER_ID');
  });

  it('strips unmapped foreign source lookup IDs and handles OwnerId safely', () => {
    const rawEncounter: SObjectRecordData = {
      Id: 'a2l0000000Root',
      Name: 'ENC-100',
      Case__c: '5005x00001pH7HGAAM', // Unmapped foreign ID
      Claim_Lookup__c: 'a0B5x0000001234EAA', // Unmapped foreign ID
      OwnerId: '0055x00000Akg4FAAR' // Inactive source owner
    };

    // Case 1: Without targetOwnerId -> OwnerId and foreign lookups stripped
    const sanitizedNoTarget = GraphBuilder.sanitizeRecordFields({
      record: rawEncounter
    });

    expect(sanitizedNoTarget.Name).toBe('ENC-100');
    expect(sanitizedNoTarget.Case__c).toBeUndefined();
    expect(sanitizedNoTarget.Claim_Lookup__c).toBeUndefined();
    expect(sanitizedNoTarget.OwnerId).toBeUndefined();

    // Case 2: With targetOwnerId -> OwnerId reassigned to target user
    const sanitizedWithTarget = GraphBuilder.sanitizeRecordFields({
      record: rawEncounter,
      targetOwnerId: '005_NEW_TARGET_USER'
    });

    expect(sanitizedWithTarget.OwnerId).toBe('005_NEW_TARGET_USER');
  });

  it('safely handles restricted picklist schema drift between sandboxes', () => {
    const rawRecord: SObjectRecordData = {
      Id: 'a2l0000000Root',
      Name: 'ENC-100',
      Rule_Group__c: 'Pain team', // Missing in target sandbox!
      Status__c: 'Archived' // Missing in target sandbox, but Status is mandatory!
    };

    const picklistMap = new Map();
    picklistMap.set('rule_group__c', {
      restricted: true,
      nillable: true,
      activeValues: new Set(['Cardio team', 'Surgical team'])
    });
    picklistMap.set('status__c', {
      restricted: true,
      nillable: false,
      activeValues: new Set(['Draft', 'Completed']),
      defaultValue: 'Draft'
    });

    const sanitized = GraphBuilder.sanitizeRecordFields({
      record: rawRecord,
      targetPicklistMap: picklistMap
    });

    // Optional invalid restricted picklist -> stripped
    expect(sanitized.Rule_Group__c).toBeUndefined();

    // Required invalid restricted picklist -> mapped to default active value
    expect(sanitized.Status__c).toBe('Draft');
  });

  it('resolves cross-tier multi-parent lookups on child records preserving execution order', () => {
    const parentRecs = new Map<string, SObjectRecordData>();
    // Parent 1: Account (referenced by Root)
    parentRecs.set('001_PARENT_ACCT', {
      attributes: { type: 'Account', url: '' },
      Id: '001_PARENT_ACCT',
      Name: 'Patient Account'
    });
    // Parent 2: Provider (referenced by Child Charge)
    parentRecs.set('a2p_PARENT_PROV', {
      attributes: { type: 'Provider__c', url: '' },
      Id: 'a2p_PARENT_PROV',
      Name: 'Dr. Gregory House'
    });
    // Parent 3: Payer (referenced by Child Charge, already existing in target)
    parentRecs.set('a2Y_PARENT_PAYER', {
      attributes: { type: 'Payer__c', url: '' },
      Id: 'a2Y_PARENT_PAYER',
      Name: 'BlueCross'
    });

    const rootRecords: SObjectRecordData[] = [
      {
        Id: 'a2l_ROOT_ENC',
        Name: 'ENC-001',
        Account__c: '001_PARENT_ACCT',
        Charges__r: [
          {
            Id: 'a2C_CHILD_CHG',
            Name: 'CHG-001',
            Encounter__c: 'a2l_ROOT_ENC',
            Provider__c: 'a2p_PARENT_PROV', // Points to Parent 2
            Payer__c: 'a2Y_PARENT_PAYER' // Points to Parent 3 (already in target)
          }
        ]
      }
    ];

    const targetExistingMap = new Map<string, string>();
    targetExistingMap.set('a2Y_PARENT_PAYER', 'a2Y_TARGET_EXISTING_PAYER_ID');

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Encounter__c',
      rootRecords,
      parentConfigs: [
        {
          relationshipName: 'Account__r',
          fieldApiName: 'Account__c',
          parentObjectApiName: 'Account',
          parentObjectLabel: 'Account',
          isRequired: true,
          selected: true
        },
        {
          relationshipName: 'Provider__r',
          fieldApiName: 'Provider__c',
          parentObjectApiName: 'Provider__c',
          parentObjectLabel: 'Provider',
          isRequired: true,
          selected: true
        }
      ],
      childConfigs: [
        {
          relationshipName: 'Charges__r',
          childObjectApiName: 'Charges__c',
          childObjectLabel: 'Charges',
          foreignKeyField: 'Encounter__c',
          selected: true,
          selectedFields: ['Name', 'Encounter__c', 'Provider__c', 'Payer__c']
        }
      ],
      parentRecordMap: parentRecs,
      targetExistingParentIds: targetExistingMap
    });

    expect(batches).toHaveLength(1);
    const subrequests = batches[0].graphs[0].compositeRequest;

    // Subrequests should be in DAG order: Parents (Tier 1) -> Root (Tier 2) -> Child (Tier 3)
    const parentAcctSubreq = subrequests.find(s => s.referenceId.includes('ref_Parent_Account'));
    const parentProvSubreq = subrequests.find(s => s.referenceId.includes('ref_Parent_Provider__c'));
    const rootSubreq = subrequests.find(s => s.referenceId.includes('ref_Encounter__c'));
    const childSubreq = subrequests.find(s => s.referenceId.includes('ref_Charges__c'));

    expect(parentAcctSubreq).toBeDefined();
    expect(parentProvSubreq).toBeDefined(); // Provider created in Tier 1 even though referenced by Child!
    expect(rootSubreq).toBeDefined();
    expect(childSubreq).toBeDefined();

    // Verify Root links to Parent Account
    expect(rootSubreq?.body?.Account__c).toBe(`@{${parentAcctSubreq?.referenceId}.id}`);

    // Verify Child links to Root Encounter
    expect(childSubreq?.body?.Encounter__c).toBe(`@{${rootSubreq?.referenceId}.id}`);

    // Verify Child links to Parent Provider via reference ID
    expect(childSubreq?.body?.Provider__c).toBe(`@{${parentProvSubreq?.referenceId}.id}`);

    // Verify Child links to Target Existing Payer directly
    expect(childSubreq?.body?.Payer__c).toBe('a2Y_TARGET_EXISTING_PAYER_ID');
  });

  it('correctly maps nested lookups on parent records (e.g. Claim__c -> Payer__c & Provider__c)', () => {
    const parentRecs = new Map<string, SObjectRecordData>();
    // Parent A: Provider
    parentRecs.set('a2p_PROV', {
      attributes: { type: 'Provider__c', url: '' },
      Id: 'a2p_PROV',
      Name: 'Dr. House'
    });
    // Parent B: Payer (in target)
    parentRecs.set('a2Y_PAYER', {
      attributes: { type: 'Payer__c', url: '' },
      Id: 'a2Y_PAYER',
      Name: 'Aetna'
    });
    // Parent C: Claim (has lookups to Provider and Payer!)
    parentRecs.set('a0B_CLAIM', {
      attributes: { type: 'Claim__c', url: '' },
      Id: 'a0B_CLAIM',
      Name: 'CLM-001',
      Provider__c: 'a2p_PROV',
      CM_Payer__c: 'a2Y_PAYER'
    });

    const rootRecords: SObjectRecordData[] = [
      {
        Id: 'a2l_ENC',
        Name: 'ENC-001',
        Claim_Lines__r: [
          {
            Id: 'a2L_CL',
            Name: 'CL-001',
            Encounter__c: 'a2l_ENC',
            CL_Claim__c: 'a0B_CLAIM'
          }
        ]
      }
    ];

    const targetExistingMap = new Map<string, string>();
    targetExistingMap.set('a2Y_PAYER', 'a2Y_TARGET_PAYER_ID');

    const batches = GraphBuilder.buildPayloadBatches({
      rootObjectApiName: 'Encounter__c',
      rootRecords,
      parentConfigs: [
        {
          relationshipName: 'Provider__r',
          fieldApiName: 'Provider__c',
          parentObjectApiName: 'Provider__c',
          parentObjectLabel: 'Provider',
          isRequired: true,
          selected: true
        },
        {
          relationshipName: 'Claims__r',
          fieldApiName: 'Claim__c',
          parentObjectApiName: 'Claim__c',
          parentObjectLabel: 'Claim',
          isRequired: true,
          selected: true
        }
      ],
      childConfigs: [
        {
          relationshipName: 'Claim_Lines__r',
          childObjectApiName: 'Claim_Line__c',
          childObjectLabel: 'Claim Line',
          foreignKeyField: 'Encounter__c',
          selected: true,
          selectedFields: ['Name', 'Encounter__c', 'CL_Claim__c']
        }
      ],
      parentRecordMap: parentRecs,
      targetExistingParentIds: targetExistingMap
    });

    const subrequests = batches[0].graphs[0].compositeRequest;

    const providerSubreq = subrequests.find(s => s.referenceId.includes('ref_Parent_Provider__c'));
    const claimSubreq = subrequests.find(s => s.referenceId.includes('ref_Parent_Claim__c'));
    const claimLineSubreq = subrequests.find(s => s.referenceId.includes('ref_Claim_Line__c'));

    expect(providerSubreq).toBeDefined();
    expect(claimSubreq).toBeDefined();
    expect(claimLineSubreq).toBeDefined();

    // Verify Provider subrequest is created BEFORE Claim subrequest in Tier 1
    const providerIndex = subrequests.indexOf(providerSubreq!);
    const claimIndex = subrequests.indexOf(claimSubreq!);
    expect(providerIndex).toBeLessThan(claimIndex);

    // Verify Claim body has resolved lookups (Provider -> dynamic reference, Payer -> target ID)
    expect(claimSubreq?.body?.Provider__c).toBe(`@{${providerSubreq?.referenceId}.id}`);
    expect(claimSubreq?.body?.CM_Payer__c).toBe('a2Y_TARGET_PAYER_ID');

    // Verify Child Claim Line body links to Claim reference
    expect(claimLineSubreq?.body?.CL_Claim__c).toBe(`@{${claimSubreq?.referenceId}.id}`);
  });
});
