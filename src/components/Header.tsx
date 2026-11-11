import React from 'react';
import { useSeederStore } from '../store/useSeederStore';

export const Header: React.FC = () => {
  const { sourceSession, isLoading } = useSeederStore();

  return (
    <header className="slds-global-header flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200 shadow-sm">
      <div className="flex items-center space-x-2">
        <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-sm shadow">
          ⚡
        </div>
        <div>
          <h1 className="text-xs font-bold text-slate-800 tracking-tight leading-none">
            SF Data Seeder
          </h1>
          <span className="text-[10px] text-slate-500 font-medium">
            Cross-Org Relational Mover
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-1.5">
        {sourceSession ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 mr-1 bg-emerald-500 rounded-full animate-pulse"></span>
            Online
          </span>
        ) : (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            No Tab
          </span>
        )}
      </div>
    </header>
  );
};
