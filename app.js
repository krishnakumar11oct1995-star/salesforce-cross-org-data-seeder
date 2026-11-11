/**
 * Salesforce Cross-Org Data Seeder - Complete 5-Step Wizard Controller
 * Enhanced with RecordType Auto-Mapping, Owner Reassignment, PII Masking, Recipes & Purge.
 */

import { ApiClient } from './apiClient.js';
import { SchemaEngine } from './schemaEngine.js';
import { GraphBuilder } from './graphBuilder.js';
import { RecipeManager } from './recipeManager.js';
import { MockDataGenerator } from './mockDataGenerator.js';

document.addEventListener('DOMContentLoaded', async () => {
  // State
  let currentStep = 1;
  let dataMode = 'EXTRACT'; // 'EXTRACT' | 'MOCK'
  let sourceSession = null;
  let targetOrgs = [];
  let eligibleObjects = [];
  let selectedRootObject = '';
  let rootDescribe = null;
  let targetDescribe = null;
  let parentConfigs = [];
  let childConfigs = [];
  let fieldMappings = [];
  let lastSeededSourceIds = [];

  // DOM Elements
  const sessionBadge = document.getElementById('session-badge');
  const sourceStatusEl = document.getElementById('source-org-status');
  const targetSelectEl = document.getElementById('target-org-select');
  const targetExtIdEl = document.getElementById('target-ext-id');
  const btnRefreshSource = document.getElementById('btn-refresh-source');
  const btnLoginSource = document.getElementById('btn-login-source');
  const sourceLoginModal = document.getElementById('source-login-modal');
  const btnCancelSrcModal = document.getElementById('btn-cancel-src-modal');
  const btnSubmitSrcLogin = document.getElementById('btn-submit-src-login');

  const btnAddTarget = document.getElementById('btn-add-target');
  const btnSyncSource = document.getElementById('btn-sync-source');
  const btnModalUseActive = document.getElementById('btn-modal-use-active');
  const btnClearTargets = document.getElementById('btn-clear-targets');
  const connectModal = document.getElementById('connect-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const btnSubmitDirect = document.getElementById('btn-submit-direct');
  const consoleLogs = document.getElementById('console-logs');

  // Step 2 Elements
  const modeExtract = document.getElementById('mode-extract');
  const modeMock = document.getElementById('mode-mock');
  const soqlFilterGroup = document.getElementById('soql-filter-group');
  const mockConfigGroup = document.getElementById('mock-config-group');
  const mockChildrenCount = document.getElementById('mock-children-count');
  const mockChildrenVal = document.getElementById('mock-children-val');
  const recordCountLabel = document.getElementById('record-count-label');

  const recipeSelect = document.getElementById('recipe-select');
  const btnSaveRecipeModal = document.getElementById('btn-save-recipe-modal');
  const objectSearch = document.getElementById('object-search');
  const objectsList = document.getElementById('objects-list');
  const soqlWhere = document.getElementById('soql-where');
  const recordLimitSlider = document.getElementById('record-limit');
  const limitVal = document.getElementById('limit-val');

  // Step 3 Elements
  const tabParents = document.getElementById('tab-parents');
  const tabChildren = document.getElementById('tab-children');
  const tabContentParents = document.getElementById('tab-content-parents');
  const tabContentChildren = document.getElementById('tab-content-children');
  const parentsList = document.getElementById('parents-list');
  const childrenList = document.getElementById('children-list');
  const parentsCount = document.getElementById('parents-count');
  const childrenCount = document.getElementById('children-count');

  // Safety & Masking Checkboxes
  const chkAutoRT = document.getElementById('chk-auto-rt');
  const chkReassignOwner = document.getElementById('chk-reassign-owner');
  const chkMaskEmails = document.getElementById('chk-mask-emails');
  const chkMaskPhones = document.getElementById('chk-mask-phones');
  const chkMaskNames = document.getElementById('chk-mask-names');

  // Step 4 Elements
  const storageFootprintText = document.getElementById('storage-footprint-text');
  const storageProgress = document.getElementById('storage-progress');
  const quotaPercentText = document.getElementById('quota-percent-text');
  const statRootCount = document.getElementById('stat-root-count');
  const statParentCount = document.getElementById('stat-parent-count');
  const statChildCount = document.getElementById('stat-child-count');
  const statTotalCount = document.getElementById('stat-total-count');
  const auditMatchedCount = document.getElementById('audit-matched-count');
  const auditMissingCount = document.getElementById('audit-missing-count');

  // Step 5 Elements
  const execBadge = document.getElementById('exec-badge');
  const execProgressText = document.getElementById('exec-progress-text');
  const execBatchText = document.getElementById('exec-batch-text');
  const execProgressBar = document.getElementById('exec-progress-bar');
  const statSuccessGraphs = document.getElementById('stat-success-graphs');
  const statFailedGraphs = document.getElementById('stat-failed-graphs');
  const btnStartSeeding = document.getElementById('btn-start-seeding');
  const btnPurgeData = document.getElementById('btn-purge-data');
  const btnCopyLogs = document.getElementById('btn-copy-logs');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  // Navigation Helpers
  function setStep(step) {
    currentStep = step;
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${step}`)?.classList.add('active');

    document.querySelectorAll('.step-item').forEach(item => {
      const itemStep = parseInt(item.dataset.step, 10);
      item.classList.remove('active', 'completed');
      if (itemStep === step) item.classList.add('active');
      else if (itemStep < step) item.classList.add('completed');
    });
  }

  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = parseInt(btn.dataset.target, 10);
      setStep(target);
    });
  });

  function log(msg, type = 'info') {
    const p = document.createElement('p');
    p.className = `log-entry log-${type}`;
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    consoleLogs.appendChild(p);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  // Copy Stream Handler
  btnCopyLogs?.addEventListener('click', async () => {
    const entries = Array.from(consoleLogs.querySelectorAll('.log-entry'))
      .map(p => p.textContent)
      .join('\n');
    
    if (!entries) {
      alert('No logs to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(entries);
      btnCopyLogs.textContent = '✓ Copied!';
      setTimeout(() => { btnCopyLogs.textContent = '📋 Copy Stream'; }, 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = entries;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      btnCopyLogs.textContent = '✓ Copied!';
      setTimeout(() => { btnCopyLogs.textContent = '📋 Copy Stream'; }, 2000);
    }
  });

  btnClearLogs?.addEventListener('click', () => {
    consoleLogs.innerHTML = '';
  });

  // 1. Detect Source Org
  async function refreshSourceOrg() {
    try {
      sourceStatusEl.innerHTML = '<div class="spinner"></div><span>Detecting active Salesforce tab...</span>';
      sessionBadge.textContent = 'Checking...';
      sessionBadge.className = 'badge badge-warning';

      const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ORG_SESSION' });

      if (response && response.success && response.data) {
        sourceSession = response.data;
        sourceStatusEl.innerHTML = `
          <div>
            <strong>Instance:</strong> ${sourceSession.instanceUrl}<br>
            <small style="color: #2e844a;">● Active Session Detected (${sourceSession.isSandbox ? 'Sandbox' : 'Production'})</small>
          </div>
        `;
        sessionBadge.textContent = 'Online';
        sessionBadge.className = 'badge badge-success';
        log(`Connected to Source Org: ${sourceSession.instanceUrl}`, 'success');
        await loadTargetOrgs();
      } else {
        sourceSession = null;
        sourceStatusEl.innerHTML = `<span style="color: #ea001e;">⚠️ ${response?.error || 'No active Salesforce tab detected.'}</span>`;
        sessionBadge.textContent = 'Disconnected';
        sessionBadge.className = 'badge badge-warning';
        log('No active Salesforce tab detected. Use Direct Login or refresh tab.', 'warning');
      }
    } catch (err) {
      sourceStatusEl.innerHTML = `<span style="color: #ea001e;">⚠️ Error communicating with extension worker.</span>`;
      log(`Error: ${err.message}`, 'error');
    }
  }

  btnRefreshSource?.addEventListener('click', async () => {
    await refreshSourceOrg();
    await loadTargetOrgs();
  });

  // Source Direct Login
  btnLoginSource.addEventListener('click', () => sourceLoginModal.classList.toggle('hidden'));
  btnCancelSrcModal.addEventListener('click', () => sourceLoginModal.classList.add('hidden'));

  btnSubmitSrcLogin.addEventListener('click', async () => {
    const loginUrl = document.getElementById('src-url').value.trim();
    const username = document.getElementById('src-username').value.trim();
    const password = document.getElementById('src-password').value.trim();

    if (!loginUrl || !username || !password) {
      alert('Please fill out all fields.');
      return;
    }

    log(`Authenticating with Source Org (${username})...`, 'info');
    btnSubmitSrcLogin.disabled = true;
    btnSubmitSrcLogin.textContent = 'Connecting...';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LOGIN_SOURCE_ORG',
        payload: { loginUrl, username, password }
      });

      if (response && response.success && response.data) {
        sourceSession = response.data;
        sourceStatusEl.innerHTML = `
          <div>
            <strong>Instance:</strong> ${sourceSession.instanceUrl}<br>
            <small style="color: #2e844a;">● Direct Authenticated (${username})</small>
          </div>
        `;
        sessionBadge.textContent = 'Online';
        sessionBadge.className = 'badge badge-success';
        sourceLoginModal.classList.add('hidden');
        log(`Connected to Source Org: ${sourceSession.instanceUrl}`, 'success');
        await loadTargetOrgs();
      } else {
        log(`Source login failed: ${response?.error}`, 'error');
        alert(`Authentication failed: ${response?.error}`);
      }
    } catch (err) {
      log(`Source login error: ${err.message}`, 'error');
      alert(`Login error: ${err.message}`);
    } finally {
      btnSubmitSrcLogin.disabled = false;
      btnSubmitSrcLogin.textContent = 'Connect Source Org';
    }
  });

  // 2. Load Target Orgs
  async function loadTargetOrgs() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TARGET_ORGS' });
      targetSelectEl.innerHTML = '';
      targetOrgs = [];

      // Automatically make Target Org match the Source Org (Same Active Org)
      if (sourceSession && sourceSession.instanceUrl) {
        const sameOrgAlias = 'Current_Active_Org';
        const activeTarget = {
          alias: sameOrgAlias,
          instanceUrl: sourceSession.instanceUrl,
          loginUrl: sourceSession.isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com',
          accessToken: sourceSession.sessionId,
          clientId: 'ACTIVE_TAB_SESSION',
          domain: sourceSession.domain,
          isSandbox: sourceSession.isSandbox
        };
        targetOrgs.push(activeTarget);
      }

      // Also append any other saved target sandboxes if available
      if (response && response.success && Array.isArray(response.data)) {
        response.data.forEach(o => {
          if (!targetOrgs.some(t => t.instanceUrl === o.instanceUrl)) {
            targetOrgs.push(o);
          }
        });
      }

      // Fallback if no session detected yet
      if (targetOrgs.length === 0) {
        targetOrgs.push({
          alias: 'Current_Active_Org',
          instanceUrl: 'https://my-personal-dev.my.salesforce.com',
          loginUrl: 'https://login.salesforce.com',
          accessToken: 'ACTIVE_TAB_SESSION',
          clientId: 'ACTIVE_TAB_SESSION'
        });
      }

      targetOrgs.forEach(org => {
        const opt = document.createElement('option');
        opt.value = org.alias;
        opt.textContent = `${org.alias} (${org.instanceUrl})`;
        targetSelectEl.appendChild(opt);
      });

      const targetStatusLabel = document.getElementById('target-status-label');
      if (targetStatusLabel) {
        targetStatusLabel.textContent = `● Connected (Matched to Source: ${targetOrgs[0].instanceUrl})`;
      }
      log(`Target Org matched to Source Org: ${targetOrgs[0].instanceUrl}`, 'success');
    } catch (err) {
      log(`Failed to load target orgs: ${err.message}`, 'error');
    }
  }

  // Load Saved Recipes
  async function loadRecipes() {
    try {
      const recipes = await RecipeManager.getRecipes();
      recipeSelect.innerHTML = '<option value="">-- Load Saved Recipe --</option>';
      recipes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.name} (${r.rootObject} - ${r.recordLimit} recs)`;
        recipeSelect.appendChild(opt);
      });
    } catch (err) {
      console.warn('Failed to load recipes:', err);
    }
  }

  recipeSelect.addEventListener('change', async () => {
    const selectedRecipeId = recipeSelect.value;
    if (!selectedRecipeId) return;

    const recipes = await RecipeManager.getRecipes();
    const recipe = recipes.find(r => r.id === selectedRecipeId);
    if (!recipe) return;

    selectedRootObject = recipe.rootObject;
    recordLimitSlider.value = recipe.recordLimit;
    limitVal.textContent = `${recipe.recordLimit} records`;
    soqlWhere.value = recipe.whereClause || '';

    if (recipe.options?.piiMasking) {
      chkMaskEmails.checked = recipe.options.piiMasking.maskEmails;
      chkMaskPhones.checked = recipe.options.piiMasking.maskPhones;
      chkMaskNames.checked = recipe.options.piiMasking.anonymizeNames;
    }
    if (recipe.options?.autoMapRecordTypes !== undefined) {
      chkAutoRT.checked = recipe.options.autoMapRecordTypes;
    }
    if (recipe.options?.reassignOwnerToTargetUser !== undefined) {
      chkReassignOwner.checked = recipe.options.reassignOwnerToTargetUser;
    }

    renderObjectsList(eligibleObjects);
    log(`Loaded recipe '${recipe.name}' for ${recipe.rootObject}.`, 'success');
  });

  btnSaveRecipeModal.addEventListener('click', async () => {
    if (!selectedRootObject) {
      alert('Please select an SObject first before saving as a recipe.');
      return;
    }

    const recipeName = prompt('Enter a name for this Seeding Recipe:', `${selectedRootObject} Test Seed`);
    if (!recipeName) return;

    const newRecipe = {
      id: `recipe_${Date.now()}`,
      name: recipeName,
      rootObject: selectedRootObject,
      recordLimit: parseInt(recordLimitSlider.value, 10),
      whereClause: soqlWhere.value.trim(),
      selectedParents: parentConfigs.filter(p => p.selected).map(p => p.fieldApiName),
      selectedChildren: childConfigs.filter(c => c.selected).map(c => c.relationshipName),
      options: {
        autoMapRecordTypes: chkAutoRT.checked,
        reassignOwnerToTargetUser: chkReassignOwner.checked,
        piiMasking: {
          maskEmails: chkMaskEmails.checked,
          maskPhones: chkMaskPhones.checked,
          anonymizeNames: chkMaskNames.checked
        }
      },
      createdAt: Date.now()
    };

    await RecipeManager.saveRecipe(newRecipe);
    await loadRecipes();
    log(`Saved seeding recipe: '${recipeName}'`, 'success');
    alert(`Recipe '${recipeName}' saved successfully!`);
  });

  // Target Direct Login Modal Actions
  btnAddTarget.addEventListener('click', () => connectModal.classList.toggle('hidden'));
  btnCancelModal.addEventListener('click', () => connectModal.classList.add('hidden'));

  // Link Active Tab Handler (Instant, No Password, No SOAP Restriction)
  const handleLinkActiveTabAsTarget = async () => {
    if (!sourceSession || !sourceSession.instanceUrl) {
      await refreshSourceOrg();
    }
    if (!sourceSession || !sourceSession.instanceUrl) {
      alert('No active Salesforce session detected. Please open and refresh your Salesforce tab first.');
      return;
    }

    const sameOrgAlias = 'Current_Active_Org';
    const activeTarget = {
      alias: sameOrgAlias,
      instanceUrl: sourceSession.instanceUrl,
      loginUrl: sourceSession.isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com',
      accessToken: sourceSession.sessionId,
      clientId: 'ACTIVE_TAB_SESSION',
      domain: sourceSession.domain,
      isSandbox: sourceSession.isSandbox
    };

    targetOrgs = [activeTarget];
    targetSelectEl.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = activeTarget.alias;
    opt.textContent = `${activeTarget.alias} (${activeTarget.instanceUrl})`;
    targetSelectEl.appendChild(opt);

    const targetStatusLabel = document.getElementById('target-status-label');
    if (targetStatusLabel) {
      targetStatusLabel.textContent = `● Connected (Matched to Source: ${activeTarget.instanceUrl})`;
    }

    connectModal?.classList.add('hidden');
    log(`Target Org linked to active Salesforce tab: ${activeTarget.instanceUrl}`, 'success');
  };

  btnSyncSource?.addEventListener('click', handleLinkActiveTabAsTarget);
  btnModalUseActive?.addEventListener('click', handleLinkActiveTabAsTarget);

  btnSubmitDirect.addEventListener('click', async () => {
    const alias = document.getElementById('direct-alias').value.trim();
    const loginUrl = document.getElementById('direct-url').value.trim();
    const username = document.getElementById('direct-username').value.trim();
    const password = document.getElementById('direct-password').value.trim();

    if (!alias || !loginUrl || !username || !password) {
      alert('Please fill out all fields.');
      return;
    }

    log(`Authenticating with target sandbox '${alias}'...`, 'info');
    btnSubmitDirect.disabled = true;
    btnSubmitDirect.textContent = 'Logging in...';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CONNECT_TARGET_ORG_DIRECT',
        payload: { alias, loginUrl, username, password }
      });

      if (response && response.success && response.data) {
        log(`Successfully authenticated target sandbox '${alias}'!`, 'success');
        connectModal.classList.add('hidden');
        document.getElementById('direct-alias').value = '';
        document.getElementById('direct-username').value = '';
        document.getElementById('direct-password').value = '';
        await loadTargetOrgs();
      } else {
        log(`Login failed: ${response?.error || 'Unknown error'}`, 'error');
        alert(`Authentication failed: ${response?.error}`);
      }
    } catch (err) {
      log(`Login exception: ${err.message}`, 'error');
      alert(`Login error: ${err.message}`);
    } finally {
      btnSubmitDirect.disabled = false;
      btnSubmitDirect.textContent = 'Login & Save';
    }
  });

  // Step 1 -> Step 2: Fetch SObjects
  document.getElementById('btn-step1-next').addEventListener('click', async () => {
    if (!sourceSession || !sourceSession.sessionId) {
      alert('Please connect the Source Org first (or click Direct Login).');
      return;
    }
    const selectedAlias = targetSelectEl.value;
    if (!selectedAlias) {
      alert('Please connect and select a target sandbox destination.');
      return;
    }

    try {
      log('Fetching eligible SObjects from Source Org...', 'info');
      objectsList.innerHTML = '<div class="text-muted p-2 text-center">Loading objects from Salesforce...</div>';

      eligibleObjects = await SchemaEngine.getEligibleObjects(
        sourceSession.instanceUrl,
        sourceSession
      );

      renderObjectsList(eligibleObjects);
      await loadRecipes();
      log(`Loaded ${eligibleObjects.length} eligible SObjects.`, 'success');
      setStep(2);
    } catch (err) {
      log(`Failed to fetch SObjects: ${err.message}`, 'error');
      alert(`Error loading SObjects: ${err.message}. If the browser session is expired, use the Direct Login button on Step 1.`);
    }
  });

  function renderObjectsList(objects) {
    objectsList.innerHTML = '';
    if (objects.length === 0) {
      objectsList.innerHTML = '<div class="text-muted p-2 text-center">No matching objects found.</div>';
      return;
    }

    objects.forEach(obj => {
      const row = document.createElement('div');
      row.className = `list-row ${selectedRootObject === obj.name ? 'selected' : ''}`;
      row.innerHTML = `
        <div>
          <span>${obj.label}</span>
          <span style="font-size: 9px; color: #888; font-family: monospace;">(${obj.name})</span>
        </div>
        ${obj.custom ? '<span style="font-size: 8px; background: #eee; padding: 1px 4px; border-radius: 3px;">Custom</span>' : ''}
      `;
      row.addEventListener('click', () => {
        selectedRootObject = obj.name;
        document.querySelectorAll('.list-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      });
      objectsList.appendChild(row);
    });
  }

  modeExtract?.addEventListener('change', () => {
    if (modeExtract.checked) {
      dataMode = 'EXTRACT';
      soqlFilterGroup.classList.remove('hidden');
      mockConfigGroup.classList.add('hidden');
      recordCountLabel.textContent = 'Record Limit';
      limitVal.textContent = `${recordLimitSlider.value} records`;
    }
  });

  modeMock?.addEventListener('change', () => {
    if (modeMock.checked) {
      dataMode = 'MOCK';
      soqlFilterGroup.classList.add('hidden');
      mockConfigGroup.classList.remove('hidden');
      recordCountLabel.textContent = 'Synthetic Records to Generate';
      limitVal.textContent = `${recordLimitSlider.value} synthetic records`;
    }
  });

  mockChildrenCount?.addEventListener('input', () => {
    mockChildrenVal.textContent = `${mockChildrenCount.value} child${mockChildrenCount.value === '1' ? '' : 'ren'}`;
  });

  objectSearch.addEventListener('input', () => {
    const q = objectSearch.value.toLowerCase();
    const filtered = eligibleObjects.filter(
      o => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
    renderObjectsList(filtered);
  });

  recordLimitSlider.addEventListener('input', () => {
    limitVal.textContent = dataMode === 'MOCK'
      ? `${recordLimitSlider.value} synthetic records`
      : `${recordLimitSlider.value} records`;
  });

  // Step 2 -> Step 3: Describe Object & Load Relationships
  document.getElementById('btn-step2-next').addEventListener('click', async () => {
    if (!selectedRootObject) {
      alert('Please select a root SObject.');
      return;
    }

    try {
      log(`Describing schema and relationships for ${selectedRootObject}...`, 'info');

      rootDescribe = await SchemaEngine.describeSObject(
        sourceSession.instanceUrl,
        sourceSession,
        selectedRootObject
      );

      parentConfigs = SchemaEngine.getParentRelationships(rootDescribe);
      childConfigs = SchemaEngine.getChildRelationships(rootDescribe);

      renderRelationships();
      log(`Discovered ${parentConfigs.length} parent lookups and ${childConfigs.length} child relationships.`, 'success');
      setStep(3);
    } catch (err) {
      log(`Failed to describe ${selectedRootObject}: ${err.message}`, 'error');
      alert(`Describe error: ${err.message}`);
    }
  });

  function renderRelationships() {
    parentsCount.textContent = parentConfigs.filter(p => p.selected).length;
    childrenCount.textContent = childConfigs.filter(c => c.selected).length;

    // Parents
    parentsList.innerHTML = '';
    if (parentConfigs.length === 0) {
      parentsList.innerHTML = '<div class="text-muted p-2 text-center">No parent lookups found.</div>';
    } else {
      parentConfigs.forEach(p => {
        const row = document.createElement('label');
        row.className = 'list-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" ${p.selected ? 'checked' : ''}>
            <div>
              <strong>${p.relationshipName}</strong>
              <span style="font-size: 9px; color: #666; display: block;">${p.fieldApiName} &rarr; ${p.parentObjectApiName}</span>
            </div>
          </div>
          ${p.isRequired ? '<span style="font-size: 8px; background: #fde8e8; color: #ea001e; padding: 1px 4px; border-radius: 3px; font-weight: bold;">Required</span>' : '<span style="font-size: 9px; color: #aaa;">Optional</span>'}
        `;
        const cb = row.querySelector('input');
        cb.addEventListener('change', () => {
          p.selected = cb.checked;
          parentsCount.textContent = parentConfigs.filter(x => x.selected).length;
        });
        parentsList.appendChild(row);
      });
    }

    // Children
    childrenList.innerHTML = '';
    if (childConfigs.length === 0) {
      childrenList.innerHTML = '<div class="text-muted p-2 text-center">No child relationships found.</div>';
    } else {
      childConfigs.forEach(c => {
        const row = document.createElement('label');
        row.className = 'list-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" ${c.selected ? 'checked' : ''}>
            <div>
              <strong>${c.relationshipName}</strong>
              <span style="font-size: 9px; color: #666; display: block;">Child: ${c.childObjectApiName}</span>
            </div>
          </div>
          <span style="font-size: 9px; font-family: monospace; color: #666;">${c.foreignKeyField}</span>
        `;
        const cb = row.querySelector('input');
        cb.addEventListener('change', () => {
          c.selected = cb.checked;
          childrenCount.textContent = childConfigs.filter(x => x.selected).length;
        });
        childrenList.appendChild(row);
      });
    }
  }

  tabParents.addEventListener('click', () => {
    tabParents.classList.add('active');
    tabChildren.classList.remove('active');
    tabContentParents.classList.add('active');
    tabContentChildren.classList.remove('active');
  });

  tabChildren.addEventListener('click', () => {
    tabChildren.classList.add('active');
    tabParents.classList.remove('active');
    tabContentChildren.classList.add('active');
    tabContentParents.classList.remove('active');
  });

  // Step 3 -> Step 4: Storage Sizing & Schema Audit
  document.getElementById('btn-step3-next').addEventListener('click', async () => {
    const targetAlias = targetSelectEl.value;
    const targetOrg = targetOrgs.find(o => o.alias === targetAlias);
    if (!targetOrg) {
      alert('Target sandbox not selected.');
      return;
    }

    try {
      log(`Auditing target sandbox schema for ${selectedRootObject}...`, 'info');

      targetDescribe = await SchemaEngine.describeSObject(
        targetOrg.instanceUrl,
        targetOrg,
        selectedRootObject
      );

      fieldMappings = SchemaEngine.reconcileSchemas(rootDescribe, targetDescribe);

      const rootCount = parseInt(recordLimitSlider.value, 10);
      const selectedParents = parentConfigs.filter(p => p.selected).length;
      const selectedChildren = childConfigs.filter(c => c.selected).length;

      let parentCount = 0;
      let childCount = 0;

      if (dataMode === 'MOCK') {
        const childrenPerRoot = parseInt(mockChildrenCount.value, 10);
        parentCount = Math.min(5, Math.max(2, Math.ceil(rootCount / 4))) * selectedParents;
        childCount = rootCount * selectedChildren * childrenPerRoot;
      } else {
        parentCount = rootCount * selectedParents;
        childCount = rootCount * selectedChildren * 3;
      }

      const totalRecords = rootCount + parentCount + childCount;
      const estimatedKb = totalRecords * 2;
      const estimatedMb = (estimatedKb / 1024).toFixed(2);
      const quotaPercent = Math.min(100, Math.round((parseFloat(estimatedMb) / 200) * 100));

      storageFootprintText.textContent = `Estimated: ${estimatedMb} MB (${estimatedKb} KB)`;
      quotaPercentText.textContent = `${quotaPercent}% of 200 MB sandbox quota`;
      storageProgress.style.width = `${Math.max(2, quotaPercent)}%`;

      statRootCount.textContent = rootCount;
      statParentCount.textContent = `~${parentCount}`;
      statChildCount.textContent = `~${childCount}`;
      statTotalCount.textContent = `~${totalRecords}`;

      const matched = fieldMappings.filter(m => m.status === 'MATCH').length;
      const missing = fieldMappings.filter(m => m.status === 'MISSING_IN_TARGET').length;

      auditMatchedCount.textContent = matched;
      auditMissingCount.textContent = missing;
      document.getElementById('audit-missing-row').style.display = missing > 0 ? 'flex' : 'none';

      log(`Storage calculated: ~${totalRecords} records (${estimatedMb} MB). ${matched} fields matched.`, 'success');
      setStep(4);
    } catch (err) {
      log(`Audit failure: ${err.message}`, 'error');
      if (ApiClient.isAuthError(err.message)) {
        alert(`Target sandbox session expired for '${targetAlias}'. Please enter credentials to reconnect.`);
        connectModal.classList.remove('hidden');
        document.getElementById('direct-alias').value = targetAlias;
        document.getElementById('direct-url').value = targetOrg.loginUrl || 'https://test.salesforce.com';
      } else {
        alert(`Target schema error: ${err.message}`);
      }
    }
  });

  // Step 4 -> Step 5: Ready to Execute
  document.getElementById('btn-step4-next').addEventListener('click', () => {
    setStep(5);
  });

  // Step 5: 1-Click Rollback / Purge
  btnPurgeData.addEventListener('click', async () => {
    const targetAlias = targetSelectEl.value;
    const targetOrg = targetOrgs.find(o => o.alias === targetAlias);
    const extIdField = targetExtIdEl.value.trim() || 'Source_Record_Id__c';

    if (!targetOrg) {
      alert('Target sandbox not selected.');
      return;
    }
    if (!lastSeededSourceIds || lastSeededSourceIds.length === 0) {
      alert('No recent seeding run found to purge. Run a seeding batch first.');
      return;
    }

    const confirmPurge = confirm(`Are you sure you want to delete ${lastSeededSourceIds.length} records of type '${selectedRootObject}' from ${targetOrg.alias}?`);
    if (!confirmPurge) return;

    try {
      btnPurgeData.disabled = true;
      btnPurgeData.textContent = 'Purging...';
      log(`🧹 Purging ${lastSeededSourceIds.length} seeded records from ${targetOrg.alias}...`, 'warning');

      const purgeResult = await RecipeManager.purgeSeededRecords(
        targetOrg,
        selectedRootObject,
        extIdField,
        lastSeededSourceIds
      );

      log(`✓ Purge complete! Deleted ${purgeResult.deletedCount} records.`, 'success');
      if (purgeResult.errors.length > 0) {
        purgeResult.errors.slice(0, 3).forEach(e => log(e, 'error'));
      }
      alert(`Purged ${purgeResult.deletedCount} records from target sandbox.`);
    } catch (err) {
      log(`Purge failed: ${err.message}`, 'error');
      alert(`Purge error: ${err.message}`);
    } finally {
      btnPurgeData.disabled = false;
      btnPurgeData.textContent = '🧹 Purge Data';
    }
  });

  // Step 5: Execute 3-Tier Seeding with Anonymization & RecordType Mapping
  btnStartSeeding.addEventListener('click', async () => {
    const targetAlias = targetSelectEl.value;
    const targetOrg = targetOrgs.find(o => o.alias === targetAlias);
    const limit = parseInt(recordLimitSlider.value, 10);
    const where = soqlWhere.value.trim();
    const extIdField = targetExtIdEl.value.trim();

    if (!targetOrg || !sourceSession || !rootDescribe) {
      alert('Session expired. Please restart from Step 1.');
      return;
    }

    try {
      btnStartSeeding.disabled = true;
      btnStartSeeding.textContent = 'Transferring...';
      execBadge.textContent = 'RUNNING';
      execBadge.className = 'badge badge-running';

      log(`🚀 Initiating 3-tier data seeding for ${selectedRootObject}...`, 'info');
      log(`Target Destination: ${targetOrg.alias} (${targetOrg.instanceUrl})`, 'info');

      let rootRecords = [];
      const parentRecordMap = new Map();
      const parentRecordTypeMaps = new Map();

      if (dataMode === 'MOCK') {
        const childrenPerRoot = parseInt(mockChildrenCount.value, 10);
        log(`🤖 Synthesizing 3-tier mock dataset for ${selectedRootObject} (${limit} roots, ${childrenPerRoot} children/root)...`, 'info');

        // Fetch parent describes for synthetic generation
        const parentDescribes = new Map();
        for (const p of parentConfigs) {
          if (p.selected && !parentDescribes.has(p.parentObjectApiName)) {
            const pDesc = await SchemaEngine.describeSObject(sourceSession.instanceUrl, sourceSession, p.parentObjectApiName);
            parentDescribes.set(p.parentObjectApiName, pDesc);

            if (chkAutoRT.checked) {
              const targetParentDesc = await SchemaEngine.describeSObject(targetOrg.instanceUrl, targetOrg, p.parentObjectApiName);
              parentRecordTypeMaps.set(p.parentObjectApiName, RecipeManager.buildRecordTypeTranslationMap(pDesc, targetParentDesc));
            }
          }
        }

        // Fetch child describes for synthetic generation
        const childDescribes = new Map();
        for (const c of childConfigs) {
          if (c.selected && !childDescribes.has(c.childObjectApiName)) {
            const cDesc = await SchemaEngine.describeSObject(sourceSession.instanceUrl, sourceSession, c.childObjectApiName);
            childDescribes.set(c.childObjectApiName, cDesc);

            if (chkAutoRT.checked) {
              const targetChildDesc = await SchemaEngine.describeSObject(targetOrg.instanceUrl, targetOrg, c.childObjectApiName);
              parentRecordTypeMaps.set(c.childObjectApiName, RecipeManager.buildRecordTypeTranslationMap(cDesc, targetChildDesc));
            }
          }
        }

        const generated = MockDataGenerator.generate3TierDataset({
          rootDescribe,
          parentConfigs,
          parentDescribes,
          childConfigs,
          childDescribes,
          rootCount: limit,
          childrenPerRoot
        });

        rootRecords = generated.rootRecords;
        generated.parentRecordMap.forEach((v, k) => parentRecordMap.set(k, v));
        log(`✓ Synthesized ${rootRecords.length} mock root records and ${parentRecordMap.size} mock parent records.`, 'success');
      } else {
        // 1. Build Source Root Query
        const selectedFields = rootDescribe.fields
          .filter(f => f.createable || f.idLookup)
          .map(f => f.name);

        if (rootDescribe.fields.some(f => f.name.toLowerCase() === 'recordtypeid') && !selectedFields.includes('RecordTypeId')) {
          selectedFields.push('RecordTypeId');
        }

        parentConfigs.forEach(p => {
          if (p.selected && !selectedFields.includes(p.fieldApiName)) selectedFields.push(p.fieldApiName);
        });

        // Build Child Subqueries with all createable / required fields
        const childSubqueries = [];
        for (const c of childConfigs) {
          if (!c.selected) continue;
          try {
            const childDesc = await SchemaEngine.describeSObject(
              sourceSession.instanceUrl,
              sourceSession,
              c.childObjectApiName
            );
            const childFieldNames = childDesc.fields
              .filter(f => f.createable || f.idLookup)
              .map(f => f.name);

            if (!childFieldNames.some(f => f.toLowerCase() === 'id')) {
              childFieldNames.unshift('Id');
            }
            if (!childFieldNames.some(f => f.toLowerCase() === c.foreignKeyField.toLowerCase())) {
              childFieldNames.push(c.foreignKeyField);
            }
            childSubqueries.push(`(SELECT ${childFieldNames.join(', ')} FROM ${c.relationshipName})`);
          } catch (cErr) {
            console.warn(`[ChildDescribe] Fallback for ${c.relationshipName}: ${cErr.message}`);
            childSubqueries.push(`(SELECT Id, ${c.foreignKeyField} FROM ${c.relationshipName})`);
          }
        }

        let rootSoql = `SELECT ${[...selectedFields, ...childSubqueries].join(', ')} FROM ${selectedRootObject}`;
        if (where) rootSoql += ` WHERE ${where}`;
        rootSoql += ` LIMIT ${limit}`;

        log(`Executing Source SOQL: ${rootSoql.substring(0, 100)}...`, 'info');
        rootRecords = await ApiClient.querySOQL(
          sourceSession.instanceUrl,
          sourceSession.sessionId,
          rootSoql,
          limit,
          { sourceSession }
        );

        log(`Extracted ${rootRecords.length} root records from Source Org.`, 'success');
        if (rootRecords.length === 0) {
          log('No records found matching filter. Terminating.', 'warning');
          execBadge.textContent = 'FINISHED';
          execBadge.className = 'badge badge-secondary';
          return;
        }

        // 1.5 Scan Child Records for Missing Required Parent/Lookup Dependencies
        for (const c of childConfigs) {
          if (!c.selected) continue;
          try {
            const childDesc = await SchemaEngine.describeSObject(
              sourceSession.instanceUrl,
              sourceSession,
              c.childObjectApiName
            );

            // Find all reference fields on the child that are not the foreign key back to root
            const childLookupFields = childDesc.fields.filter(
              f => f.type === 'reference' && 
                   f.name.toLowerCase() !== c.foreignKeyField.toLowerCase() && 
                   f.referenceTo && f.referenceTo.length > 0
            );

            for (const lf of childLookupFields) {
              const targetParentObj = lf.referenceTo[0];
              if (['user', 'group', 'organization', 'recordtype', 'profile'].includes(targetParentObj.toLowerCase())) continue;

              const childReferencedIds = [];
              for (const r of rootRecords) {
                const childData = r[c.relationshipName];
                const childList = Array.isArray(childData)
                  ? childData
                  : (childData && typeof childData === 'object' && Array.isArray(childData.records))
                    ? childData.records
                    : [];

                for (const cr of childList) {
                  const val = cr[lf.name];
                  if (typeof val === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(val)) {
                    childReferencedIds.push(val);
                  }
                }
              }

              const uniqueChildRefIds = Array.from(new Set(childReferencedIds));
              if (uniqueChildRefIds.length > 0) {
                if (!parentConfigs.some(p => p.parentObjectApiName.toLowerCase() === targetParentObj.toLowerCase())) {
                  parentConfigs.push({
                    relationshipName: lf.relationshipName || `${targetParentObj}_AutoRel`,
                    fieldApiName: lf.name,
                    parentObjectApiName: targetParentObj,
                    parentObjectLabel: targetParentObj,
                    isRequired: !lf.nillable,
                    selected: true
                  });
                  log(`Auto-detected child lookup: ${c.childObjectApiName}.${lf.name} -> ${targetParentObj} (${uniqueChildRefIds.length} records).`, 'info');
                }
              }
            }
          } catch (scanErr) {
            console.warn(`[ChildLookupScan] Failed for ${c.childObjectApiName}: ${scanErr.message}`);
          }
        }

        // 2. Fetch Parent Records (combining lookups from Root and all Child records)
        for (const p of parentConfigs) {
          if (!p.selected) continue;
          
          const rootParentIds = rootRecords.map(r => r[p.fieldApiName]).filter(Boolean);
          const childParentIds = [];

          for (const c of childConfigs) {
            if (!c.selected) continue;
            for (const r of rootRecords) {
              const childData = r[c.relationshipName];
              const childList = Array.isArray(childData)
                ? childData
                : (childData && typeof childData === 'object' && Array.isArray(childData.records))
                  ? childData.records
                  : [];

              for (const cr of childList) {
                for (const [k, v] of Object.entries(cr)) {
                  if (typeof v === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(v)) {
                    if (k.toLowerCase() === p.fieldApiName.toLowerCase() || k.toLowerCase().startsWith(p.parentObjectApiName.toLowerCase().replace(/__c$/, ''))) {
                      childParentIds.push(v);
                    }
                  }
                }
              }
            }
          }

          const parentIds = Array.from(new Set([...rootParentIds, ...childParentIds]));

          if (parentIds.length > 0) {
            log(`Querying ${parentIds.length} parent records for ${p.parentObjectApiName}...`, 'info');
            const parentDesc = await SchemaEngine.describeSObject(
              sourceSession.instanceUrl,
              sourceSession,
              p.parentObjectApiName
            );

            const pFields = parentDesc.fields.filter(f => f.createable || f.idLookup).map(f => f.name).join(', ');
            const PARENT_CHUNK_SIZE = 50;

            for (let cIdx = 0; cIdx < parentIds.length; cIdx += PARENT_CHUNK_SIZE) {
              const idChunk = parentIds.slice(cIdx, cIdx + PARENT_CHUNK_SIZE);
              const pSoql = `SELECT ${pFields} FROM ${p.parentObjectApiName} WHERE Id IN (${idChunk.map(id => `'${id}'`).join(',')})`;

              const pRecords = await ApiClient.querySOQL(
                sourceSession.instanceUrl,
                sourceSession.sessionId,
                pSoql,
                2000,
                { sourceSession }
              );

              pRecords.forEach(pr => {
                if (pr.Id) parentRecordMap.set(pr.Id, pr);
              });
            }

            const targetParentDesc = await SchemaEngine.describeSObject(targetOrg.instanceUrl, targetOrg, p.parentObjectApiName);
            if (chkAutoRT.checked) {
              parentRecordTypeMaps.set(p.parentObjectApiName, RecipeManager.buildRecordTypeTranslationMap(parentDesc, targetParentDesc));
            }
          }
        }

        // 2b. Upstream Parent Lookups Scan (e.g. Claim__c -> Payer__c, Provider__c)
        for (const p of parentConfigs) {
          if (!p.selected) continue;
          const missingUpstreamIds = [];
          for (const pr of parentRecordMap.values()) {
            for (const [k, v] of Object.entries(pr)) {
              if (typeof v === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(v) && !parentRecordMap.has(v)) {
                if (k.toLowerCase() === p.fieldApiName.toLowerCase() || k.toLowerCase().startsWith(p.parentObjectApiName.toLowerCase().replace(/__c$/, ''))) {
                  missingUpstreamIds.push(v);
                }
              }
            }
          }
          const uniqueMissing = Array.from(new Set(missingUpstreamIds));
          if (uniqueMissing.length > 0) {
            log(`Querying ${uniqueMissing.length} upstream parent records for ${p.parentObjectApiName}...`, 'info');
            const parentDesc = await SchemaEngine.describeSObject(sourceSession.instanceUrl, sourceSession, p.parentObjectApiName);
            const pFields = parentDesc.fields.filter(f => f.createable || f.idLookup).map(f => f.name).join(', ');
            const pSoql = `SELECT ${pFields} FROM ${p.parentObjectApiName} WHERE Id IN (${uniqueMissing.map(id => `'${id}'`).join(',')})`;
            const pRecords = await ApiClient.querySOQL(sourceSession.instanceUrl, sourceSession.sessionId, pSoql, 2000, { sourceSession });
            pRecords.forEach(pr => { if (pr.Id) parentRecordMap.set(pr.Id, pr); });
          }
        }
      }

      // Track for Purge/Rollback
      lastSeededSourceIds = rootRecords.map(r => r.Id).filter(Boolean);

      // 3. Compile RecordType Maps
      const recordTypeMapPerObject = new Map();
      if (chkAutoRT.checked) {
        const rootRTMap = RecipeManager.buildRecordTypeTranslationMap(rootDescribe, targetDescribe);
        recordTypeMapPerObject.set(selectedRootObject, rootRTMap);
        parentRecordTypeMaps.forEach((v, k) => recordTypeMapPerObject.set(k, v));
      }

      // 4. Compile Target Valid Fields, Picklist Maps & Auto-Detect External IDs
      const targetValidFields = new Map();
      const targetPicklistsPerObject = new Map();
      const targetExtIdFields = new Map();

      // Helper to extract picklist metadata for drift protection
      function extractPicklistMap(desc) {
        const pMap = new Map();
        if (!desc || !desc.fields) return pMap;
        for (const f of desc.fields) {
          if (f.type === 'picklist' || f.type === 'multipicklist') {
            const activeValues = new Set((f.picklistValues || []).filter(pv => pv.active).map(pv => pv.value));
            const defVal = (f.picklistValues || []).find(pv => pv.defaultValue && pv.active)?.value || (f.picklistValues || [])[0]?.value;
            pMap.set(f.name.toLowerCase(), {
              restricted: f.restrictedPicklist === true,
              nillable: f.nillable !== false,
              activeValues,
              defaultValue: defVal
            });
          }
        }
        return pMap;
      }

      // Helper to detect best External ID / unique field for an SObject
      function findExternalIdField(desc, preferredExtId) {
        if (!desc || !desc.fields) return null;
        const fields = desc.fields;
        if (preferredExtId) {
          const match = fields.find(f => f.name.toLowerCase() === preferredExtId.toLowerCase());
          if (match) return match.name;
        }
        const customExtId = fields.find(f => f.custom && (f.idLookup || f.unique) && f.name.toLowerCase() !== 'id');
        if (customExtId) return customExtId.name;
        const stdExtId = fields.find(f => !f.custom && f.idLookup && f.name.toLowerCase() !== 'id');
        if (stdExtId) return stdExtId.name;
        return null;
      }

      // Root SObject
      targetValidFields.set(
        selectedRootObject,
        new Set(targetDescribe.fields.filter(f => f.createable && !f.autoNumber && !f.calculated).map(f => f.name.toLowerCase()))
      );
      targetPicklistsPerObject.set(selectedRootObject, extractPicklistMap(targetDescribe));
      const rootExtId = findExternalIdField(targetDescribe, extIdField);
      if (rootExtId) targetExtIdFields.set(selectedRootObject, rootExtId);

      // Parent SObjects & Pre-Query Target for Existing Records
      const targetExistingParentIds = new Map(); // Source Parent ID -> Target Record ID

      for (const p of parentConfigs) {
        if (!p.selected) continue;
        const targetParentDesc = await SchemaEngine.describeSObject(targetOrg.instanceUrl, targetOrg, p.parentObjectApiName);
        targetValidFields.set(
          p.parentObjectApiName,
          new Set(targetParentDesc.fields.filter(f => f.createable && !f.autoNumber && !f.calculated).map(f => f.name.toLowerCase()))
        );
        targetPicklistsPerObject.set(p.parentObjectApiName, extractPicklistMap(targetParentDesc));
        const pExtId = findExternalIdField(targetParentDesc, extIdField);

        if (pExtId) {
          // Check field data type on target parent to format SOQL properly (Numbers vs Strings)
          const targetFieldObj = targetParentDesc.fields.find(f => f.name.toLowerCase() === pExtId.toLowerCase());
          const isNumberField = targetFieldObj && ['double', 'int', 'currency', 'percent'].includes(targetFieldObj.type?.toLowerCase());

          // Check if any source parents already exist in target org by external ID
          const relevantSourceParents = Array.from(parentRecordMap.values())
            .filter(r => (r.attributes?.type || '').toLowerCase() === p.parentObjectApiName.toLowerCase() || r.Id);

          const extIdToSourceIdsMap = new Map();
          const uniqueExtValsSet = new Set();

          relevantSourceParents.forEach(sp => {
            const val = sp[pExtId];
            if (val !== undefined && val !== null && String(val).trim()) {
              const rawVal = String(val).trim();
              const normalized = rawVal.replace(/\.0+$/, '');

              if (!extIdToSourceIdsMap.has(rawVal)) extIdToSourceIdsMap.set(rawVal, []);
              extIdToSourceIdsMap.get(rawVal).push(sp.Id);
              uniqueExtValsSet.add(rawVal);

              if (normalized !== rawVal) {
                if (!extIdToSourceIdsMap.has(normalized)) extIdToSourceIdsMap.set(normalized, []);
                extIdToSourceIdsMap.get(normalized).push(sp.Id);
                uniqueExtValsSet.add(normalized);
              }
            }
          });

          const uniqueExtVals = Array.from(uniqueExtValsSet);
          if (uniqueExtVals.length > 0) {
            log(`Checking target sandbox for ${relevantSourceParents.length} ${p.parentObjectApiName} by ${pExtId}...`, 'info');
            const TARGET_CHECK_CHUNK = 50;
            let foundCount = 0;

            for (let cIdx = 0; cIdx < uniqueExtVals.length; cIdx += TARGET_CHECK_CHUNK) {
              const valChunk = uniqueExtVals.slice(cIdx, cIdx + TARGET_CHECK_CHUNK);
              let formattedClause;

              if (isNumberField) {
                const numbers = valChunk
                  .map(v => {
                    const num = parseFloat(v);
                    return isNaN(num) ? null : num;
                  })
                  .filter(v => v !== null);

                if (numbers.length === 0) continue;
                formattedClause = numbers.join(',');
              } else {
                formattedClause = valChunk.map(v => `'${String(v).replace(/'/g, "\\'")}'`).join(',');
              }

              const targetSoql = `SELECT Id, ${pExtId} FROM ${p.parentObjectApiName} WHERE ${pExtId} IN (${formattedClause})`;

              try {
                const targetMatches = await ApiClient.querySOQL(
                  targetOrg.instanceUrl,
                  targetOrg.accessToken,
                  targetSoql,
                  2000,
                  { targetOrg }
                );

                targetMatches.forEach(tm => {
                  const rawTargetVal = String(tm[pExtId] || '').trim();
                  const normalizedTargetVal = rawTargetVal.replace(/\.0+$/, '');
                  const sourceIds = (extIdToSourceIdsMap.get(rawTargetVal) || []).concat(extIdToSourceIdsMap.get(normalizedTargetVal) || []);

                  for (const sId of sourceIds) {
                    if (sId && tm.Id && !targetExistingParentIds.has(sId)) {
                      targetExistingParentIds.set(sId, tm.Id);
                      foundCount++;
                    }
                  }
                });
              } catch (qErr) {
                console.warn(`[TargetParentCheck] Query failed for ${p.parentObjectApiName}: ${qErr.message}`);
              }
            }

            if (foundCount > 0) {
              log(`✓ Matched ${foundCount} existing ${p.parentObjectApiName} in target sandbox. Direct linking enabled.`, 'success');
            }
          }
        }
      }

      // Child SObjects
      for (const c of childConfigs) {
        if (!c.selected) continue;
        const targetChildDesc = await SchemaEngine.describeSObject(targetOrg.instanceUrl, targetOrg, c.childObjectApiName);
        targetValidFields.set(
          c.childObjectApiName,
          new Set(targetChildDesc.fields.filter(f => f.createable && !f.autoNumber && !f.calculated).map(f => f.name.toLowerCase()))
        );
        targetPicklistsPerObject.set(c.childObjectApiName, extractPicklistMap(targetChildDesc));
        const cExtId = findExternalIdField(targetChildDesc, extIdField);
        if (cExtId) targetExtIdFields.set(c.childObjectApiName, cExtId);
      }

      log('Compiling 3-Tier Composite Graphs (PII Masking & RT Translation active)...', 'info');
      const payloadBatches = GraphBuilder.buildPayloadBatches({
        rootObjectApiName: selectedRootObject,
        rootRecords,
        parentConfigs,
        childConfigs,
        parentRecordMap,
        targetExistingParentIds,
        targetValidFieldsPerObject: targetValidFields,
        targetPicklistsPerObject,
        externalIdFieldPerObject: targetExtIdFields,
        recordTypeMapPerObject,
        targetOwnerId: chkReassignOwner.checked ? targetOrg.userId : undefined,
        piiMasking: {
          maskEmails: chkMaskEmails.checked,
          maskPhones: chkMaskPhones.checked,
          anonymizeNames: chkMaskNames.checked
        }
      });

      log(`Generated ${payloadBatches.length} Composite Graph payload batch(es).`, 'info');

      let successTotal = 0;
      let failedTotal = 0;

      for (let bIdx = 0; bIdx < payloadBatches.length; bIdx++) {
        const batch = payloadBatches[bIdx];
        log(`Dispatching Batch ${bIdx + 1}/${payloadBatches.length} (${batch.graphs.length} graphs)...`, 'info');

        const apiResponse = await ApiClient.postCompositeGraph(targetOrg, batch);

        for (const g of apiResponse.graphs || []) {
          if (g.isSuccessful) successTotal++;
          else failedTotal++;
        }

        if (failedTotal > 0) {
          const errs = ApiClient.parseCompositeGraphErrors(apiResponse);
          errs.slice(0, 3).forEach(e => log(e, 'error'));
        }

        const pct = Math.round(((bIdx + 1) / payloadBatches.length) * 100);
        execProgressBar.style.width = `${pct}%`;
        execProgressText.textContent = `Progress: ${pct}%`;
        execBatchText.textContent = `Batches: ${bIdx + 1}/${payloadBatches.length}`;
        statSuccessGraphs.textContent = successTotal;
        statFailedGraphs.textContent = failedTotal;
      }

      execBadge.textContent = failedTotal === 0 ? 'SUCCESS' : 'COMPLETED';
      execBadge.className = failedTotal === 0 ? 'badge badge-success' : 'badge badge-warning';
      log(`🎉 Data seeding finished! Success: ${successTotal}, Failed: ${failedTotal}`, successTotal > 0 ? 'success' : 'warning');
    } catch (err) {
      execBadge.textContent = 'FAILED';
      execBadge.className = 'badge badge-error';
      log(`FATAL ERROR: ${err.message}`, 'error');
      alert(`Transfer Error: ${err.message}`);
    } finally {
      btnStartSeeding.disabled = false;
      btnStartSeeding.textContent = 'Start Seeding ⚡';
    }
  });

  // Remove Selected Target Org Handler
  const btnRemoveSelectedTarget = document.getElementById('btn-remove-selected-target');
  btnRemoveSelectedTarget?.addEventListener('click', async () => {
    const selectedAlias = targetSelectEl.value;
    if (!selectedAlias) {
      alert('No target org is currently selected.');
      return;
    }
    if (confirm(`Remove '${selectedAlias}' from saved target orgs?`)) {
      await chrome.runtime.sendMessage({
        type: 'DISCONNECT_TARGET_ORG',
        payload: { alias: selectedAlias }
      });
      await loadTargetOrgs();
      log(`Removed target org '${selectedAlias}'.`, 'info');
    }
  });

  // Clear Stored Target Orgs Handler
  btnClearTargets?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to remove all saved target sandboxes and cached sessions?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_STORED_ORGS' });
      await loadTargetOrgs();
      log('All stored target orgs and session credentials have been cleared.', 'info');
    }
  });

  // Initial load
  await refreshSourceOrg();
  await loadTargetOrgs();
});
