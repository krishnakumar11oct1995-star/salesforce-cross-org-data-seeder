import React from 'react';
import { useSeederStore } from './store/useSeederStore';
import { Header } from './components/Header';
import { StepIndicator } from './components/StepIndicator';
import { Step1OrgSwitcher } from './components/Step1OrgSwitcher';
import { Step2ObjectFilter } from './components/Step2ObjectFilter';
import { Step3DependencyTree } from './components/Step3DependencyTree';
import { Step4StorageSizer } from './components/Step4StorageSizer';
import { Step5ExecutionConsole } from './components/Step5ExecutionConsole';

export const App: React.FC = () => {
  const { currentStep, isLoading, loadingMessage } = useSeederStore();

  return (
    <div className="flex flex-col h-screen bg-slate-100 text-slate-900 select-none overflow-x-hidden font-sans">
      <Header />
      <StepIndicator />

      {/* Global Spinner Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-white/70 z-40 flex flex-col items-center justify-center space-y-2 backdrop-blur-xs">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-semibold text-slate-700">
            {loadingMessage || 'Processing...'}
          </span>
        </div>
      )}

      {/* Step Router */}
      <main className="flex-1 overflow-y-auto">
        {currentStep === 1 && <Step1OrgSwitcher />}
        {currentStep === 2 && <Step2ObjectFilter />}
        {currentStep === 3 && <Step3DependencyTree />}
        {currentStep === 4 && <Step4StorageSizer />}
        {currentStep === 5 && <Step5ExecutionConsole />}
      </main>
    </div>
  );
};
