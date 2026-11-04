import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  CheckCircle2,
  ListTodo,
  Users,
  Search,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FolderKanban,
  Calendar,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import api from '../lib/api';
import TaskCountSummaryCards from './TaskCountSummaryCards';
import type { TaskCountsData, TaskCountFilterKey } from './TaskCountSummaryCards';

export interface HourlyTaskItem {
  task_id: string;
  user_id: number;
  employee_id: string;
  employee_name: string;
  department: string;
  email: string;
  project_name: string;
  task_name: string;
  description: string;
  status: string;
  worked_seconds_in_slot: number;
  worked_duration_formatted: string;
  is_completed_in_slot: boolean;
  completed_at: string | null;
  overall_start_time: string;
  overall_end_time: string;
  overall_duration_seconds: number;
  overall_duration_formatted: string;
  timing_accuracy: string;
  accuracy_note: string;
}

export interface HourlyEmployeeGroup {
  user_id: number;
  employee_id: string;
  employee_name: string;
  department: string;
  email: string;
  total_seconds: number;
  duration_formatted: string;
  tasks_worked_count: number;
  tasks_completed_count: number;
  tasks: HourlyTaskItem[];
}

export interface HourlySlotData {
  slot_index: number;
  slot_label: string;
  slot_start_iso: string;
  slot_end_iso: string;
  start_time_display: string;
  end_time_display: string;
  has_activity: boolean;
  total_seconds: number;
  total_hours: number;
  duration_formatted: string;
  tasks_worked_count: number;
  tasks_completed_count: number;
  employees_count: number;
  task_counts?: TaskCountsData;
  by_employee: HourlyEmployeeGroup[];
  tasks: HourlyTaskItem[];
}

export interface HourlyReportData {
  date: string;
  timezone: string;
  filter_employee_id: string | null;
  filter_project: string | null;
  filter_slot: string;
  task_counts?: TaskCountsData;
  summary: {
    total_slots_with_activity: number;
    total_slots_count?: number;
    total_work_seconds: number;
    total_work_hours: number;
    total_work_duration_formatted: string;
    total_tasks_worked: number;
    total_tasks_completed: number;
    total_active_employees: number;
    task_counts?: TaskCountsData;
  };
  slots_overview: Array<{
    slot_index: number;
    slot_label: string;
    has_activity: boolean;
    total_seconds: number;
    duration_formatted: string;
    tasks_worked_count: number;
    tasks_completed_count: number;
    employees_count: number;
  }>;
  slots: HourlySlotData[];
}

interface HourlyEmployeeTaskReportProps {
  employees: Array<{
    id: number;
    name: string;
    employee_id?: string;
    email?: string;
    department?: string;
  }>;
  initialDate?: string;
  initialEmpId?: string;
  initialProject?: string;
}

function getTodayIsoDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const FIXED_HOURLY_SLOTS = [
  { value: 'all', label: 'All Slots (9 AM–8 PM)' },
  { value: '9', label: '9:00 AM–10:00 AM' },
  { value: '10', label: '10:00 AM–11:00 AM' },
  { value: '11', label: '11:00 AM–12:00 PM' },
  { value: '12', label: '12:00 PM–1:00 PM' },
  { value: '13', label: '1:00 PM–2:00 PM' },
  { value: '14', label: '2:00 PM–3:00 PM' },
  { value: '15', label: '3:00 PM–4:00 PM' },
  { value: '16', label: '4:00 PM–5:00 PM' },
  { value: '17', label: '5:00 PM–6:00 PM' },
  { value: '18', label: '6:00 PM–7:00 PM' },
  { value: '19', label: '7:00 PM–8:00 PM' },
] as const;

