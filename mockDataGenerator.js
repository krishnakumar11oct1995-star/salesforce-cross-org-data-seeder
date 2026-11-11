/**
 * MockDataGenerator: Generates realistic, schema-compliant synthetic test records
 * for 3-tier Salesforce hierarchies (Parents -> Root -> Children).
 * 
 * Includes intelligent bypass logic for:
 * - Geolocation & compound address fields (Latitude, Longitude, GeocodeAccuracy, Address compounds)
 * - Restricted picklists without active values & State/Country picklist validation conflicts
 * - System/calculated/audit fields (CleanStatus, PhotoUrl, Jigsaw, etc.)
 */

export class MockDataGenerator {
  static COMPANY_NAMES = [
    'Apex Global Logistics', 'Pinnacle Health Partners', 'Summit Care Systems',
    'Nexus Life Sciences', 'Horizon Tech Solutions', 'Vanguard Medical Group',
    'BlueWave Diagnostics', 'Sterling Biotech Labs', 'Crestline Analytics',
    'Meridian Cloud Dynamics', 'Trillium Health Network', 'Keystone Therapeutics'
  ];

  static FIRST_NAMES = [
    'Alexander', 'Sophia', 'Benjamin', 'Emma', 'Lucas', 'Olivia',
    'Daniel', 'Ava', 'Matthew', 'Isabella', 'William', 'Mia'
  ];

  static LAST_NAMES = [
    'Vance', 'Sterling', 'Thornton', 'Mercer', 'Montgomery', 'Sinclair',
    'Donovan', 'Harrington', 'Callahan', 'Kensington', 'Prescott', 'Fairchild'
  ];

  static CITIES = ['San Francisco', 'New York', 'Austin', 'Chicago', 'Boston', 'Seattle', 'Denver'];
  static STATES = ['CA', 'NY', 'TX', 'IL', 'MA', 'WA', 'CO'];
  static STREETS = ['100 Market St', '450 Lexington Ave', '789 Congress Ave', '200 Michigan Ave', '55 Boylston St'];

  static BYPASS_EXACT_NAMES = new Set([
    'photourl', 'jigsaw', 'jigsawcontactid', 'cleanstatus', 'dandbcompanyid',
    'billingaddress', 'shippingaddress', 'mailingaddress', 'otheraddress'
  ]);

  /**
   * Identifies whether a field should be safely bypassed during synthetic mock generation.
   */
  static shouldBypassField(field) {
    const lowerName = field.name.toLowerCase();

    // 1. Skip compound location and address types
    if (field.type === 'location' || field.type === 'address') {
      return true;
    }

    // 2. Skip exact system/integration fields
    if (this.BYPASS_EXACT_NAMES.has(lowerName)) {
      return true;
    }

    // 3. Skip Latitude, Longitude, and GeocodeAccuracy sub-fields
    if (
      lowerName.includes('latitude') ||
      lowerName.includes('longitude') ||
      lowerName.includes('geocodeaccuracy') ||
      lowerName.endsWith('__latitude__s') ||
      lowerName.endsWith('__longitude__s')
    ) {
      return true;
    }

    // 4. Skip Data.com CleanStatus fields
    if (lowerName.endsWith('cleanstatus')) {
      return true;
    }

    return false;
  }

  /**
   * Generates a complete 3-tier synthetic dataset matching schema constraints.
   */
  static generate3TierDataset(options) {
    const {
      rootDescribe,
      parentConfigs,
      parentDescribes,
      childConfigs,
      childDescribes,
      rootCount,
      childrenPerRoot = 2,
      externalIdField
    } = options;

    const parentRecordMap = new Map();
    const parentIdPoolPerObject = new Map();

    // 1. Generate Parent Records
    for (const pConfig of parentConfigs) {
      if (!pConfig.selected) continue;

      const pObject = pConfig.parentObjectApiName;
      if (parentIdPoolPerObject.has(pObject)) continue;

      const pDesc = parentDescribes.get(pObject);
      if (!pDesc) continue;

      const parentPoolCount = Math.min(5, Math.max(2, Math.ceil(rootCount / 4)));
      const idList = [];

      for (let pIdx = 1; pIdx <= parentPoolCount; pIdx++) {
        const fakeParentId = `mock_parent_${pObject}_${pIdx}`;
        const parentRec = this.generateSingleRecord(pDesc, pIdx, 'Parent', externalIdField);
        parentRec.Id = fakeParentId;
        parentRecordMap.set(fakeParentId, parentRec);
        idList.push(fakeParentId);
      }

      parentIdPoolPerObject.set(pObject, idList);
    }

    // 2. Generate Root Records and attach parent lookups
    const rootRecords = [];

    for (let rIdx = 1; rIdx <= rootCount; rIdx++) {
      const rootRec = this.generateSingleRecord(rootDescribe, rIdx, 'Root', externalIdField);
      const rootTempId = `mock_root_${rootDescribe.name}_${rIdx}`;
      rootRec.Id = rootTempId;

      for (const pConfig of parentConfigs) {
        if (!pConfig.selected) continue;
        const pool = parentIdPoolPerObject.get(pConfig.parentObjectApiName);
        if (pool && pool.length > 0) {
          const pickedParentId = pool[(rIdx - 1) % pool.length];
          rootRec[pConfig.fieldApiName] = pickedParentId;
        }
      }

      // 3. Generate Child Records and nest them in subqueries
      for (const cConfig of childConfigs) {
        if (!cConfig.selected) continue;
        const cDesc = childDescribes.get(cConfig.childObjectApiName);
        if (!cDesc) continue;

        const childRecordsList = [];
        for (let cIdx = 1; cIdx <= childrenPerRoot; cIdx++) {
          const childRec = this.generateSingleRecord(cDesc, (rIdx - 1) * childrenPerRoot + cIdx, 'Child', externalIdField);
          childRec.Id = `mock_child_${cConfig.childObjectApiName}_${rIdx}_${cIdx}`;
          childRec[cConfig.foreignKeyField] = rootTempId;
          childRecordsList.push(childRec);
        }

        rootRec[cConfig.relationshipName] = {
          records: childRecordsList,
          totalSize: childRecordsList.length,
          done: true
        };
      }

      rootRecords.push(rootRec);
    }

    return { rootRecords, parentRecordMap };
  }

