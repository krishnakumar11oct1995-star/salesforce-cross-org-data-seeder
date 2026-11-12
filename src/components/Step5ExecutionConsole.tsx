import React, { useEffect, useRef, useState } from 'react';
import { useSeederStore } from '../store/useSeederStore';
import { ApiClient } from '../apiClient';
import { SchemaEngine } from '../schemaEngine';
import { GraphBuilder } from '../graphBuilder';
import { SObjectRecordData } from '../types';
import { assertApiName, formatIdList } from '../soqlUtils';

export const Step5ExecutionConsole: React.FC = () => {
  const {
    sourceSession,
    targetOrgs,
    selectedTargetAlias,
    selectedRootObject,
    rootDescribe,
    whereClause,
    recordLimit,
    parentConfigs,
    childConfigs,
    targetExternalIdField,
    executionProgress,
    setExecutionProgress,
    logs,
    addLog,
    clearLogs,
    setStep
  } = useSeederStore();

  const [isExecuting, setIsExecuting] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleStartTransfer = async () => {
    if (!sourceSession || !rootDescribe) {
      alert('Source session expired.');
      return;
    }

    const targetOrg = targetOrgs.find((o) => o.alias === selectedTargetAlias);
    if (!targetOrg) {
      alert('Target sandbox not found.');
      return;
    }

    try {
      setIsExecuting(true);
      clearLogs();
      setExecutionProgress({
        status: 'RUNNING',
        totalBatches: 0,
        completedBatches: 0,
        successfulGraphs: 0,
        failedGraphs: 0,
        totalRecordsProcessed: 0,
        errors: []
      });

      addLog(`🚀 Starting cross-org data transfer for ${selectedRootObject}...`, 'info');
      addLog(`Target Destination: ${targetOrg.alias} (${targetOrg.instanceUrl})`, 'info');

      // 1. Build Source Root Query
      const selectedFields = rootDescribe.fields
        .filter((f) => f.createable || f.idLookup)
        .map((f) => f.name);

      // Add parent lookup foreign keys
      for (const p of parentConfigs) {
        if (p.selected && !selectedFields.includes(p.fieldApiName)) {
          selectedFields.push(p.fieldApiName);
        }
      }

      // Add child sub-queries
      const childSubqueries = childConfigs
        .filter((c) => c.selected)
        .map((c) => `(SELECT Id, ${assertApiName(c.foreignKeyField)} FROM ${assertApiName(c.relationshipName)})`);

      const queryFields = [...selectedFields.map(assertApiName), ...childSubqueries].join(', ');
      let rootSoql = `SELECT ${queryFields} FROM ${assertApiName(selectedRootObject)}`;
      if (whereClause && whereClause.trim().length > 0) {
        rootSoql += ` WHERE ${whereClause}`;
      }
      rootSoql += ` LIMIT ${Math.max(1, Math.min(50000, Math.floor(Number(recordLimit)) || 1))}`;

      addLog(`Executing Source SOQL query: ${rootSoql.substring(0, 100)}...`, 'info');
      const rootRecords = await ApiClient.querySOQL<SObjectRecordData>(
        sourceSession.instanceUrl,
        sourceSession.sessionId,
        rootSoql,
        recordLimit
      );

      addLog(`Extracted ${rootRecords.length} root records from Source Org.`, 'success');
      if (rootRecords.length === 0) {
        addLog('No records matched the filter criteria. Terminating.', 'warning');
        setExecutionProgress({ status: 'COMPLETED' });
        return;
      }

      // 2. Fetch Parent Records
      const parentRecordMap = new Map<string, SObjectRecordData>();
      for (const p of parentConfigs) {
        if (!p.selected) continue;

        const parentIds = Array.from(
          new Set(
            rootRecords
              .map((r) => r[p.fieldApiName] as string)
              .filter((id) => Boolean(id))
          )
        );

        if (parentIds.length > 0) {
          addLog(`Querying ${parentIds.length} parent records for ${p.parentObjectApiName}...`, 'info');
          const parentDescribe = await SchemaEngine.describeSObject(
            sourceSession.instanceUrl,
            sourceSession.sessionId,
            p.parentObjectApiName
          );

          const pFields = parentDescribe.fields
            .filter((f) => f.createable || f.idLookup)
            .map((f) => f.name)
            .join(', ');

          const formattedIds = formatIdList(parentIds);
          const parentSoql = `SELECT ${pFields} FROM ${assertApiName(p.parentObjectApiName)} WHERE Id IN (${formattedIds})`;

          const pRecords = await ApiClient.querySOQL<SObjectRecordData>(
            sourceSession.instanceUrl,
            sourceSession.sessionId,
            parentSoql
          );

          for (const pr of pRecords) {
            if (pr.Id) parentRecordMap.set(pr.Id, pr);
          }
        }
      }

      // 3. Build Target Valid Fields Map
      const targetValidFields = new Map<string, Set<string>>();
      const targetExtIdFields = new Map<string, string>();

      // Describe Root in Target
      const rootTargetDesc = await SchemaEngine.describeSObject(
        targetOrg.instanceUrl,
        targetOrg.accessToken,
        selectedRootObject
      );
      targetValidFields.set(
        selectedRootObject,
        new Set(rootTargetDesc.fields.filter((f) => f.createable || f.idLookup).map((f) => f.name.toLowerCase()))
      );
      if (targetExternalIdField) {
        targetExtIdFields.set(selectedRootObject, targetExternalIdField);
      }

      // 4. Compile Composite Graphs
      addLog('Compiling 3-Tier Composite Graph payloads with deduplication...', 'info');
      const payloadBatches = GraphBuilder.buildPayloadBatches({
        rootObjectApiName: selectedRootObject,
        rootRecords,
        parentConfigs,
        childConfigs,
        parentRecordMap,
        targetValidFieldsPerObject: targetValidFields,
        externalIdFieldPerObject: targetExtIdFields
      });

      addLog(`Generated ${payloadBatches.length} Composite Graph payload batch(es).`, 'info');
      setExecutionProgress({ totalBatches: payloadBatches.length });

      let successGraphsTotal = 0;
      let failedGraphsTotal = 0;
      const collectedErrors: string[] = [];

      // 5. Stream Composite Graph Batches to Target Org
      for (let bIdx = 0; bIdx < payloadBatches.length; bIdx++) {
        const batch = payloadBatches[bIdx];
        addLog(`Dispatching Graph Batch ${bIdx + 1}/${payloadBatches.length} (${batch.graphs.length} graphs)...`, 'info');

        const apiResponse = await ApiClient.postCompositeGraph(targetOrg, batch);

        let batchSuccess = 0;
        let batchFailed = 0;

        for (const g of apiResponse.graphs || []) {
          if (g.isSuccessful) {
            batchSuccess++;
          } else {
            batchFailed++;
          }
        }

        successGraphsTotal += batchSuccess;
        failedGraphsTotal += batchFailed;

        if (batchFailed > 0) {
          const graphErrors = ApiClient.parseCompositeGraphErrors(apiResponse);
          collectedErrors.push(...graphErrors);
          graphErrors.slice(0, 3).forEach((err) => addLog(err, 'error'));
        }

        setExecutionProgress({
          completedBatches: bIdx + 1,
          successfulGraphs: successGraphsTotal,
          failedGraphs: failedGraphsTotal,
          totalRecordsProcessed: (bIdx + 1) * 50,
          errors: collectedErrors
        });
      }

      // Final Status
      if (failedGraphsTotal === 0) {
        addLog(`🎉 Seeding completed successfully! ${successGraphsTotal} graphs deployed.`, 'success');
        setExecutionProgress({ status: 'COMPLETED' });
      } else {
        addLog(`⚠️ Seeding completed with ${failedGraphsTotal} failed graphs.`, 'warning');
        setExecutionProgress({ status: 'COMPLETED' });
      }
    } catch (err: unknown) {
      addLog(`FATAL ERROR: ${(err as Error).message}`, 'error');
      setExecutionProgress({ status: 'FAILED' });
    } finally {
      setIsExecuting(false);
    }
  };

  const progressPercent =
    executionProgress.totalBatches > 0
      ? Math.round(
          (executionProgress.completedBatches / executionProgress.totalBatches) * 100
        )
      : 0;

  return (
    <div className="p-3 space-y-3">
      {/* Execution Status Card */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-2.5">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Execution Console
          </h2>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              executionProgress.status === 'RUNNING'
                ? 'bg-blue-100 text-blue-800 animate-pulse'
                : executionProgress.status === 'COMPLETED'
                ? 'bg-emerald-100 text-emerald-800'
                : executionProgress.status === 'FAILED'
                ? 'bg-red-100 text-red-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {executionProgress.status}
          </span>
        </div>

        {/* Streaming Progress Bar */}
        <div>
          <div className="flex justify-between text-[11px] font-semibold text-slate-600 mb-1">
            <span>Progress: {progressPercent}%</span>
            <span>
              Batches: {executionProgress.completedBatches}/{executionProgress.totalBatches}
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>

        {/* Results Tally */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-emerald-50 p-2 rounded border border-emerald-200 text-center">
            <span className="text-[10px] text-emerald-700 block font-semibold">
              Successful Graphs
            </span>
            <span className="font-bold text-emerald-900 text-base">
              {executionProgress.successfulGraphs}
            </span>
          </div>
          <div className="bg-red-50 p-2 rounded border border-red-200 text-center">
            <span className="text-[10px] text-red-700 block font-semibold">
              Failed Graphs
            </span>
            <span className="font-bold text-red-900 text-base">
              {executionProgress.failedGraphs}
            </span>
          </div>
        </div>
      </div>

      {/* Terminal Log Console */}
      <div className="bg-slate-900 rounded-lg p-2.5 shadow-inner border border-slate-800">
        <div className="flex justify-between items-center border-b border-slate-800 pb-1 mb-1.5">
          <span className="text-[10px] font-mono text-slate-400">Activity Stream</span>
          <button
            onClick={clearLogs}
            className="text-[10px] text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        </div>

        <div
          ref={logContainerRef}
          className="h-44 overflow-y-auto space-y-1 font-mono text-[10px] leading-tight select-text"
        >
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">Ready. Click 'Start Seeding' to begin.</div>
          ) : (
            logs.map((l) => (
              <div
                key={l.id}
                className={`${
                  l.type === 'error'
                    ? 'text-red-400'
                    : l.type === 'success'
                    ? 'text-emerald-400'
                    : l.type === 'warning'
                    ? 'text-amber-400'
                    : 'text-slate-300'
                }`}
              >
                <span className="text-slate-500 mr-1">[{l.timestamp}]</span>
                {l.message}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-2">
        <button
          onClick={() => setStep(4)}
          disabled={isExecuting}
          className="w-1/3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200 disabled:opacity-50"
        >
          ← Back
        </button>
        <button
          onClick={handleStartTransfer}
          disabled={isExecuting}
          className="w-2/3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow disabled:opacity-50 flex items-center justify-center space-x-1"
        >
          <span>{isExecuting ? 'Transferring...' : 'Start Seeding ⚡'}</span>
        </button>
      </div>
    </div>
  );
};
