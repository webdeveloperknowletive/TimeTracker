import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Check, PenLine, Sparkles, AlertCircle } from 'lucide-react';

export type JobFunctionCategory = 'Software Developer' | 'HR' | 'Data Analyst';

export const TASK_PRESETS: Record<JobFunctionCategory, string[]> = {
  'Software Developer': [
    'Frontend',
    'Backend',
    'Database',
    'Website',
    'Web App',
    'Training',
    'Testing',
    'Documentation',
    'Project Backup',
    'Deployment',
    'Research'
  ],
  'HR': [
    'Placement Drive in College/Office',
    'Connect to Companies',
    'Tracking Employee Records',
    'Daily Expenses Tracker',
    'Daily Employee Login & Break Tracker',
    'Performance Monitoring',
    'Internship Drives for Colleges',
    'Posting Jobs on Website',
    'Finding Jobs for IT Freshers',
    'Arrange Activity Staff on Saturday',
    'Data Analysis Lecture'
  ],
  'Data Analyst': [
    'Data Collection',
    'Data Cleaning',
    'Data Validation',
    'Data Analysis',
    'Exploratory Data Analysis',
    'SQL Queries',
    'Excel Analysis',
    'Dashboard Development',
    'Power BI Reports',
    'Data Visualization',
    'Report Preparation',
    'Research',
    'Documentation',
    'Training'
  ]
};

export const OTHER_OPTION = 'Other — Enter manually';

export function normalizeJobFunction(raw?: string | null): JobFunctionCategory | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().toLowerCase();

  // HR check
  if (
    s === 'hr' ||
    s.startsWith('hr ') ||
    s.endsWith(' hr') ||
    s.includes('human resource') ||
    s.includes('talent acquisition') ||
    s.includes('recruitment') ||
    s.includes('recruiter')
  ) {
    return 'HR';
  }

  // Data Analyst check
  if (
    s === 'data analyst' ||
    s.includes('data analyst') ||
    s.includes('data analysis') ||
    s.includes('data analytics') ||
    s.includes('power bi') ||
    s.includes('business analyst') ||
    s.includes('bi analyst') ||
    s.includes('data scientist')
  ) {
    return 'Data Analyst';
  }

  // Software Developer check
  if (
    s === 'software developer' ||
    s.includes('developer') ||
    s.includes('software') ||
    s.includes('engineer') ||
    s.includes('programmer') ||
    s.includes('coder') ||
    s.includes('frontend') ||
    s.includes('backend') ||
    s.includes('fullstack') ||
    s.includes('engineering') ||
    s.includes('dev')
  ) {
    return 'Software Developer';
  }

  return null;
}

export interface TaskNameSelectorProps {
  value: string;
  onChange: (val: string) => void;
  jobFunction?: string | null;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  label?: string;
  placeholder?: string;
}

