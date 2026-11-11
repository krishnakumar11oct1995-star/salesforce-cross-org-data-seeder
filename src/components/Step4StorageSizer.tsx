import React from 'react';
import { useSeederStore } from '../store/useSeederStore';

export const Step4StorageSizer: React.FC = () => {
  const {
    selectedRootObject,
    selectedTargetAlias,
    storageEstimation,
    targetQuotaMb,
    fieldMappings,
    setStep
  } = useSeederStore();

  const totalMb = (storageEstimation.estimatedKb / 1024).toFixed(2);
  const quotaPercent = Math.min(
    100,
    parseFloat(((parseFloat(totalMb) / targetQuotaMb) * 100).toFixed(2))
  );

  const matchedCount = fieldMappings.filter((m) => m.status === 'MATCH').length;
  const missingCount = fieldMappings.filter((m) => m.status === 'MISSING_IN_TARGET').length;
  const readOnlyCount = fieldMappings.filter((m) => m.status === 'READ_ONLY_TARGET').length;

  return (
    <div className="p-3 space-y-3">
      {/* Storage Calculator Card */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2.5">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Predictive Storage Sizing
        </h2>

        {/* Quota Progress Bar */}
        <div>
          <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
            <span>Estimated Footprint: {totalMb} MB</span>
            <span>Target Cap: {targetQuotaMb} MB</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200">
            <div
              className={`h-2.5 rounded-full transition-all ${
                quotaPercent > 80
                  ? 'bg-red-500'
                  : quotaPercent > 50
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.max(2, quotaPercent)}%` }}
            ></div>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5 text-right">
            {quotaPercent}% of target sandbox quota
          </span>
        </div>

        {/* Record Breakdown Matrix */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-50 p-2 rounded border border-slate-200">
            <span className="text-[10px] text-slate-500 block">Root Records</span>
            <span className="font-bold text-slate-800 text-sm">
              {storageEstimation.rootCount}
            </span>
          </div>
          <div className="bg-slate-50 p-2 rounded border border-slate-200">
            <span className="text-[10px] text-slate-500 block">Parent Lookups</span>
            <span className="font-bold text-slate-800 text-sm">
              ~{storageEstimation.parentCount}
            </span>
          </div>
          <div className="bg-slate-50 p-2 rounded border border-slate-200">
            <span className="text-[10px] text-slate-500 block">Child Trees</span>
            <span className="font-bold text-slate-800 text-sm">
              ~{storageEstimation.childCount}
            </span>
          </div>
          <div className="bg-blue-50 p-2 rounded border border-blue-200">
            <span className="text-[10px] text-blue-700 block font-semibold">Total Records</span>
            <span className="font-bold text-blue-900 text-sm">
              ~{storageEstimation.totalRecords}
            </span>
          </div>
        </div>
      </div>

      {/* Cross-Org Schema Pre-Validation Card */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Schema Compatibility Audit
        </h3>

        <div className="space-y-1 text-xs">
          <div className="flex justify-between items-center p-1.5 bg-emerald-50 rounded text-emerald-800 border border-emerald-200">
            <span>✓ Matched Fields:</span>
            <span className="font-bold">{matchedCount}</span>
          </div>
          {missingCount > 0 && (
            <div className="flex justify-between items-center p-1.5 bg-amber-50 rounded text-amber-800 border border-amber-200">
              <span>⚠️ Missing in Target (Excluded):</span>
              <span className="font-bold">{missingCount}</span>
            </div>
          )}
          {readOnlyCount > 0 && (
            <div className="flex justify-between items-center p-1.5 bg-slate-50 rounded text-slate-600 border border-slate-200">
              <span>ℹ Read-Only Fields (Omitted):</span>
              <span className="font-bold">{readOnlyCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex space-x-2">
        <button
          onClick={() => setStep(3)}
          className="w-1/3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep(5)}
          className="w-2/3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 shadow"
        >
          Initiate 3-Tier Seeding ⚡
        </button>
      </div>
    </div>
  );
};
