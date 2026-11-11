import React, { useState } from 'react';
import { useSeederStore } from '../store/useSeederStore';
import { SchemaEngine } from '../schemaEngine';
import { ApiClient } from '../apiClient';

export const Step3DependencyTree: React.FC = () => {
  const {
    sourceSession,
    targetOrgs,
    selectedTargetAlias,
    selectedRootObject,
    rootDescribe,
    parentConfigs,
    toggleParentSelection,
    childConfigs,
    toggleChildSelection,
    recordLimit,
    whereClause,
    setFieldMappings,
    updateStorageEstimation,
    setStep,
    setLoading,
    addLog
  } = useSeederStore();

  const [activeTab, setActiveTab] = useState<'parents' | 'children'>('parents');

  const selectedParentsCount = parentConfigs.filter((p) => p.selected).length;
  const selectedChildrenCount = childConfigs.filter((c) => c.selected).length;

  const handleProceed = async () => {
    if (!sourceSession || !rootDescribe) {
      alert('Missing schema details. Please restart from Step 1.');
      return;
    }

    const targetOrg = targetOrgs.find((o) => o.alias === selectedTargetAlias);
    if (!targetOrg) {
      alert('Selected target organization is unavailable.');
      return;
    }

    try {
      setLoading(true, 'Auditing Target Org schema & calculating storage...');
      addLog(`Auditing target sandbox schema for ${selectedRootObject}...`, 'info');

      // 1. Fetch Target Org Describe for Root Object
      const targetDescribe = await SchemaEngine.describeSObject(
        targetOrg.instanceUrl,
        targetOrg.accessToken,
        selectedRootObject
      );

      // 2. Reconcile Fields
      const mappings = SchemaEngine.reconcileSchemas(rootDescribe, targetDescribe);
      setFieldMappings(mappings);

      // 3. Estimate Counts & Storage Impact
      const rootCount = recordLimit;
      const parentMultiplier = selectedParentsCount;
      const childMultiplier = selectedChildrenCount * 3; // Approx 3 child records per root

      const parentCount = rootCount * parentMultiplier;
      const childCount = rootCount * childMultiplier;
      const totalRecords = rootCount + parentCount + childCount;
      const estimatedKb = totalRecords * 2; // Fixed ~2 KB per record

      updateStorageEstimation({
        rootCount,
        parentCount,
        childCount,
        totalRecords,
        estimatedKb
      });

      addLog(`Schema reconciled: ${mappings.filter(m => m.status === 'MATCH').length} fields matched.`, 'success');
      setStep(4);
    } catch (err: unknown) {
      alert(`Target schema audit error: ${(err as Error).message}`);
      addLog(`Failed target schema reconciliation: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {/* Tab Headers */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs">
          <button
            onClick={() => setActiveTab('parents')}
            className={`flex-1 py-2 font-bold text-center border-b-2 transition ${
              activeTab === 'parents'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Parents ({selectedParentsCount}/{parentConfigs.length})
          </button>
          <button
            onClick={() => setActiveTab('children')}
            className={`flex-1 py-2 font-bold text-center border-b-2 transition ${
              activeTab === 'children'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Child Trees ({selectedChildrenCount}/{childConfigs.length})
          </button>
        </div>

        {/* Tab Content: Parents */}
        {activeTab === 'parents' && (
          <div className="p-2.5 max-h-60 overflow-y-auto divide-y divide-slate-100">
            {parentConfigs.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center">
                No foreign key parent lookups on this object.
              </div>
            ) : (
              parentConfigs.map((parent) => (
                <label
                  key={parent.fieldApiName}
                  className="flex items-center justify-between p-1.5 text-xs hover:bg-slate-50 cursor-pointer rounded"
                >
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={parent.selected}
                      onChange={() => toggleParentSelection(parent.fieldApiName)}
                      className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-800">
                        {parent.relationshipName}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {parent.fieldApiName} &rarr; {parent.parentObjectApiName}
                      </span>
                    </div>
                  </div>
                  {parent.isRequired ? (
                    <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                      Required
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-400">Optional</span>
                  )}
                </label>
              ))
            )}
          </div>
        )}

        {/* Tab Content: Children */}
        {activeTab === 'children' && (
          <div className="p-2.5 max-h-60 overflow-y-auto divide-y divide-slate-100">
            {childConfigs.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center">
                No related child lists discovered on this object.
              </div>
            ) : (
              childConfigs.map((child) => (
                <label
                  key={child.relationshipName}
                  className="flex items-center justify-between p-1.5 text-xs hover:bg-slate-50 cursor-pointer rounded"
                >
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={child.selected}
                      onChange={() => toggleChildSelection(child.relationshipName)}
                      className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-800">
                        {child.relationshipName}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Child SObject: {child.childObjectApiName}
                      </span>
                    </div>
                  </div>
                  <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                    {child.foreignKeyField}
                  </span>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex space-x-2">
        <button
          onClick={() => setStep(2)}
          className="w-1/3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
        >
          ← Back
        </button>
        <button
          onClick={handleProceed}
          className="w-2/3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow"
        >
          Next: Storage Sizing →
        </button>
      </div>
    </div>
  );
};