export default function HourlyEmployeeTaskReport({
  employees,
  initialDate,
  initialEmpId = '',
  initialProject = ''
}: HourlyEmployeeTaskReportProps) {
  // Filter States
  const [filterDate, setFilterDate] = useState<string>(initialDate || getTodayIsoDate());
  const [filterEmpId, setFilterEmpId] = useState<string>(initialEmpId);
  const [filterProject, setFilterProject] = useState<string>(initialProject);
  const [filterSlot, setFilterSlot] = useState<string>('all');

  // UI state
  const [reportData, setReportData] = useState<HourlyReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState<TaskCountFilterKey | null>(null);
  const [expandedSlots, setExpandedSlots] = useState<Record<number, boolean>>({});
  const [hideEmptySlots, setHideEmptySlots] = useState<boolean>(false);
  const [viewGrouping, setViewGrouping] = useState<'employee' | 'tasks'>('employee');

  const hourlyReqSeqRef = useRef(0);

  const loadHourlyReport = async () => {
    const seq = ++hourlyReqSeqRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (filterDate) params.append('date', filterDate.trim());
      if (filterEmpId) params.append('employee_id', filterEmpId.trim());
      if (filterProject.trim()) params.append('project', filterProject.trim());
      if (filterSlot && filterSlot !== 'all') params.append('slot', filterSlot.trim());

      const res = await api.get(`/admin/tasks/hourly-report/?${params.toString()}`);
      if (seq === hourlyReqSeqRef.current) {
        setReportData(res.data);

        // Auto-expand active slots on load, or expand slot if specifically selected
        const initialExpanded: Record<number, boolean> = {};
        (res.data.slots || []).forEach((s: HourlySlotData) => {
          if (filterSlot !== 'all' || s.has_activity) {
            initialExpanded[s.slot_index] = true;
          }
        });
        setExpandedSlots(initialExpanded);
      }
    } catch (err: any) {
      if (seq === hourlyReqSeqRef.current) {
        setErrorMsg(err.response?.data?.error || 'Failed to load hourly task report.');
      }
    } finally {
      if (seq === hourlyReqSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadHourlyReport();
  }, [filterDate, filterEmpId, filterProject, filterSlot]);

  const toggleSlotExpand = (slotIndex: number) => {
    setExpandedSlots((prev) => ({
      ...prev,
      [slotIndex]: !prev[slotIndex]
    }));
  };

  const handleExpandAll = () => {
    if (!reportData?.slots) return;
    const allExp: Record<number, boolean> = {};
    reportData.slots.forEach((s) => {
      allExp[s.slot_index] = true;
    });
    setExpandedSlots(allExp);
  };

  const handleCollapseAll = () => {
    setExpandedSlots({});
  };

  const handleExport = (format: 'csv' | 'xlsx') => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    params.append('format', format);
    if (filterDate) params.append('date', filterDate);
    if (filterEmpId) params.append('employee_id', filterEmpId);
    if (filterProject) params.append('project', filterProject);
    if (filterSlot && filterSlot !== 'all') params.append('slot', filterSlot);

    const url = `${api.defaults.baseURL}/admin/tasks/hourly-report/export/?${params.toString()}`;
    fetch(url, {
      headers: { Authorization: `Token ${token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `hourly_task_report_${filterDate || 'all'}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(() => setErrorMsg('Failed to download hourly task report export.'));
  };

  // 24 slots overview helper for quick navigation
  const slotsOverview = reportData?.slots_overview || [];

  const visibleSlots = useMemo(() => {
    if (!reportData?.slots) return [];
    let slots = reportData.slots;
    if (hideEmptySlots && filterSlot === 'all') {
      slots = slots.filter((s) => s.has_activity);
    }
    if (!cardFilter || cardFilter === 'total') return slots;

    return slots.map((s) => {
      const filteredTasks = s.tasks.filter((t) => {
        if (cardFilter === 'pending') return Boolean((t as any).is_pending);
        if (cardFilter === 'just_started') return Boolean((t as any).is_just_started);
        if (cardFilter === 'in_progress') return Boolean((t as any).is_in_progress);
        if (cardFilter === 'completed') return Boolean(t.is_completed_in_slot || (t as any).is_completed);
        return true;
      });

      const filteredByEmp = s.by_employee.map((eg) => {
        const empTasks = eg.tasks.filter((t) => {
          if (cardFilter === 'pending') return Boolean((t as any).is_pending);
          if (cardFilter === 'just_started') return Boolean((t as any).is_just_started);
          if (cardFilter === 'in_progress') return Boolean((t as any).is_in_progress);
          if (cardFilter === 'completed') return Boolean(t.is_completed_in_slot || (t as any).is_completed);
          return true;
        });
        return {
          ...eg,
          tasks: empTasks
        };
      }).filter((eg) => eg.tasks.length > 0);

      return {
        ...s,
        tasks: filteredTasks,
        by_employee: filteredByEmp
      };
    });
  }, [reportData?.slots, hideEmptySlots, filterSlot, cardFilter]);

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="clay-card p-5 sm:p-7 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-gradient-to-tr from-indigo-600 to-teal-500 rounded-xl text-white shadow-sm">
                <Clock size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span>Hourly Employee Task Report</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/60">
                    {reportData?.timezone || 'Asia/Kolkata'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Analyze employee task activity, actual worked time, and completions distributed across each one-hour interval.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleExport('csv')}
              className="clay-btn clay-btn-secondary text-xs flex items-center gap-1.5"
              title="Download CSV report"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => handleExport('xlsx')}
              className="clay-btn clay-btn-success text-xs flex items-center gap-1.5"
              title="Download formatted Excel spreadsheet"
            >
              <Download size={14} />
              <span>Export Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="clay-inset-well p-4 rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          {/* Date Filter */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Calendar size={13} className="text-indigo-600" />
                <span>Date ({reportData?.timezone || 'IST'})</span>
              </label>
              {filterDate !== getTodayIsoDate() && (
                <button
                  onClick={() => setFilterDate(getTodayIsoDate())}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline"
                >
                  Set Today
                </button>
              )}
            </div>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="clay-input w-full text-sm font-mono"
            />
          </div>

          {/* Employee Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
              <Users size={13} className="text-teal-600" />
              <span>Employee</span>
            </label>
            <select
              value={filterEmpId}
              onChange={(e) => setFilterEmpId(e.target.value)}
              className="clay-input w-full text-sm"
            >
              <option value="">All Employees</option>
              {employees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.employee_id ? `[${u.employee_id}]` : `(${u.email})`}
                </option>
              ))}
            </select>
          </div>

          {/* Project Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
              <FolderKanban size={13} className="text-amber-600" />
              <span>Project</span>
            </label>
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search project..."
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="clay-input has-icons-both w-full pl-11 pr-10 text-sm min-h-[44px]"
              />
              {filterProject && (
                <button
                  onClick={() => setFilterProject('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 p-1"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* One-Hour Slot Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
              <Clock size={13} className="text-indigo-600" />
              <span>Time Slot</span>
            </label>
            <select
              value={filterSlot}
              onChange={(e) => setFilterSlot(e.target.value)}
              className="clay-input w-full text-sm font-medium"
            >
              {FIXED_HOURLY_SLOTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Refresh Action */}
          <div>
            <button
              onClick={() => loadHourlyReport()}
              disabled={loading}
              className="clay-btn clay-btn-secondary w-full text-sm font-bold flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin text-indigo-600' : ''} />
              <span>{loading ? 'Refreshing...' : 'Refresh Report'}</span>
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 font-medium">
            <AlertCircle size={16} className="text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Task-Count Summary Cards */}
        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles size={14} className="text-indigo-600" />
              <span>
                Task-Count Summary ({filterSlot !== 'all' ? (FIXED_HOURLY_SLOTS.find(s => s.value === filterSlot)?.label || `Slot ${filterSlot}`) : 'All Slots 9 AM–8 PM'})
              </span>
            </span>
            <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
              Click any card to filter tasks below
            </span>
          </div>

          <TaskCountSummaryCards
            taskCounts={reportData?.summary?.task_counts || reportData?.task_counts}
            activeFilter={cardFilter}
            onSelectFilter={setCardFilter}
            isLoading={loading}
            error={errorMsg}
            contextLabel={filterSlot !== 'all' ? 'for this time slot' : 'for selected date'}
          />
        </div>

        {/* Summary Metric Cards */}
        {reportData?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {/* Total Worked Time */}
            <div className="clay-card-flat p-4 bg-gradient-to-br from-indigo-50/60 to-white">
              <div className="flex items-center justify-between text-indigo-700 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider">Total Time Worked</span>
                <Clock size={16} />
              </div>
              <div className="text-xl font-black text-slate-900 tracking-tight font-mono">
                {reportData.summary.total_work_duration_formatted || '0 sec'}
              </div>
              <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                {filterSlot !== 'all' ? 'In selected time slot' : `${reportData.summary.total_work_hours} hrs across workforce`}
              </div>
            </div>

            {/* Tasks Worked On (Distinct) */}
            <div className="clay-card-flat p-4 bg-gradient-to-br from-violet-50/60 to-white">
              <div className="flex items-center justify-between text-violet-700 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider">Tasks Worked On</span>
                <ListTodo size={16} />
              </div>
              <div className="text-xl font-black text-slate-900 tracking-tight font-mono">
                {reportData.summary.total_tasks_worked}
              </div>
              <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                {filterSlot !== 'all' ? 'In selected time slot' : 'Distinct tasks logged in date'}
              </div>
            </div>

            {/* Tasks Completed */}
            <div className="clay-card-flat p-4 bg-gradient-to-br from-emerald-50/60 to-white">
              <div className="flex items-center justify-between text-emerald-700 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider">Tasks Completed</span>
                <CheckCircle2 size={16} />
              </div>
              <div className="text-xl font-black text-emerald-700 tracking-tight font-mono">
                {reportData.summary.total_tasks_completed}
              </div>
              <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                {filterSlot !== 'all' ? 'Completed in this slot' : 'Completed during slots'}
              </div>
            </div>

            {/* Active Time Slots */}
            <div className="clay-card-flat p-4 bg-gradient-to-br from-teal-50/60 to-white">
              <div className="flex items-center justify-between text-teal-700 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  {filterSlot !== 'all' ? 'Slot Status' : 'Active Time Slots'}
                </span>
                <Sparkles size={16} />
              </div>
              <div className="text-xl font-black text-slate-900 tracking-tight font-mono">
                {filterSlot !== 'all' ? (
                  reportData.summary.total_slots_with_activity > 0 ? (
                    <span className="text-emerald-700 font-bold text-lg">Active Activity</span>
                  ) : (
                    <span className="text-slate-400 font-bold text-lg">No Activity</span>
                  )
                ) : (
                  <>
                    {reportData.summary.total_slots_with_activity} <span className="text-xs text-slate-400 font-normal">/ {reportData.summary.total_slots_count || 11}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                {filterSlot !== 'all' ? `${reportData.summary.total_active_employees} active in slot` : `${reportData.summary.total_active_employees} employees engaged`}
              </div>
            </div>
          </div>
        )}

        {/* 9 AM–8 PM Quick Jump Strip */}
        {slotsOverview.length > 0 && (
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Layers size={13} className="text-indigo-600" />
                <span>9 AM–8 PM Timeline Distribution</span>
              </span>
              <div className="flex items-center gap-2">
                {filterSlot !== 'all' && (
                  <button
                    onClick={() => setFilterSlot('all')}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold underline"
                  >
                    Reset to All Slots (9 AM–8 PM)
                  </button>
                )}
                <span className="text-[10px] text-slate-400">Click any hour to focus</span>
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-11 gap-1.5 p-2 bg-slate-50/70 rounded-xl border border-slate-200/70 overflow-x-auto">
              {slotsOverview.map((s) => {
                const isSelected = filterSlot === String(s.slot_index);
                return (
                  <button
                    key={s.slot_index}
                    onClick={() => {
                      setFilterSlot(String(s.slot_index));
                    }}
                    title={`${s.slot_label}\nWorked: ${s.duration_formatted}\nWorked Tasks: ${s.tasks_worked_count}\nCompleted: ${s.tasks_completed_count}`}
                    className={`p-1.5 rounded-lg text-center transition flex flex-col items-center justify-center min-h-[44px] ${
                      isSelected
                        ? 'ring-2 ring-indigo-600 ring-offset-1 font-bold ' +
                          (s.has_activity
                            ? 'bg-gradient-to-b from-indigo-600 to-teal-600 text-white shadow-sm'
                            : 'bg-indigo-50 text-indigo-900 border border-indigo-300')
                        : s.has_activity
                        ? 'bg-gradient-to-b from-indigo-600 to-teal-600 text-white shadow-xs hover:brightness-110'
                        : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200/60'
                    }`}
                  >
                    <span className="text-[10px] font-mono font-bold leading-tight">
                      {s.slot_label.split('–')[0]}
                    </span>
                    {s.has_activity && (
                      <span className="text-[9px] font-black leading-none mt-1 px-1 py-0.2 rounded-full bg-white/20">
                        {s.tasks_worked_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Main Slots Section */}
      <div className="clay-card p-5 sm:p-7 space-y-4">
        {/* Controls Bar for Slots View */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-800">
              Showing {visibleSlots.length} {visibleSlots.length === 1 ? 'Slot' : 'Slots'}
            </span>
            {filterSlot !== 'all' && (
              <button
                onClick={() => setFilterSlot('all')}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
              >
                (View All Slots 9 AM–8 PM)
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* View Grouping Mode Switch */}
            <div className="clay-inset-well p-0.5 rounded-xl flex items-center text-xs">
              <button
                onClick={() => setViewGrouping('employee')}
                className={`px-3 py-1 rounded-lg font-bold transition ${
                  viewGrouping === 'employee'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                By Employee
              </button>
              <button
                onClick={() => setViewGrouping('tasks')}
                className={`px-3 py-1 rounded-lg font-bold transition ${
                  viewGrouping === 'tasks'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                All Tasks
              </button>
            </div>

            {/* Filter empty slots toggle */}
            {filterSlot === 'all' && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideEmptySlots}
                  onChange={(e) => setHideEmptySlots(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Hide empty slots</span>
              </label>
            )}

            {/* Expand / Collapse All */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleExpandAll}
                className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 font-bold hover:bg-slate-100 rounded-lg transition"
              >
                Expand All
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={handleCollapseAll}
                className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 font-bold hover:bg-slate-100 rounded-lg transition"
              >
                Collapse All
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
            <RefreshCw size={28} className="animate-spin text-indigo-600" />
            <p className="text-sm font-semibold">Calculating hourly task breakdown...</p>
          </div>
        )}

        {/* Empty State when no visible slots */}
        {!loading && visibleSlots.length === 0 && (
          <div className="py-16 text-center space-y-2">
            <FolderKanban size={36} className="mx-auto text-slate-300" />
            <p className="text-sm font-bold text-slate-700">No recorded task activity during this time slot.</p>
            <p className="text-xs text-slate-500">
              {hideEmptySlots
                ? 'All 11 hourly intervals (9 AM–8 PM) are currently empty. Uncheck "Hide empty slots" to view all hours.'
                : 'No task records match your current filters.'}
            </p>
          </div>
        )}

        {/* Slots List Accordions */}
        {!loading && (
          <div className="space-y-3.5">
            {visibleSlots.map((slot) => {
              const isExpanded = !!expandedSlots[slot.slot_index];

              return (
                <div
                  key={slot.slot_index}
                  className={`clay-card-flat overflow-hidden transition-all duration-150 border ${
                    slot.has_activity
                      ? 'border-indigo-200/80 bg-white/95'
                      : 'border-slate-200/70 bg-slate-50/40'
                  }`}
                >
                  {/* Slot Header Bar */}
                  <div
                    onClick={() => toggleSlotExpand(slot.slot_index)}
                    className="p-4 sm:p-4.5 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-xl text-center min-w-[50px] font-mono font-bold text-xs ${
                          slot.has_activity
                            ? 'bg-gradient-to-tr from-indigo-600 to-teal-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {String(slot.slot_index).padStart(2, '0')}:00
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                          <span>{slot.slot_label}</span>
                          <span className="text-[10px] text-slate-400 font-mono font-normal">
                            ({slot.start_time_display} - {slot.end_time_display})
                          </span>
                        </h4>

                        <div className="flex items-center gap-2 mt-0.5 text-xs">
                          {slot.has_activity ? (
                            <span className="text-indigo-600 font-semibold flex items-center gap-1 text-[11px]">
                              ● {slot.employees_count} {slot.employees_count === 1 ? 'employee' : 'employees'} logged activity
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">No recorded task activity during this time slot.</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right summary badges */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between sm:justify-end">
                      {/* Worked Time Badge */}
                      <div
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 ${
                          slot.total_seconds > 0
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                        title="Actual time worked within this one-hour slot"
                      >
                        <Clock size={13} />
                        <span>Worked: {slot.duration_formatted}</span>
                      </div>

                      {/* Tasks Worked On Count Badge */}
                      <div
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 ${
                          slot.tasks_worked_count > 0
                            ? 'bg-violet-50 text-violet-700 border border-violet-200/60'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                        title="Number of distinct tasks worked on during this slot"
                      >
                        <ListTodo size={13} />
                        <span>{slot.tasks_worked_count} worked</span>
                      </div>

                      {/* Tasks Completed Count Badge */}
                      <div
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 ${
                          slot.tasks_completed_count > 0
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                        title="Number of tasks completed during this slot"
                      >
                        <CheckCircle2 size={13} />
                        <span>{slot.tasks_completed_count} completed</span>
                      </div>

                      {/* Expand / Collapse Chevron */}
                      <button
                        type="button"
                        className="p-1 rounded-lg hover:bg-slate-200/60 text-slate-500 transition ml-1"
                        aria-label={isExpanded ? 'Collapse slot' : 'Expand slot'}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="border-t border-slate-200/80 p-4 sm:p-5 bg-slate-50/50">
                      {/* Empty Slot Feedback */}
                      {!slot.has_activity && (
                        <div className="p-5 text-center rounded-xl bg-white/70 border border-dashed border-slate-200 text-slate-500 text-xs font-medium">
                          No recorded task activity during this time slot.
                        </div>
                      )}

                      {/* Active Slot: Grouped by Employee */}
                      {slot.has_activity && viewGrouping === 'employee' && (
                        <div className="space-y-4">
                          {slot.by_employee.map((emp) => (
                            <div
                              key={emp.user_id}
                              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-xs space-y-3"
                            >
                              {/* Employee Header */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-teal-500 text-white font-bold text-xs flex items-center justify-center uppercase">
                                    {emp.employee_name.charAt(0)}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-xs text-slate-900">{emp.employee_name}</span>
                                      <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                                        {emp.employee_id || `ID: ${emp.user_id}`}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                                      <span>{emp.department || 'Department -'}</span>
                                      <span>•</span>
                                      <span className="text-slate-400">{emp.email}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 text-xs font-mono">
                                  <span className="font-bold text-indigo-600 bg-indigo-50/80 px-2 py-1 rounded-lg">
                                    Slot Work: {emp.duration_formatted}
                                  </span>
                                  <span className="text-slate-400">•</span>
                                  <span className="text-slate-600 font-bold">
                                    {emp.tasks_worked_count} {emp.tasks_worked_count === 1 ? 'task worked' : 'tasks worked'}
                                  </span>
                                  {emp.tasks_completed_count > 0 && (
                                    <>
                                      <span className="text-slate-400">•</span>
                                      <span className="text-emerald-600 font-bold">
                                        {emp.tasks_completed_count} completed
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Employee Tasks in this Slot */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-100 text-slate-400 uppercase font-bold text-[10px]">
                                      <th className="pb-2">Project & Task</th>
                                      <th className="pb-2">Work Description</th>
                                      <th className="pb-2 text-right">Time in Slot</th>
                                      <th className="pb-2 text-center">Completed</th>
                                      <th className="pb-2 text-center">Status</th>
                                      <th className="pb-2 text-right">Overall Span</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {emp.tasks.map((t) => (
                                      <tr key={t.task_id} className="hover:bg-slate-50/50 transition">
                                        <td className="py-2.5 pr-2">
                                          <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                            <span>{t.task_name}</span>
                                            {(t as any).is_just_started && (
                                              <span className="clay-pill px-1.5 py-0.2 text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                                Just Started
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[11px] text-indigo-600 font-medium">{t.project_name}</div>
                                        </td>
                                        <td className="py-2.5 px-2 text-slate-600 max-w-xs">
                                          <div className="line-clamp-2">{t.description || <span className="italic text-slate-400">No description entered</span>}</div>
                                        </td>
                                        <td className="py-2.5 px-2 text-right">
                                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50/80 px-2 py-0.5 rounded">
                                            {t.worked_duration_formatted}
                                          </span>
                                        </td>
                                        <td className="py-2.5 px-2 text-center">
                                          {t.is_completed_in_slot ? (
                                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/60">
                                              <CheckCircle2 size={11} />
                                              <span>{t.completed_at || 'Completed'}</span>
                                            </span>
                                          ) : (
                                            <span className="text-slate-400">-</span>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-2 text-center">
                                          <span
                                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                              t.status === 'COMPLETED'
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                                : t.status === 'IN_PROGRESS'
                                                ? 'bg-amber-50 text-amber-700 border border-amber-200/60 animate-pulse'
                                                : 'bg-slate-100 text-slate-600'
                                            }`}
                                          >
                                            {t.status}
                                          </span>
                                        </td>
                                        <td className="py-2.5 pl-2 text-right">
                                          <div className="text-[11px] text-slate-700 font-mono">
                                            {t.overall_start_time} - {t.overall_end_time}
                                          </div>
                                          <div className="text-[10px] text-slate-400">
                                            Total: {t.overall_duration_formatted}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Active Slot: All Tasks View */}
                      {slot.has_activity && viewGrouping === 'tasks' && (
                        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-xs overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-500 uppercase font-bold text-[10px]">
                                <th className="pb-2">Employee</th>
                                <th className="pb-2">Project & Task</th>
                                <th className="pb-2">Work Description</th>
                                <th className="pb-2 text-right">Worked in Slot</th>
                                <th className="pb-2 text-center">Completed</th>
                                <th className="pb-2 text-center">Status</th>
                                <th className="pb-2 text-right">Overall Span</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {slot.tasks.map((t) => (
                                <tr key={t.task_id} className="hover:bg-slate-50/50 transition">
                                  <td className="py-2.5 pr-2">
                                    <div className="font-bold text-slate-900">{t.employee_name}</div>
                                    <div className="font-mono text-[10px] text-indigo-700">
                                      {t.employee_id} • {t.department}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-2">
                                    <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                      <span>{t.task_name}</span>
                                      {(t as any).is_just_started && (
                                        <span className="clay-pill px-1.5 py-0.2 text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                          Just Started
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-teal-600 font-medium">{t.project_name}</div>
                                  </td>
                                  <td className="py-2.5 px-2 text-slate-600 max-w-xs">
                                    <div className="line-clamp-2">{t.description || <span className="italic text-slate-400">No description</span>}</div>
                                  </td>
                                  <td className="py-2.5 px-2 text-right">
                                    <span className="font-mono font-bold text-indigo-700 bg-indigo-50/80 px-2 py-0.5 rounded">
                                      {t.worked_duration_formatted}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-2 text-center">
                                    {t.is_completed_in_slot ? (
                                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] border border-emerald-200/60">
                                        <CheckCircle2 size={11} />
                                        <span>{t.completed_at || 'Completed'}</span>
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-2 text-center">
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        t.status === 'COMPLETED'
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                          : t.status === 'IN_PROGRESS'
                                          ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                                          : 'bg-slate-100 text-slate-600'
                                      }`}
                                    >
                                      {t.status}
                                    </span>
                                  </td>
                                  <td className="py-2.5 pl-2 text-right">
                                    <div className="text-[11px] text-slate-700 font-mono">
                                      {t.overall_start_time} - {t.overall_end_time}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      Total: {t.overall_duration_formatted}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Accuracy & Business Rules Explanatory Footer */}
      <div className="clay-card-flat p-4 rounded-2xl text-slate-500 text-xs flex items-start gap-2.5 bg-slate-50/80 border border-slate-200/60">
        <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-slate-700">Hourly Report Calculation & Precision Rules:</p>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-500">
            <li>Intervals are start-inclusive and end-exclusive (<code className="font-mono bg-white px-1 rounded">[slot_start, slot_end)</code>): a completion at 11:00 AM strictly belongs to 11:00 AM–12:00 PM.</li>
            <li>Breaks and paused periods are strictly excluded based on recorded work segments.</li>
            <li>Tasks crossing multiple hours or midnight have duration split proportionately across each overlapping hour.</li>
            <li>“Tasks worked on” and “Tasks completed” are maintained as distinct metrics.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

