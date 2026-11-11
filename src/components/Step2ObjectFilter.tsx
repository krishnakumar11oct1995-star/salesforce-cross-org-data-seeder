import React, { useState } from 'react';
import { useSeederStore } from '../store/useSeederStore';
import { SchemaEngine } from '../schemaEngine';

export const Step2ObjectFilter: React.FC = () => {
  const {
    sourceSession,
    eligibleObjects,
    selectedRootObject,
    setSelectedRootObject,
    whereClause,
    setWhereClause,
    recordLimit,
    setRecordLimit,
    setRootDescribe,
    setParentConfigs,
    setChildConfigs,
    setStep,
    setLoading,
    addLog
  } = useSeederStore();

  const [searchTerm, setSearchTerm] = useState('');

  const filteredObjects = eligibleObjects.filter(
    (obj) =>
      obj.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      obj.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleProceed = async () => {
    if (!selectedRootObject) {
      alert('Please select a root SObject to seed.');
      return;
    }
    if (!sourceSession) {
      alert('Source session expired. Please return to Step 1.');
      return;
    }

    try {
      setLoading(true, `Introspecting schema for ${selectedRootObject}...`);
      addLog(`Describing schema for root object: ${selectedRootObject}`, 'info');

      const describe = await SchemaEngine.describeSObject(
        sourceSession.instanceUrl,
        sourceSession.sessionId,
        selectedRootObject
      );

      setRootDescribe(describe);

      const parents = SchemaEngine.getParentRelationships(describe);
      const children = SchemaEngine.getChildRelationships(describe);

      setParentConfigs(parents);
      setChildConfigs(children);

      addLog(`Discovered ${parents.length} parent lookups and ${children.length} child relationships.`, 'success');
      setStep(3);
    } catch (err: unknown) {
      alert(`Schema describe error: ${(err as Error).message}`);
      addLog(`Failed to describe ${selectedRootObject}: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2.5">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Root Object Selection
        </h2>

        <div>
          <input
            type="text"
            placeholder="Search standard & custom objects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs p-1.5 border border-slate-300 rounded mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="max-h-40 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
            {filteredObjects.length === 0 ? (
              <div className="p-2 text-xs text-slate-400 text-center">No objects found.</div>
            ) : (
              filteredObjects.map((obj) => (
                <div
                  key={obj.name}
                  onClick={() => setSelectedRootObject(obj.name)}
                  className={`p-2 text-xs flex justify-between items-center cursor-pointer transition ${
                    selectedRootObject === obj.name
                      ? 'bg-blue-50 text-blue-700 font-bold border-l-2 border-blue-600'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div>
                    <span>{obj.label}</span>
                    <span className="text-[10px] text-slate-400 ml-1.5 font-mono">({obj.name})</span>
                  </div>
                  {obj.custom && (
                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1 rounded font-semibold">
                      Custom
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* WHERE Clause Filter */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            SOQL Filter (WHERE Clause)
          </label>
          <input
            type="text"
            value={whereClause}
            onChange={(e) => setWhereClause(e.target.value)}
            placeholder="e.g. Status__c = 'Active' AND CreatedDate = THIS_YEAR"
            className="w-full text-xs p-1.5 border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Record Limit */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold text-slate-600">
              Record Limit
            </label>
            <span className="text-xs font-bold text-blue-700 font-mono">
              {recordLimit} records
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={200}
            step={5}
            value={recordLimit}
            onChange={(e) => setRecordLimit(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>
      </div>

      {/* Buttons */}
      <div className="flex space-x-2">
        <button
          onClick={() => setStep(1)}
          className="w-1/3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
        >
          ← Back
        </button>
        <button
          onClick={handleProceed}
          disabled={!selectedRootObject}
          className="w-2/3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50 shadow"
        >
          Next: Map Relationships →
        </button>
      </div>
    </div>
  );
};