export const TaskNameSelector: React.FC<TaskNameSelectorProps> = ({
  value,
  onChange,
  jobFunction,
  disabled = false,
  required = true,
  id = 'task-name-selector',
  label = 'Task Name',
  placeholder = 'Select or type task name (e.g. Frontend)...'
}) => {
  // Automatically identify the employee's saved job function (null if missing/unspecified)
  const detectedFunction = useMemo(() => normalizeJobFunction(jobFunction), [jobFunction]);

  // Presets automatically determined by saved job function; empty if unspecified
  const activePresets = useMemo(() => {
    if (!detectedFunction) return [];
    return TASK_PRESETS[detectedFunction] || [];
  }, [detectedFunction]);

  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync internal state with external value changes & preserve legacy tasks
  useEffect(() => {
    setInputValue(value || '');
    const trimmed = (value || '').trim();

    if (!trimmed) {
      setIsCustomMode(false);
      setCustomValue('');
    } else if (activePresets.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      // Matches a preset option
      setIsCustomMode(false);
      setCustomValue('');
    } else {
      // Unspecified job function or custom/legacy task name
      setIsCustomMode(true);
      setCustomValue(value);
    }
  }, [value, activePresets]);

  // Filter options based on typed input
  const filteredOptions = useMemo(() => {
    if (!detectedFunction) {
      // If job function is missing, offer manual entry
      return [OTHER_OPTION];
    }

    const query = inputValue.trim().toLowerCase();
    if (!query) {
      return [...activePresets, OTHER_OPTION];
    }
    const matches = activePresets.filter((p) => p.toLowerCase().includes(query));
    return [...matches, OTHER_OPTION];
  }, [detectedFunction, activePresets, inputValue]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setIsOpen(true);
    setHighlightedIndex(0);

    if (isCustomMode) {
      setCustomValue(val);
      onChange(val);
    } else {
      onChange(val);
    }
  };

  const handleSelectPreset = (preset: string) => {
    if (preset === OTHER_OPTION) {
      setIsCustomMode(true);
      const initVal = activePresets.includes(value) ? '' : value;
      setCustomValue(initVal);
      setInputValue(initVal);
      onChange(initVal);
      setIsOpen(false);
    } else {
      setIsCustomMode(false);
      setCustomValue('');
      setInputValue(preset);
      onChange(preset);
      setIsOpen(false);
    }
  };

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomValue(val);
    setInputValue(val);
    onChange(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
        return;
      }
    }

    if (isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          handleSelectPreset(filteredOptions[highlightedIndex]);
        } else if (filteredOptions.length > 0) {
          handleSelectPreset(filteredOptions[0]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll('[data-option-item]');
      if (items[highlightedIndex]) {
        (items[highlightedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex]);

  return (
    <div ref={containerRef} className="w-full space-y-2">
      {/* Label and Detected Job Function Badge */}
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wider text-slate-700">
          {label} {required && <span className="text-rose-500 font-bold">* Required</span>}
        </label>

        {detectedFunction ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
            <Sparkles size={11} className="text-indigo-600" />
            <span>{detectedFunction}</span>
          </span>
        ) : (
          <span className="text-[11px] font-medium text-slate-400">
            Manual Entry
          </span>
        )}
      </div>

      {/* Main Searchable Input with Visible Dropdown Arrow */}
      <div className="relative">
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            id={id}
            type="text"
            required={required}
            disabled={disabled}
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => setIsOpen(true)}
            onClick={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              !detectedFunction
                ? 'Enter task name manually...'
                : placeholder
            }
            className={`clay-input w-full pl-3.5 pr-10 py-2.5 text-sm font-medium placeholder-slate-400 transition ${
              isOpen ? 'ring-2 ring-indigo-500/30 border-indigo-500' : ''
            }`}
            autoComplete="off"
          />

          {/* Visible Dropdown Arrow Button */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setIsOpen(!isOpen);
                inputRef.current?.focus();
              }
            }}
            tabIndex={-1}
            aria-label="Toggle task options"
            className="absolute right-0 top-0 bottom-0 px-3 flex items-center justify-center text-slate-400 hover:text-indigo-600 cursor-pointer transition"
          >
            <ChevronDown
              size={18}
              className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-600' : ''}`}
            />
          </button>
        </div>

        {/* Floating Dropdown Options Menu */}
        {isOpen && (
          <div
            ref={dropdownRef}
            className="absolute z-[9999] left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100 max-h-64 overflow-y-auto"
            style={{ minWidth: '100%' }}
          >
            <div className="p-1.5 space-y-0.5">
              {!detectedFunction ? (
                // Unspecified Job Function banner + Manual entry option
                <div className="p-2 space-y-2">
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <p className="font-semibold">No job function assigned to your profile.</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      You can type any task name manually, or ask an administrator to set your designation (Software Developer, HR, or Data Analyst).
                    </p>
                  </div>
                  <div
                    data-option-item
                    onClick={() => handleSelectPreset(OTHER_OPTION)}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-indigo-600 hover:bg-indigo-50 cursor-pointer flex items-center gap-2 transition"
                  >
                    <PenLine size={13} className="text-indigo-600" />
                    <span>Enter task name manually</span>
                  </div>
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="py-3 px-3 text-center text-xs text-slate-500">
                  <p>No matching preset task found for "{inputValue}".</p>
                  <button
                    type="button"
                    onClick={() => handleSelectPreset(OTHER_OPTION)}
                    className="mt-1.5 text-indigo-600 font-bold hover:underline inline-flex items-center gap-1"
                  >
                    <PenLine size={12} />
                    <span>Use "{inputValue}" as custom task name</span>
                  </button>
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isOther = opt === OTHER_OPTION;
                  const isSelected = isOther
                    ? isCustomMode
                    : value.trim().toLowerCase() === opt.toLowerCase();
                  const isHighlighted = idx === highlightedIndex;

                  return (
                    <div
                      key={opt}
                      data-option-item
                      onClick={() => handleSelectPreset(opt)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium cursor-pointer flex items-center justify-between transition ${
                        isHighlighted
                          ? 'bg-indigo-50 text-indigo-900 font-bold'
                          : isSelected
                          ? 'bg-indigo-50/70 text-indigo-900 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      } ${
                        isOther
                          ? 'border-t border-slate-100 mt-1 pt-2 font-bold text-indigo-600'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {isOther ? (
                          <PenLine size={13} className="text-indigo-600 shrink-0" />
                        ) : (
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isSelected ? 'bg-indigo-600' : 'bg-slate-300'
                            }`}
                          />
                        )}
                        <span className="truncate">{opt}</span>
                      </div>
                      {isSelected && <Check size={14} className="text-indigo-600 shrink-0 ml-2" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Custom Task Name Input Field (when 'Other — Enter manually' is selected) */}
      {isCustomMode && (
        <div className="pt-1 space-y-1.5 animate-in fade-in-50 duration-150">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            Custom Task Name <span className="text-rose-500 font-bold">* Required</span>
          </label>
          <input
            type="text"
            required={required}
            disabled={disabled}
            placeholder="Type your specific task name..."
            value={customValue}
            onChange={handleCustomInputChange}
            className={`clay-input w-full px-3.5 py-2.5 text-sm font-medium ${
              customValue.trim().toLowerCase() === 'break' ? 'border-rose-400 ring-1 ring-rose-300' : ''
            }`}
            autoFocus
          />

          {customValue.trim().toLowerCase() === 'break' && (
            <p className="text-xs text-rose-600 font-semibold flex items-center gap-1">
              <AlertCircle size={13} />
              <span>Breaks should be recorded using the Start Break button, not as a task.</span>
            </p>
          )}
          {customValue.trim().toLowerCase() === 'other' && (
            <p className="text-xs text-amber-600 font-medium">
              Please enter the specific task name rather than the word "Other".
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskNameSelector;