  /**
   * Generates a single synthetic record adhering to field types, picklist choices, and required constraints.
   */
  static generateSingleRecord(describe, index, rolePrefix = 'Mock', externalIdField) {
    const record = {};
    const company = this.COMPANY_NAMES[(index - 1) % this.COMPANY_NAMES.length];
    const firstName = this.FIRST_NAMES[(index - 1) % this.FIRST_NAMES.length];
    const lastName = this.LAST_NAMES[(index - 1) % this.LAST_NAMES.length];

    for (const field of describe.fields) {
      if (!field.createable || field.calculated) continue;

      const lowerName = field.name.toLowerCase();

      // Skip internal lookups & reference fields handled by hierarchy linking
      if (field.type === 'reference' || (lowerName.endsWith('id') && lowerName !== 'external_id__c')) {
        continue;
      }

      // Safe bypass for geocodes, latitudes, longitudes, and compound system fields
      if (this.shouldBypassField(field)) {
        continue;
      }

      // Populate target External ID field if matched
      if (externalIdField && field.name.toLowerCase() === externalIdField.toLowerCase()) {
        record[field.name] = `SEED_SYNTH_${describe.name.toUpperCase()}_${index}`;
        continue;
      }

      // Name & Text Field Inference
      if (lowerName === 'name') {
        record[field.name] = `${company} ${rolePrefix} #${index}`;
        continue;
      }
      if (lowerName === 'firstname') {
        record[field.name] = firstName;
        continue;
      }
      if (lowerName === 'lastname') {
        record[field.name] = lastName;
        continue;
      }
      if (lowerName === 'subject' || lowerName === 'title') {
        record[field.name] = `${describe.label} #${1000 + index} - ${company}`;
        continue;
      }

      // Address Fields & State/Country Handling (Bypass restricted picklist errors)
      if (lowerName.includes('country') || lowerName.includes('state') || lowerName.includes('province')) {
        if (field.type === 'picklist' || field.type === 'combobox') {
          const activeVals = (field.picklistValues || []).filter(p => p.active !== false);
          if (activeVals.length > 0) {
            record[field.name] = activeVals[(index - 1) % activeVals.length].value;
          }
          // If optional and no active picklist values found, bypass to avoid INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST
          continue;
        }

        if (lowerName.includes('country')) {
          record[field.name] = field.nillable ? 'United States' : 'US';
          continue;
        }
        if (lowerName.includes('state') || lowerName.includes('province')) {
          record[field.name] = this.STATES[(index - 1) % this.STATES.length];
          continue;
        }
      }

      if (lowerName.includes('street')) {
        record[field.name] = this.STREETS[(index - 1) % this.STREETS.length];
        continue;
      }
      if (lowerName.includes('city')) {
        record[field.name] = this.CITIES[(index - 1) % this.CITIES.length];
        continue;
      }
      if (lowerName.includes('postalcode') || lowerName.includes('zip')) {
        record[field.name] = `07${100 + (index % 800)}`;
        continue;
      }

      // Standard Datatypes
      switch (field.type) {
        case 'string':
        case 'textarea':
          if (!field.nillable || lowerName.includes('desc') || lowerName.includes('summary')) {
            record[field.name] = `Synthetic ${field.label} for testing #${index}.`;
          }
          break;

        case 'picklist':
        case 'combobox': {
          const activeVals = (field.picklistValues || []).filter(p => p.active !== false);
          if (activeVals.length > 0) {
            const picked = activeVals[(index - 1) % activeVals.length];
            record[field.name] = picked.value;
          } else if (!field.nillable) {
            record[field.name] = 'Default';
          }
          // If optional and no active picklist options are declared, omit to prevent restricted picklist failures
          break;
        }

        case 'multipicklist': {
          const activeVals = (field.picklistValues || []).filter(p => p.active !== false);
          if (activeVals.length > 0) {
            record[field.name] = activeVals[0].value;
          } else if (!field.nillable) {
            record[field.name] = 'Default';
          }
          break;
        }

        case 'boolean':
          record[field.name] = index % 2 === 0;
          break;

        case 'currency':
        case 'double':
        case 'percent':
          record[field.name] = 1000 + (index * 250);
          break;

        case 'int':
          record[field.name] = Math.max(1, index % 20);
          break;

        case 'email':
          record[field.name] = `mock.user.${index}@${company.toLowerCase().replace(/[^a-z]/g, '')}.com`;
          break;

        case 'phone':
          record[field.name] = `(555) 012-${String(1000 + index).substring(0, 4)}`;
          break;

        case 'url':
          record[field.name] = `https://www.${company.toLowerCase().replace(/[^a-z]/g, '')}.com`;
          break;

        case 'date': {
          const date = new Date();
          date.setDate(date.getDate() + (index % 30));
          record[field.name] = date.toISOString().split('T')[0];
          break;
        }

        case 'datetime': {
          const dTime = new Date();
          dTime.setDate(dTime.getDate() + (index % 30));
          record[field.name] = dTime.toISOString();
          break;
        }

        default:
          if (!field.nillable) {
            record[field.name] = `Test_${field.name}_${index}`;
          }
      }
    }

    return record;
  }
}
