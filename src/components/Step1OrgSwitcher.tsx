import React, { useEffect, useState } from 'react';
import { useSeederStore } from '../store/useSeederStore';
import { SchemaEngine } from '../schemaEngine';

export const Step1OrgSwitcher: React.FC = () => {
  const {
    sourceSession,
    setSourceSession,
    targetOrgs,
    setTargetOrgs,
    selectedTargetAlias,
    setSelectedTargetAlias,
    targetExternalIdField,
    setTargetExternalIdField,
    setEligibleObjects,
    setStep,
    setLoading,
    addLog
  } = useSeederStore();

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [alias, setAlias] = useState('');
  const [loginUrl, setLoginUrl] = useState('https://test.salesforce.com');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    refreshEnvironments();
  }, []);

  const refreshEnvironments = async () => {
    try {
      setLoading(true, 'Checking active Salesforce session...');
      const sessionRes = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ORG_SESSION' });

      if (sessionRes?.success && sessionRes.data) {
        setSourceSession(sessionRes.data);
        addLog(`Detected active source org: ${sessionRes.data.instanceUrl}`, 'success');
      } else {
        setSourceSession(null);
        addLog(sessionRes?.error || 'No active Salesforce tab detected.', 'warning');
      }

      const orgsRes = await chrome.runtime.sendMessage({ type: 'GET_TARGET_ORGS' });
      if (orgsRes?.success && Array.isArray(orgsRes.data)) {
        setTargetOrgs(orgsRes.data);
        if (orgsRes.data.length > 0 && !selectedTargetAlias) {
          setSelectedTargetAlias(orgsRes.data[0].alias);
        }
      }
    } catch (err: unknown) {
      addLog(`Failed to initialize environments: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alias || !loginUrl || !username || !password) {
      alert('Please enter Alias, Login URL, Username, and Password.');
      return;
    }

    try {
      setIsAuthenticating(true);
      addLog(`Logging into target sandbox '${alias}' with username: ${username}...`, 'info');

      const response = await chrome.runtime.sendMessage({
        type: 'CONNECT_TARGET_ORG_DIRECT',
        payload: { alias, loginUrl, username, password }
      });

      if (response?.success && response.data) {
        addLog(`Successfully connected target org: ${alias} (${response.data.instanceUrl})`, 'success');
        setShowConnectModal(false);
        setAlias('');
        setUsername('');
        setPassword('');

        const orgsRes = await chrome.runtime.sendMessage({ type: 'GET_TARGET_ORGS' });
        if (orgsRes?.success) {
          setTargetOrgs(orgsRes.data);
          setSelectedTargetAlias(alias);
        }
      } else {
        throw new Error(response?.error || 'Authentication failed.');
      }
    } catch (err: unknown) {
      alert(`Login Error: ${(err as Error).message}`);
      addLog(`Login Error: ${(err as Error).message}`, 'error');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleProceed = async () => {
    if (!sourceSession) {
      alert('Please open an active Salesforce tab before proceeding.');
      return;
    }
    if (!selectedTargetAlias) {
      alert('Please select or connect a target sandbox environment.');
      return;
    }

    try {
      setLoading(true, 'Fetching eligible SObjects from Source Org...');
      const objects = await SchemaEngine.getEligibleObjects(
        sourceSession.instanceUrl,
        sourceSession.sessionId
      );
      setEligibleObjects(objects);
      setStep(2);
    } catch (err: unknown) {
      alert(`Failed to load objects: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* Source Org Box */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            1. Source Org (Active Tab)
          </h2>
          <button
            onClick={refreshEnvironments}
            className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
          >
            ↻ Refresh
          </button>
        </div>

        {sourceSession ? (
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs space-y-0.5">
            <div className="font-semibold text-slate-800 truncate">
              {sourceSession.instanceUrl}
            </div>
            <div className="text-[11px] text-emerald-600 font-medium flex items-center">
              ● Connected ({sourceSession.isSandbox ? 'Sandbox' : 'Production'})
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
            ⚠️ No active Salesforce session detected. Open a Salesforce tab in Edge.
          </div>
        )}
      </div>

      {/* Target Org Box */}
      <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            2. Target Sandbox
          </h2>
          <button
            onClick={() => setShowConnectModal(true)}
            className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold border border-blue-200 hover:bg-blue-100"
          >
            + Add Target Org
          </button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Select Destination
            </label>
            <select
              value={selectedTargetAlias}
              onChange={(e) => setSelectedTargetAlias(e.target.value)}
              className="w-full text-xs p-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            >
              {targetOrgs.length === 0 ? (
                <option value="">-- No sandboxes connected --</option>
              ) : (
                targetOrgs.map((org) => (
                  <option key={org.alias} value={org.alias}>
                    {org.alias} ({org.instanceUrl})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Target Ext ID Field (for Upserts)
            </label>
            <input
              type="text"
              value={targetExternalIdField}
              onChange={(e) => setTargetExternalIdField(e.target.value)}
              placeholder="e.g. Source_Record_Id__c"
              className="w-full text-xs p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Modal: Direct Username & Password Login (No Client ID needed) */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg p-3 w-full max-w-xs shadow-xl border border-slate-200 space-y-2.5">
            <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
              <div>
                <h3 className="text-xs font-bold text-slate-800">Connect Target Sandbox</h3>
                <span className="text-[10px] text-slate-500">Direct Login (No Client ID needed)</span>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDirectLogin} className="space-y-2 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Alias Name</label>
                <input
                  type="text"
                  required
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="e.g. TeamDev_Sandbox"
                  className="w-full p-1.5 border border-slate-300 rounded text-xs"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Environment Type</label>
                <select
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  className="w-full p-1.5 border border-slate-300 rounded text-xs"
                >
                  <option value="https://test.salesforce.com">Sandbox (test.salesforce.com)</option>
                  <option value="https://login.salesforce.com">Prod/Dev (login.salesforce.com)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Target Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="user@example.com.sandbox"
                  className="w-full p-1.5 border border-slate-300 rounded text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">Target Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password or Password + SecurityToken"
                  className="w-full p-1.5 border border-slate-300 rounded text-xs"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-2.5 py-1 text-slate-600 border border-slate-300 rounded text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAuthenticating}
                  className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {isAuthenticating ? 'Logging in...' : 'Login & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Next Button */}
      <button
        onClick={handleProceed}
        disabled={!sourceSession || !selectedTargetAlias}
        className="w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition shadow disabled:opacity-50 flex items-center justify-center space-x-1"
      >
        <span>Next: Select Object & Filter</span>
        <span>→</span>
      </button>
    </div>
  );
};
