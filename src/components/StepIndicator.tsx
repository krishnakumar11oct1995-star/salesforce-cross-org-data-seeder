import React from 'react';
import { useSeederStore } from '../store/useSeederStore';

const STEPS = [
  { num: 1, label: 'Orgs' },
  { num: 2, label: 'Object' },
  { num: 3, label: 'Trees' },
  { num: 4, label: 'Sizing' },
  { num: 5, label: 'Deploy' }
];

export const StepIndicator: React.FC = () => {
  const { currentStep } = useSeederStore();

  return (
    <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
      <div className="flex items-center justify-between relative">
        {/* Connecting Line */}
        <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-slate-200 -translate-y-1/2 z-0" />

        {STEPS.map((s) => {
          const isCompleted = currentStep > s.num;
          const isCurrent = currentStep === s.num;

          return (
            <div key={s.num} className="relative z-10 flex flex-col items-center">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all shadow-sm ${
                  isCompleted
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'bg-blue-600 text-white ring-2 ring-blue-200'
                    : 'bg-white text-slate-400 border border-slate-300'
                }`}
              >
                {isCompleted ? '✓' : s.num}
              </div>
              <span
                className={`text-[9px] mt-0.5 font-medium ${
                  isCurrent
                    ? 'text-blue-700 font-bold'
                    : isCompleted
                    ? 'text-slate-700'
                    : 'text-slate-400'
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
