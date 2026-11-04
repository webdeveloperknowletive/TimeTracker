import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FolderKanban, Clock, CheckCircle2, AlertTriangle, 
  ChevronDown, ChevronUp, Users, RefreshCw, Search, 
  Briefcase, MessageSquare, History, Check, X,
  Hourglass, Calendar, ChevronLeft, ChevronRight, RotateCcw,
  Sparkles
} from 'lucide-react';
import api from '../lib/api';
import { formatDigitalDuration } from '../utils/formatters';

export interface Employee {
  id: number;
  name: string;
  employee_id: string;
  email: string;
  department: string;
}

export interface ProgressNote {
  note_id: string;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
  created_at_display?: string;
}

export interface WorkSessionItem {
  session_id: string;
  user_id: number;
  user_name: string;
  date: string;
  date_display?: string;
  start_time: string;
  start_time_display?: string;
  end_time: string | null;
  end_time_display?: string;
  duration_seconds: number;
  status: string;
  work_segments: any[];
}

export interface TaskItem {
  task_id: string;
  project_id: string;
  project_name: string;
  project_status: string;
  title: string;
  description: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  assigned_to: Employee | null;
  first_started_at: string | null;
  first_started_at_display?: string;
  completed_at: string | null;
  completed_at_display?: string;
  completed_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string;
  total_duration_seconds: number;
  period_duration_seconds?: number;
  time_worked_in_period?: string;
  deadline?: string | null;
  deadline_display?: string;
  active_session: any | null;
  progress_notes: ProgressNote[];
  work_sessions: WorkSessionItem[];
  created_at: string;
  created_at_display?: string;
  updated_at: string;
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  description: string;
  status: string;
  status_display?: string;
  current_status?: string;
  current_status_display?: string;
  first_started_at: string | null;
  started_at_display: string | null;
  created_at: string;
  created_at_display?: string;
  updated_at: string;
  total_tasks: number;
  completed_tasks: number;
  completion_percentage: number | null;
  completion_label: string;
  total_tracked_seconds: number;
  lifetime_tracked_seconds?: number;
  lifetime_tracked_hours?: number;
  lifetime_tracked_time?: string;
  period_tracked_seconds?: number;
  period_tracked_hours?: number;
  time_worked_in_period?: string;
  period_tasks_worked_count?: number;
  period_tasks_started_count?: number;
  period_tasks_completed_count?: number;
  period_active_tasks_count?: number;
  has_period_activity?: boolean;
  deadline?: string | null;
  deadline_display?: string;
  assigned_employees: Employee[];
  employee_progress?: {
    total_tasks: number;
    completed_tasks: number;
    completion_percentage: number | null;
    completion_label: string;
  } | null;
}

export interface SummaryTotals {
  total_projects: number;
  in_progress_projects: number;
  completed_projects: number;
  tasks_worked_count: number;
  tasks_started_count: number;
  tasks_completed_count: number;
  period_tracked_seconds: number;
  period_tracked_hours: number;
  total_tracked_seconds: number;
  total_tracked_hours: number;
  period_info: {
    type: string;
    label: string;
    range_display: string;
    start_date: string | null;
    end_date: string | null;
  };
}

export type ViewPeriodType = 'TODAY' | 'SPECIFIC' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM' | 'ALL';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function getTodayIstIsoDate(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatUnambiguousDate(isoStr?: string | null): string {
  if (!isoStr) return '--';
  const clean = isoStr.split('T')[0];
  const parts = clean.split('-');
  if (parts.length < 3) return isoStr;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parts[2].padStart(2, '0');
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${day} ${MONTH_NAMES_SHORT[monthIdx]} ${year}`;
  }
  return isoStr;
}

function shiftDateDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yr = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const da = String(dt.getUTCDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function getMondaySundayOfWeek(dateStr: string): { monday: string; sunday: string; label: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monDt = new Date(dt);
  monDt.setUTCDate(monDt.getUTCDate() + diffToMonday);

  const sunDt = new Date(monDt);
  sunDt.setUTCDate(monDt.getUTCDate() + 6);

  const formatIso = (date: Date) => {
    const yr = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const da = String(date.getUTCDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  };

  const monday = formatIso(monDt);
  const sunday = formatIso(sunDt);
  const label = `${formatUnambiguousDate(monday)} – ${formatUnambiguousDate(sunday)} (Mon–Sun)`;
  return { monday, sunday, label };
}

interface AdminProjectProgressProps {
  employees?: Employee[];
}

export default function AdminProjectProgress({ employees: propEmployees }: AdminProjectProgressProps = {}) {
  const todayIst = useMemo(() => getTodayIstIsoDate(), []);

  // View Period States
  const [viewPeriod, setViewPeriod] = useState<ViewPeriodType>('TODAY');
  const [selectedDate, setSelectedDate] = useState<string>(todayIst);
  const [selectedWeekDate, setSelectedWeekDate] = useState<string>(todayIst);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [customStartDate, setCustomStartDate] = useState<string>(todayIst);
  const [customEndDate, setCustomEndDate] = useState<string>(todayIst);

  // Filters
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterEmployee, setFilterEmployee] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Backend state
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [summaryTotals, setSummaryTotals] = useState<SummaryTotals | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasLoadedSuccessfully, setHasLoadedSuccessfully] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Fallback employee list if not passed via props
  const [fetchedEmployees, setFetchedEmployees] = useState<Employee[]>([]);

  // Pagination state (10 projects per page)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Expanded project state & client detail cache
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [expandedProjectDetails, setExpandedProjectDetails] = useState<{
    project: ProjectSummary;
    tasks: TaskItem[];
    work_sessions: any[];
    progress_notes: any[];
    employee_contributions: any[];
    audit_records: any[];
    period_info?: any;
  } | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
  const [detailTab, setDetailTab] = useState<'tasks' | 'sessions' | 'notes' | 'contributions' | 'audit'>('tasks');

  const projectReqSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const detailsCacheRef = useRef<Record<string, any>>({});

  // Fetch full employee directory once if propEmployees is not provided
  useEffect(() => {
    if (propEmployees && propEmployees.length > 0) return;
    api.get('/admin/users/')
      .then((res) => {
        const uList = res.data?.users || [];
        const emps = uList
          .filter((u: any) => u.role === 'EMPLOYEE')
          .map((u: any) => ({
            id: u.id,
            name: u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username,
            employee_id: u.employee_id || `EMP${u.id}`,
            email: u.email || '',
            department: u.department || ''
          }));
        setFetchedEmployees(emps);
      })
      .catch(() => {
        // Quiet fallback
      });
  }, [propEmployees]);

  // Combine available employees from props, fetched list, and projects
  const availableEmployees = useMemo(() => {
    const map = new Map<number, Employee>();
    if (propEmployees && propEmployees.length > 0) {
      propEmployees.forEach((e) => map.set(e.id, e));
    }
    fetchedEmployees.forEach((e) => {
      if (!map.has(e.id)) map.set(e.id, e);
    });
    projects.forEach((p) => {
      p.assigned_employees?.forEach((e) => {
        if (!map.has(e.id)) map.set(e.id, e);
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [propEmployees, fetchedEmployees, projects]);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // Reset page when period or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [viewPeriod, selectedDate, selectedWeekDate, selectedMonth, selectedYear, customStartDate, customEndDate, filterEmployee, filterStatus]);

  // Load projects list with period bounds & filters from backend
  const loadProjects = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const seq = ++projectReqSeqRef.current;
    setLoading(true);
    setErrorMsg('');

    try {
      const params = new URLSearchParams();
      params.set('period', viewPeriod.toLowerCase());

      if (viewPeriod === 'SPECIFIC') {
        params.set('date', selectedDate);
      } else if (viewPeriod === 'WEEKLY') {
        const { monday } = getMondaySundayOfWeek(selectedWeekDate);
        params.set('week_start', monday);
      } else if (viewPeriod === 'MONTHLY') {
        params.set('month', String(selectedMonth));
        params.set('year', String(selectedYear));
      } else if (viewPeriod === 'CUSTOM') {
        params.set('start_date', customStartDate);
        params.set('end_date', customEndDate);
      }

      if (filterEmployee !== 'ALL') {
        params.set('employee', filterEmployee);
      }
      if (filterStatus !== 'ALL') {
        params.set('status', filterStatus);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await api.get(`/projects/?${params.toString()}`, { signal: controller.signal });
      if (seq === projectReqSeqRef.current) {
        setProjects(res.data.projects || []);
        setSummaryTotals(res.data.summary || null);
        setHasLoadedSuccessfully(true);
      }
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return; // Superseded request, ignore quietly
      }
      if (seq === projectReqSeqRef.current) {
        setHasLoadedSuccessfully(false);
        setErrorMsg(err.response?.data?.error || 'Failed to load project monitoring data. Please click Retry.');
      }
    } finally {
      if (seq === projectReqSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadProjects();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [viewPeriod, selectedDate, selectedWeekDate, selectedMonth, selectedYear, customStartDate, customEndDate, filterEmployee, filterStatus, searchQuery]);

  // Paginated projects for display
  const totalPages = Math.ceil(projects.length / pageSize) || 1;
  const paginatedProjects = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return projects.slice(start, start + pageSize);
  }, [projects, currentPage, pageSize]);

  // Toggle expand project card with period-aware caching
  const handleToggleExpand = async (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      setExpandedProjectDetails(null);
      return;
    }

    setExpandedProjectId(projectId);

    const cacheKey = `${projectId}_${viewPeriod}_${selectedDate}_${selectedWeekDate}_${selectedMonth}_${selectedYear}_${customStartDate}_${customEndDate}_${filterEmployee}`;
    if (detailsCacheRef.current[cacheKey]) {
      setExpandedProjectDetails(detailsCacheRef.current[cacheKey]);
      return;
    }

    setLoadingDetails(true);
    try {
      const params = new URLSearchParams();
      params.set('period', viewPeriod.toLowerCase());
      if (viewPeriod === 'SPECIFIC') params.set('date', selectedDate);
      else if (viewPeriod === 'WEEKLY') params.set('week_start', getMondaySundayOfWeek(selectedWeekDate).monday);
      else if (viewPeriod === 'MONTHLY') {
        params.set('month', String(selectedMonth));
        params.set('year', String(selectedYear));
      } else if (viewPeriod === 'CUSTOM') {
        params.set('start_date', customStartDate);
        params.set('end_date', customEndDate);
      }
      if (filterEmployee !== 'ALL') params.set('employee', filterEmployee);

      const res = await api.get(`/projects/${projectId}/?${params.toString()}`);
      detailsCacheRef.current[cacheKey] = res.data;
      setExpandedProjectDetails(res.data);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to load project details.');
    } finally {
      setLoadingDetails(false);
    }
  };

  // Reset all filters and view period to default Today
  const handleClearAllFilters = () => {
    setViewPeriod('TODAY');
    setSelectedDate(todayIst);
    setSelectedWeekDate(todayIst);
    setSelectedMonth(new Date().getMonth() + 1);
    setSelectedYear(new Date().getFullYear());
    setCustomStartDate(todayIst);
    setCustomEndDate(todayIst);
    setFilterEmployee('ALL');
    setFilterStatus('ALL');
    setSearchInput('');
    setSearchQuery('');
    setCurrentPage(1);
    detailsCacheRef.current = {};
  };

  const isAnyFilterActive = useMemo(() => {
    return (
      viewPeriod !== 'TODAY' ||
      filterEmployee !== 'ALL' ||
      filterStatus !== 'ALL' ||
      searchQuery.trim() !== ''
    );
  }, [viewPeriod, filterEmployee, filterStatus, searchQuery]);

  // Selected Employee object if filtered
  const selectedEmployeeObj = useMemo(() => {
    if (filterEmployee === 'ALL') return null;
    const empIdNum = parseInt(filterEmployee, 10);
    return availableEmployees.find((e) => e.id === empIdNum) || null;
  }, [filterEmployee, availableEmployees]);

  // Current active date range text for IST display
  const activeRangeText = useMemo(() => {
    if (summaryTotals?.period_info?.range_display) {
      return summaryTotals.period_info.range_display;
    }
    if (viewPeriod === 'TODAY') {
      return `${formatUnambiguousDate(todayIst)} (Today, IST)`;
    }
    if (viewPeriod === 'SPECIFIC') {
      return `${formatUnambiguousDate(selectedDate)} (IST)`;
    }
    if (viewPeriod === 'WEEKLY') {
      return getMondaySundayOfWeek(selectedWeekDate).label;
    }
    if (viewPeriod === 'MONTHLY') {
      return `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} (IST)`;
    }
    if (viewPeriod === 'CUSTOM') {
      return `${formatUnambiguousDate(customStartDate)} – ${formatUnambiguousDate(customEndDate)} (IST)`;
    }
    return 'All Historical Activity (Lifetime)';
  }, [summaryTotals, viewPeriod, todayIst, selectedDate, selectedWeekDate, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Status Badge Component
  const renderStatusBadge = (status: string, statusDisplay?: string) => {
    if (status === 'ALL_RECORDED_COMPLETED' || status === 'READY_FOR_CLOSURE' || status === 'COMPLETED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
          <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
          <span>{statusDisplay || 'All Recorded Tasks Completed'}</span>
        </span>
      );
    }

    if (status === 'IN_PROGRESS') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
          <span>{statusDisplay || 'In Progress'}</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
        <Clock size={12} className="shrink-0 text-slate-400" />
        <span>{statusDisplay || 'Not Started'}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Error Notification */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-semibold flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="p-1 hover:bg-rose-100 rounded-md transition cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Banner & Header (Read-Only Monitoring) */}
      <div className="clay-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-teal-600 flex items-center justify-center text-white shadow-md shrink-0">
              <FolderKanban size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Project Progress Hub</h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200">
                  Asia/Kolkata
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Read-only monitoring dashboard of employee-recorded project progress, time tracking, and task delivery
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Active Range Pill Display */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100/90 border border-slate-200/90 text-xs font-semibold text-slate-700">
            <Calendar size={14} className="text-indigo-600 shrink-0" />
            <span>Window: <strong className="text-slate-900 font-bold">{activeRangeText}</strong></span>
          </div>

          <button
            onClick={loadProjects}
            className="clay-btn clay-btn-secondary min-h-[44px] px-3.5 text-xs font-bold flex items-center gap-2"
            title="Refresh Monitoring Data"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : 'text-slate-600'} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: VIEW PERIOD FILTER TOOLBAR */}
      <div className="clay-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-indigo-600" />
            <span className="text-xs font-black uppercase tracking-wider text-slate-700">
              Select View Period
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              (Matches projects with activity during this window)
            </span>
          </div>

          <div className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
            Active: {activeRangeText}
          </div>
        </div>

        {/* View Period Selector Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { id: 'TODAY', label: 'Today' },
              { id: 'SPECIFIC', label: 'Specific Date' },
              { id: 'WEEKLY', label: 'Weekly' },
              { id: 'MONTHLY', label: 'Monthly' },
              { id: 'CUSTOM', label: 'Custom Range' },
              { id: 'ALL', label: 'All Time' },
            ] as const
          ).map((p) => {
            const isActive = viewPeriod === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewPeriod(p.id)}
                className={`min-h-[44px] px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-teal-600 text-white shadow-sm ring-2 ring-indigo-500/20'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>{p.label}</span>
                {isActive && <Sparkles size={12} className="opacity-80" />}
              </button>
            );
          })}
        </div>

        {/* Period-Specific Sub-Controls */}
        <div className="pt-2">
          {/* 1. TODAY */}
          {viewPeriod === 'TODAY' && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex-wrap">
              <span className="font-semibold text-slate-700">Today's Window:</span>
              <span className="font-bold text-indigo-700">{formatUnambiguousDate(todayIst)} (00:00 to 23:59 IST)</span>
              <span className="text-[11px] text-slate-400">
                Shows projects where employees recorded work sessions, started tasks, completed tasks, or added progress notes today.
              </span>
            </div>
          )}

          {/* 2. SPECIFIC DATE */}
          {viewPeriod === 'SPECIFIC' && (
            <div className="flex items-center gap-2.5 flex-wrap p-3 rounded-xl bg-slate-50 border border-slate-200">
              <button
                type="button"
                onClick={() => setSelectedDate((prev) => shiftDateDays(prev, -1))}
                className="clay-btn clay-btn-secondary min-h-[44px] px-3 text-xs font-bold flex items-center gap-1"
                title="Previous Day"
              >
                <ChevronLeft size={16} />
                <span>Prev Day</span>
              </button>

              <div className="flex-1 min-w-[200px] max-w-xs">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  className="clay-input w-full text-sm font-semibold min-h-[44px]"
                />
              </div>

              <button
                type="button"
                onClick={() => setSelectedDate((prev) => shiftDateDays(prev, 1))}
                className="clay-btn clay-btn-secondary min-h-[44px] px-3 text-xs font-bold flex items-center gap-1"
                title="Next Day"
              >
                <span>Next Day</span>
                <ChevronRight size={16} />
              </button>

              {selectedDate !== todayIst && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayIst)}
                  className="clay-btn min-h-[44px] px-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200"
                >
                  Jump to Today
                </button>
              )}

              <span className="text-xs font-bold text-slate-700 ml-auto">
                Selected: {formatUnambiguousDate(selectedDate)} (IST)
              </span>
            </div>
          )}

          {/* 3. WEEKLY (Monday–Sunday) */}
          {viewPeriod === 'WEEKLY' && (
            <div className="flex items-center gap-2.5 flex-wrap p-3 rounded-xl bg-slate-50 border border-slate-200">
              <button
                type="button"
                onClick={() => setSelectedWeekDate((prev) => shiftDateDays(prev, -7))}
                className="clay-btn clay-btn-secondary min-h-[44px] px-3 text-xs font-bold flex items-center gap-1"
                title="Previous Week"
              >
                <ChevronLeft size={16} />
                <span>Prev Week</span>
              </button>

              <div className="flex-1 min-w-[200px] max-w-xs">
                <input
                  type="date"
                  value={selectedWeekDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedWeekDate(e.target.value);
                  }}
                  className="clay-input w-full text-sm font-semibold min-h-[44px]"
                  title="Pick any date in the target week"
                />
              </div>

              <button
                type="button"
                onClick={() => setSelectedWeekDate((prev) => shiftDateDays(prev, 7))}
                className="clay-btn clay-btn-secondary min-h-[44px] px-3 text-xs font-bold flex items-center gap-1"
                title="Next Week"
              >
                <span>Next Week</span>
                <ChevronRight size={16} />
              </button>

              {selectedWeekDate !== todayIst && (
                <button
                  type="button"
                  onClick={() => setSelectedWeekDate(todayIst)}
                  className="clay-btn min-h-[44px] px-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200"
                >
                  Current Week
                </button>
              )}

              <span className="text-xs font-bold text-slate-800 ml-auto">
                Week Window: {getMondaySundayOfWeek(selectedWeekDate).label}
              </span>
            </div>
          )}

          {/* 4. MONTHLY */}
          {viewPeriod === 'MONTHLY' && (
            <div className="flex items-center gap-2.5 flex-wrap p-3 rounded-xl bg-slate-50 border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  let m = selectedMonth - 1;
                  let y = selectedYear;
                  if (m < 1) {
                    m = 12;
                    y -= 1;
                  }
                  setSelectedMonth(m);
                  setSelectedYear(y);
                }}
                className="clay-btn clay-btn-secondary min-h-[44px] px-3 text-xs font-bold flex items-center gap-1"
                title="Previous Month"
              >
                <ChevronLeft size={16} />
                <span>Prev Month</span>
              </button>

              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
                className="clay-input text-sm font-semibold min-h-[44px] min-w-[150px]"
              >
                {MONTH_NAMES.map((mName, idx) => (
                  <option key={mName} value={idx + 1}>
                    {mName}
                  </option>
                ))}
              </select>

              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                className="clay-input text-sm font-semibold min-h-[44px] min-w-[100px]"
              >
                {[2024, 2025, 2026, 2027, 2028].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  let m = selectedMonth + 1;
                  let y = selectedYear;
                  if (m > 12) {
                    m = 1;
                    y += 1;
                  }
                  setSelectedMonth(m);
                  setSelectedYear(y);
                }}
                className="clay-btn clay-btn-secondary min-h-[44px] px-3 text-xs font-bold flex items-center gap-1"
                title="Next Month"
              >
                <span>Next Month</span>
                <ChevronRight size={16} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedMonth(new Date().getMonth() + 1);
                  setSelectedYear(new Date().getFullYear());
                }}
                className="clay-btn min-h-[44px] px-3 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200"
              >
                Current Month
              </button>

              <span className="text-xs font-bold text-slate-800 ml-auto">
                Selected: {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
              </span>
            </div>
          )}

          {/* 5. CUSTOM RANGE */}
          {viewPeriod === 'CUSTOM' && (
            <div className="flex items-center gap-3 flex-wrap p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">From:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    if (e.target.value) setCustomStartDate(e.target.value);
                  }}
                  className="clay-input text-sm font-semibold min-h-[44px]"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">To:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => {
                    if (e.target.value) setCustomEndDate(e.target.value);
                  }}
                  className="clay-input text-sm font-semibold min-h-[44px]"
                />
              </div>

              <span className="text-xs font-bold text-slate-800 ml-auto">
                Range: {formatUnambiguousDate(customStartDate)} – {formatUnambiguousDate(customEndDate)} (IST)
              </span>
            </div>
          )}

          {/* 6. ALL TIME */}
          {viewPeriod === 'ALL' && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex-wrap">
              <span className="font-semibold text-slate-700">All Historical Time:</span>
              <span className="font-bold text-indigo-700">Full Lifetime Records</span>
              <span className="text-[11px] text-slate-400">
                Displays all projects and cumulative lifetime activity without any period boundary restrictions.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: ACCURATE PERIOD SUMMARY STAT CARDS (5 Cards) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        {/* Card 1: Projects with Activity */}
        <div className="clay-card-flat p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Projects with Activity
          </p>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {hasLoadedSuccessfully ? (summaryTotals?.total_projects ?? projects.length) : '--'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
            {hasLoadedSuccessfully
              ? `${summaryTotals?.in_progress_projects ?? 0} in progress, ${summaryTotals?.completed_projects ?? 0} completed`
              : 'Active in period'}
          </p>
        </div>

        {/* Card 2: Distinct Tasks Worked On */}
        <div className="clay-card-flat p-4">
          <p className="text-[11px] font-bold text-blue-500 uppercase tracking-wider">
            Tasks Worked On
          </p>
          <p className="text-2xl font-black text-blue-700 mt-1">
            {hasLoadedSuccessfully ? (summaryTotals?.tasks_worked_count ?? 0) : '--'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Logged work in period
          </p>
        </div>

        {/* Card 3: Tasks First Started */}
        <div className="clay-card-flat p-4">
          <p className="text-[11px] font-bold text-amber-500 uppercase tracking-wider">
            Tasks Started
          </p>
          <p className="text-2xl font-black text-amber-700 mt-1">
            {hasLoadedSuccessfully ? (summaryTotals?.tasks_started_count ?? 0) : '--'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            First started in period
          </p>
        </div>

        {/* Card 4: Tasks Completed */}
        <div className="clay-card-flat p-4">
          <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
            Tasks Completed
          </p>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            {hasLoadedSuccessfully ? (summaryTotals?.tasks_completed_count ?? 0) : '--'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Completed in period
          </p>
        </div>

        {/* Card 5: Work Time in Period */}
        <div className="clay-card-flat p-4 col-span-2 md:col-span-1">
          <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider">
            Work Time in Period
          </p>
          <p className="text-2xl font-black text-indigo-700 mt-1">
            {hasLoadedSuccessfully ? `${summaryTotals?.period_tracked_hours ?? '0.0'}h` : '--'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={`Lifetime: ${summaryTotals?.total_tracked_hours ?? '0.0'}h across matching projects`}>
            Lifetime: {summaryTotals?.total_tracked_hours ?? '0.0'}h
          </p>
        </div>
      </div>

      {/* SECTION 3: SEARCH, STATUS, EMPLOYEE FILTERS STRIP */}
      <div className="clay-card-flat p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 flex-wrap">
        {/* Search input with 44px min-height */}
        <div className="flex-1 min-w-[240px] relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by project name or ID..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="clay-input has-icon-left w-full pl-11 pr-3.5 text-sm min-h-[44px]"
          />
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="clay-input text-sm w-full sm:w-auto min-w-[170px] min-h-[44px]"
          >
            <option value="ALL">All Statuses</option>
            <option value="NOT_STARTED">Not Started</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="ALL_RECORDED_COMPLETED">All Recorded Tasks Completed</option>
          </select>

          {/* Employee Filter */}
          <select
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            className="clay-input text-sm w-full sm:w-auto min-w-[180px] min-h-[44px]"
          >
            <option value="ALL">All Employees</option>
            {availableEmployees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employee_id})
              </option>
            ))}
          </select>

          {/* Clear All Filters button */}
          {isAnyFilterActive && (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="clay-btn clay-btn-secondary px-4 min-h-[44px] text-xs font-bold text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5 cursor-pointer"
              title="Reset view period to Today and clear search/dropdown filters"
            >
              <RotateCcw size={14} />
              <span>Clear All Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Selected Employee Context Banner if employee filter is active */}
      {selectedEmployeeObj && (
        <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200/80 flex items-center justify-between text-xs text-indigo-900 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-indigo-600 shrink-0" />
            <span>
              Filtering by employee: <strong className="font-bold text-indigo-950">{selectedEmployeeObj.name} ({selectedEmployeeObj.employee_id})</strong>.
              Showing their period contributions, task counts, and tracked time.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFilterEmployee('ALL')}
            className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
          >
            Show All Employees
          </button>
        </div>
      )}

      {/* SECTION 4: PROJECTS MONITORING LIST */}
      <div className="space-y-4">
        {loading ? (
          <div className="clay-card p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <RefreshCw size={26} className="animate-spin text-indigo-600" />
            <p className="text-sm font-semibold">Loading project monitoring data for {activeRangeText}...</p>
          </div>
        ) : !hasLoadedSuccessfully && errorMsg ? (
          <div className="clay-card p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <AlertTriangle size={32} className="text-rose-500 mx-auto" />
            <p className="text-base font-bold text-slate-800">Unable to load project monitoring data</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">{errorMsg}</p>
            <button
              onClick={loadProjects}
              className="mt-2 min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <RefreshCw size={14} />
              <span>Retry Now</span>
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="clay-card p-12 text-center text-slate-500">
            <FolderKanban size={36} className="mx-auto text-slate-300 mb-2" />
            <p className="text-base font-bold text-slate-700">
              {isAnyFilterActive ? 'No matching project activity found' : 'No projects recorded yet'}
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              {isAnyFilterActive
                ? `No projects had recorded activity during the window ${activeRangeText} matching your active filters. Try selecting a broader period or resetting filters.`
                : 'Project activity will appear here when employees record their work.'}
            </p>
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="mt-4 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>Reset to Today</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {paginatedProjects.map((project) => {
              const isExpanded = expandedProjectId === project.project_id;
              const overallCompletion = project.completion_percentage;
              const empProgress = project.employee_progress;
              const periodSec = project.period_tracked_seconds ?? 0;
              const lifetimeSec = project.lifetime_tracked_seconds ?? project.total_tracked_seconds ?? 0;

              return (
                <div
                  key={project.project_id}
                  className={`clay-card transition border ${
                    isExpanded ? 'ring-2 ring-indigo-500/30 border-indigo-200' : 'border-slate-200/80'
                  }`}
                >
                  {/* Project Card Header */}
                  <div className="p-5 sm:p-6 space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      {/* Left: Project Title, ID, Description, Status */}
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                            {project.project_id}
                          </span>
                          <h3 className="text-lg font-extrabold text-slate-900 tracking-tight truncate">
                            {project.name}
                          </h3>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 uppercase">Current Status:</span>
                            {renderStatusBadge(project.status, project.status_display)}
                          </div>
                        </div>

                        {project.description && (
                          <p className="text-xs text-slate-600 line-clamp-2 max-w-2xl">
                            {project.description}
                          </p>
                        )}

                        {/* Tracked Time: Period vs Lifetime clearly separated */}
                        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap pt-1">
                          {/* Work Time in Period */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-900 font-bold">
                            <Clock size={13} className="text-indigo-600" />
                            <span>Work Time in Selected Period:</span>
                            <span className="text-indigo-950 font-black">
                              {project.time_worked_in_period || formatDigitalDuration(periodSec)}
                            </span>
                          </div>

                          {/* Lifetime Tracked Time */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium">
                            <Hourglass size={13} className="text-slate-500" />
                            <span>Lifetime Tracked Time:</span>
                            <span className="font-bold text-slate-900">
                              {project.lifetime_tracked_time || formatDigitalDuration(lifetimeSec)}
                            </span>
                          </div>

                          {/* Started At Display */}
                          {project.started_at_display ? (
                            <span className="text-slate-600 text-[11px]">
                              First started: <strong className="font-semibold text-slate-800">{project.started_at_display}</strong>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">Work not yet started</span>
                          )}

                          {/* Deadline display if set */}
                          {project.deadline_display && (
                            <span className="text-slate-600 text-[11px]">
                              Deadline: <strong className="font-semibold text-slate-800">{project.deadline_display}</strong>
                            </span>
                          )}
                        </div>

                        {/* Activity Badges in Selected Period */}
                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Period Activity:
                          </span>
                          {(project.period_tasks_worked_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              <Briefcase size={10} /> {project.period_tasks_worked_count} Tasks Worked
                            </span>
                          ) : null}

                          {(project.period_tasks_started_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <Clock size={10} /> {project.period_tasks_started_count} Started
                            </span>
                          ) : null}

                          {(project.period_tasks_completed_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={10} /> {project.period_tasks_completed_count} Completed
                            </span>
                          ) : null}

                          {(project.period_tasks_worked_count ?? 0) === 0 &&
                           (project.period_tasks_started_count ?? 0) === 0 &&
                           (project.period_tasks_completed_count ?? 0) === 0 && (
                            <span className="text-[10px] text-slate-400 italic">
                              Matching notes / task creation in period
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Progress Metrics & Inspect Action */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:shrink-0">
                        {/* Progress Bars: Selected Employee's Progress AND/OR Current Overall Progress */}
                        <div className="w-full sm:w-60 space-y-2">
                          {/* If employee filter is active, show Selected Employee's Task Completion first */}
                          {filterEmployee !== 'ALL' && empProgress && (
                            <div className="p-2.5 rounded-xl bg-indigo-50/80 border border-indigo-200/80 space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-indigo-950">Selected Employee's Task Completion:</span>
                                <span className="font-black text-indigo-700">
                                  {empProgress.completion_percentage !== null ? `${empProgress.completion_percentage}%` : '--'}
                                </span>
                              </div>
                              <div className="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-indigo-500 to-teal-500 transition-all duration-300"
                                  style={{ width: `${empProgress.completion_percentage ?? 0}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-indigo-800 font-semibold">
                                {empProgress.completed_tasks} of {empProgress.total_tasks} tasks completed
                              </div>
                            </div>
                          )}

                          {/* Current Overall Progress */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-slate-700">Current Overall Progress:</span>
                              <span className="font-extrabold text-slate-900">
                                {overallCompletion !== null ? `${overallCompletion}%` : 'No tasks'}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200/60">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  ['ALL_RECORDED_COMPLETED', 'READY_FOR_CLOSURE', 'COMPLETED'].includes(project.status)
                                    ? 'bg-emerald-500'
                                    : 'bg-gradient-to-r from-indigo-500 to-teal-500'
                                }`}
                                style={{ width: `${overallCompletion ?? 0}%` }}
                              />
                            </div>
                            <div className="text-[11px] text-slate-400 font-medium">
                              {project.completed_tasks} of {project.total_tasks} total tasks completed
                            </div>
                          </div>
                        </div>

                        {/* Inspect / Collapse Button */}
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => handleToggleExpand(project.project_id)}
                            className={`min-h-[44px] px-4 rounded-xl border transition flex items-center gap-1.5 text-xs font-bold cursor-pointer ${
                              isExpanded 
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs' 
                                : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}
                            title={isExpanded ? 'Collapse' : 'Inspect Period Tasks, Sessions & Contributions'}
                          >
                            <span>{isExpanded ? 'Hide Details' : 'Inspect'}</span>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Contributing Employees Preview */}
                    <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Contributing Employees:
                      </span>
                      {project.assigned_employees.length === 0 ? (
                        <span className="text-xs text-slate-400 italic">No employees recorded yet</span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {project.assigned_employees.map((emp) => {
                            const isSelected = filterEmployee !== 'ALL' && emp.id === parseInt(filterEmployee, 10);
                            return (
                              <span
                                key={emp.id}
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
                                  isSelected
                                    ? 'bg-indigo-100 text-indigo-800 border border-indigo-300 font-bold'
                                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                                }`}
                              >
                                <Users size={12} className={isSelected ? 'text-indigo-600' : 'text-slate-400'} />
                                {emp.name}
                                <span className="text-[10px] text-slate-400 font-mono">({emp.employee_id})</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded Project Details (Filtered by active period and employee) */}
                  {isExpanded && (
                    <div className="border-t border-slate-200/90 bg-slate-50/70 p-5 sm:p-6 space-y-5 rounded-b-2xl">
                      {/* Period scope indicator in details */}
                      <div className="flex items-center justify-between text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-indigo-600" />
                          <span>Detailed records filtered for period: <strong className="text-slate-900 font-bold">{activeRangeText}</strong></span>
                        </div>
                        {filterEmployee !== 'ALL' && selectedEmployeeObj && (
                          <div className="text-xs font-semibold text-indigo-700">
                            Employee: {selectedEmployeeObj.name}
                          </div>
                        )}
                      </div>

                      {/* Detail Tabs */}
                      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setDetailTab('tasks')}
                          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            detailTab === 'tasks'
                              ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Briefcase size={14} />
                          <span>Tasks ({expandedProjectDetails?.tasks?.length || 0})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDetailTab('sessions')}
                          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            detailTab === 'sessions'
                              ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Clock size={14} />
                          <span>Work Sessions ({expandedProjectDetails?.work_sessions?.length || 0})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDetailTab('notes')}
                          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            detailTab === 'notes'
                              ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <MessageSquare size={14} />
                          <span>Progress Notes ({expandedProjectDetails?.progress_notes?.length || 0})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDetailTab('contributions')}
                          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            detailTab === 'contributions'
                              ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Users size={14} />
                          <span>Employee Contributions ({expandedProjectDetails?.employee_contributions?.length || 0})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDetailTab('audit')}
                          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                            detailTab === 'audit'
                              ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <History size={14} />
                          <span>Audit History</span>
                        </button>
                      </div>

                      {loadingDetails ? (
                        <div className="py-8 text-center text-slate-400 flex items-center justify-center gap-2">
                          <RefreshCw size={18} className="animate-spin text-indigo-600" />
                          <span className="text-xs font-semibold">Loading period project details...</span>
                        </div>
                      ) : (
                        <>
                          {/* TAB 1: TASKS */}
                          {detailTab === 'tasks' && (
                            <div className="space-y-3">
                              {expandedProjectDetails?.tasks?.length === 0 ? (
                                <div className="p-8 text-center bg-white rounded-xl border border-dashed border-slate-200 text-slate-400">
                                  <Briefcase size={28} className="mx-auto text-slate-300 mb-1" />
                                  <p className="text-xs font-semibold">No tasks recorded under this project matching active filters.</p>
                                </div>
                              ) : (
                                expandedProjectDetails?.tasks?.map((task) => (
                                  <div
                                    key={task.task_id}
                                    className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-3"
                                  >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                            {task.task_id}
                                          </span>
                                          <h4 className="text-sm font-bold text-slate-900">{task.title}</h4>
                                          {task.status === 'COMPLETED' ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                              <Check size={10} /> Completed
                                            </span>
                                          ) : task.status === 'IN_PROGRESS' ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" /> In Progress
                                            </span>
                                          ) : (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                              Not Started
                                            </span>
                                          )}
                                        </div>
                                        {task.description && (
                                          <p className="text-xs text-slate-600 max-w-xl">{task.description}</p>
                                        )}
                                      </div>
                                    </div>

                                    {/* Task Meta details */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                                      <div>
                                        <span className="text-[10px] text-slate-400 block font-bold uppercase">Assigned To</span>
                                        <span className="font-semibold text-slate-800">
                                          {task.assigned_to ? `${task.assigned_to.name} (${task.assigned_to.employee_id})` : 'Unassigned'}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-indigo-500 block font-bold uppercase">Period Time</span>
                                        <span className="font-bold text-indigo-700">
                                          {task.time_worked_in_period || formatDigitalDuration(task.period_duration_seconds || 0)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-slate-400 block font-bold uppercase">Lifetime Time</span>
                                        <span className="font-semibold text-slate-800">
                                          {formatDigitalDuration(task.total_duration_seconds)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-slate-400 block font-bold uppercase">First Started</span>
                                        <span className="font-semibold text-slate-800">
                                          {task.first_started_at_display || '--'}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-slate-400 block font-bold uppercase">Completed At</span>
                                        <span className="font-semibold text-slate-800">
                                          {task.completed_at_display || '--'}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Reopen Info if present */}
                                    {task.reopened_at && (
                                      <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                                        <span className="font-bold">Reopened:</span> by {task.reopened_by || 'Employee'}
                                        {task.reopen_reason && (
                                          <span className="italic block mt-0.5">Reason: "{task.reopen_reason}"</span>
                                        )}
                                      </div>
                                    )}

                                    {/* Progress Notes inside Task */}
                                    {task.progress_notes.length > 0 && (
                                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                          <MessageSquare size={11} /> Progress Notes ({task.progress_notes.length}):
                                        </span>
                                        <div className="space-y-1">
                                          {task.progress_notes.slice(0, 3).map((note) => (
                                            <div key={note.note_id} className="text-xs bg-slate-50 p-2 rounded-lg border border-slate-200/60">
                                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                                <span className="font-bold text-slate-700">{note.author_name}</span>
                                                <span>{note.created_at_display || new Date(note.created_at).toLocaleString()}</span>
                                              </div>
                                              <p className="text-slate-700 mt-0.5">{note.content}</p>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {/* TAB 2: WORK SESSIONS */}
                          {detailTab === 'sessions' && (
                            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                              {expandedProjectDetails?.work_sessions?.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-xs">
                                  No work sessions recorded within the selected period window ({activeRangeText}).
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold">
                                      <tr>
                                        <th className="py-2.5 px-4">Date (IST)</th>
                                        <th className="py-2.5 px-4">Task</th>
                                        <th className="py-2.5 px-4">Employee</th>
                                        <th className="py-2.5 px-4">Time Interval</th>
                                        <th className="py-2.5 px-4">Overlapping Duration</th>
                                        <th className="py-2.5 px-4">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {expandedProjectDetails?.work_sessions?.map((ws: any, idx: number) => (
                                        <tr key={ws.session_id || idx} className="hover:bg-slate-50/50">
                                          <td className="py-2.5 px-4 font-semibold text-slate-900">
                                            {ws.date_display || ws.date}
                                          </td>
                                          <td className="py-2.5 px-4 text-slate-800">
                                            <span className="font-mono text-[10px] text-slate-400 mr-1.5">[{ws.task_id}]</span>
                                            <span className="font-semibold">{ws.task_title}</span>
                                          </td>
                                          <td className="py-2.5 px-4 font-medium text-slate-700">
                                            {ws.user_name}
                                          </td>
                                          <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">
                                            {ws.start_time_display || ws.start_time?.slice(11, 16) || '--'} – {ws.end_time_display || ws.end_time?.slice(11, 16) || 'Active'}
                                          </td>
                                          <td className="py-2.5 px-4 font-mono font-bold text-indigo-700">
                                            {formatDigitalDuration(ws.duration_seconds)}
                                          </td>
                                          <td className="py-2.5 px-4">
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                                              {ws.status}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}

                          {/* TAB 3: PROGRESS NOTES */}
                          {detailTab === 'notes' && (
                            <div className="space-y-2">
                              {expandedProjectDetails?.progress_notes?.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                                  No progress notes recorded during the selected period.
                                </div>
                              ) : (
                                expandedProjectDetails?.progress_notes?.map((note: any) => (
                                  <div
                                    key={note.note_id}
                                    className="p-3.5 rounded-xl bg-white border border-slate-200 text-xs space-y-1.5"
                                  >
                                    <div className="flex items-center justify-between text-[11px] text-slate-500 border-b border-slate-100 pb-1">
                                      <span className="font-bold text-slate-800">
                                        {note.author_name} • <span className="font-medium text-slate-600">Task: {note.task_title}</span>
                                      </span>
                                      <span className="font-mono text-slate-400">{note.created_at_display}</span>
                                    </div>
                                    <p className="text-slate-800 text-xs">{note.content}</p>
                                  </div>
                                ))
                              )}
                            </div>
                          )}

                          {/* TAB 4: EMPLOYEE CONTRIBUTIONS */}
                          {detailTab === 'contributions' && (
                            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                              {expandedProjectDetails?.employee_contributions?.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-xs">
                                  No employee contributions recorded yet.
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold">
                                      <tr>
                                        <th className="py-2.5 px-4">Employee</th>
                                        <th className="py-2.5 px-4">Department</th>
                                        <th className="py-2.5 px-4">Work Time in Period</th>
                                        <th className="py-2.5 px-4">Tasks Worked in Period</th>
                                        <th className="py-2.5 px-4">Tasks Completed in Period</th>
                                        <th className="py-2.5 px-4">Lifetime Tracked Time</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {expandedProjectDetails?.employee_contributions?.map((c) => (
                                        <tr key={c.user_id} className="hover:bg-slate-50/50">
                                          <td className="py-2.5 px-4 font-bold text-slate-900">
                                            {c.employee_name} <span className="font-mono text-slate-400 text-[11px]">({c.employee_id})</span>
                                          </td>
                                          <td className="py-2.5 px-4 text-slate-600">{c.department || '--'}</td>
                                          <td className="py-2.5 px-4 font-mono font-bold text-indigo-700 bg-indigo-50/40">
                                            {formatDigitalDuration(c.period_duration_seconds ?? 0)}
                                          </td>
                                          <td className="py-2.5 px-4 text-slate-700 font-semibold">{c.period_tasks_worked ?? 0}</td>
                                          <td className="py-2.5 px-4 text-emerald-700 font-bold">{c.period_tasks_completed ?? 0}</td>
                                          <td className="py-2.5 px-4 font-mono text-slate-600">
                                            {formatDigitalDuration(c.total_duration_seconds ?? 0)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}

                          {/* TAB 5: AUDIT HISTORY */}
                          {detailTab === 'audit' && (
                            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                              {expandedProjectDetails?.audit_records?.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                                  No audit events recorded.
                                </div>
                              ) : (
                                expandedProjectDetails?.audit_records?.map((record: any) => (
                                  <div
                                    key={record.audit_id}
                                    className="p-3 rounded-lg bg-white border border-slate-200/80 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                                  >
                                    <div>
                                      <span className="font-bold text-indigo-700 font-mono text-[11px] mr-2">
                                        [{record.action}]
                                      </span>
                                      <span className="text-slate-800 font-medium">by {record.actor_name}</span>
                                      {record.reason && (
                                        <span className="text-slate-600 italic block mt-0.5">
                                          Reason: "{record.reason}"
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                                      {record.timestamp_display || (record.timestamp ? new Date(record.timestamp).toLocaleString() : '--')}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination Controls */}
            {projects.length > pageSize && (
              <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-white rounded-xl border border-slate-200 text-xs text-slate-600 gap-3">
                <div className="font-medium">
                  Showing <span className="font-bold text-slate-900">{(currentPage - 1) * pageSize + 1}</span> to <span className="font-bold text-slate-900">{Math.min(currentPage * pageSize, projects.length)}</span> of <span className="font-bold text-slate-900">{projects.length}</span> projects
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-slate-200 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="font-bold text-slate-700 px-1">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-slate-200 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
