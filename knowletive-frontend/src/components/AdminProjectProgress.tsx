import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FolderKanban, Clock, CheckCircle2, AlertTriangle, 
  ChevronDown, ChevronUp, Users, RefreshCw, Search, 
  Briefcase, MessageSquare, Check, X,
  Calendar, ChevronLeft, ChevronRight, RotateCcw,
  Sparkles, Info
} from 'lucide-react';
import api from '../lib/api';

export interface Employee {
  id: number;
  name: string;
  employee_id: string;
  email: string;
  department: string;
  employee_project_status?: string;
  employee_project_status_display?: string;
  employee_project_status_updated_at?: string | null;
  employee_project_status_updated_at_display?: string | null;
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
  last_activity_display?: string;
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
  period_intervals?: any[];
  primary_interval?: string;
  extra_intervals_count?: number;
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

/**
 * Format total seconds to readable compact duration (e.g. "1h 25m", "45m", "18s", "0m")
 */
export function formatCompactDuration(totalSeconds?: number | null): string {
  if (typeof totalSeconds !== 'number' || isNaN(totalSeconds) || totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

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

function formatDateTimeIst(dateStr?: string | null): string {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(d);
  } catch {
    return dateStr;
  }
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
  const label = `${formatUnambiguousDate(monday)} – ${formatUnambiguousDate(sunday)}`;
  return { monday, sunday, label };
}

/**
 * Filter out redundant descriptions such as "Project for [project name]"
 */
function getCleanProjectDescription(description?: string | null, projectName?: string): string | null {
  if (!description || !description.trim()) return null;
  const trimmedDesc = description.trim();
  if (projectName) {
    const trimmedName = projectName.trim().toLowerCase();
    const lowerDesc = trimmedDesc.toLowerCase();
    if (
      lowerDesc === `project for ${trimmedName}` ||
      lowerDesc === `project for: ${trimmedName}` ||
      lowerDesc === trimmedName
    ) {
      return null;
    }
  }
  return trimmedDesc;
}

export interface ReportedStatusResult {
  status: 'NOT_REPORTED' | 'JUST_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'MIXED';
  label: string;
  colorClass: string;
  explanation?: string;
  counts?: Record<string, number>;
}

/**
 * Derives the employee-reported project status, handling "Mixed" when employees report differing statuses.
 */
export function getProjectReportedStatus(assignedEmployees?: Employee[]): ReportedStatusResult {
  if (!assignedEmployees || assignedEmployees.length === 0) {
    return {
      status: 'NOT_REPORTED',
      label: 'Unspecified',
      colorClass: 'bg-slate-100 text-slate-600 border-slate-200'
    };
  }

  const statuses = assignedEmployees.map((e) => e.employee_project_status || 'JUST_STARTED');
  const distinctStatuses = Array.from(new Set(statuses));

  if (distinctStatuses.length === 1) {
    const s = distinctStatuses[0];
    if (s === 'COMPLETED') {
      return {
        status: 'COMPLETED',
        label: 'Completed',
        colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
      };
    }
    if (s === 'IN_PROGRESS') {
      return {
        status: 'IN_PROGRESS',
        label: 'In Progress',
        colorClass: 'bg-blue-50 text-blue-700 border-blue-200'
      };
    }
    return {
      status: 'JUST_STARTED',
      label: 'Just Started',
      colorClass: 'bg-sky-50 text-sky-700 border-sky-200'
    };
  }

  // Multiple differing statuses -> Mixed
  const counts: Record<string, number> = {};
  statuses.forEach((s) => {
    counts[s] = (counts[s] || 0) + 1;
  });
  const parts: string[] = [];
  if (counts['IN_PROGRESS']) parts.push(`${counts['IN_PROGRESS']} In Progress`);
  if (counts['COMPLETED']) parts.push(`${counts['COMPLETED']} Completed`);
  if (counts['JUST_STARTED']) parts.push(`${counts['JUST_STARTED']} Just Started`);

  return {
    status: 'MIXED',
    label: 'Mixed',
    colorClass: 'bg-amber-50 text-amber-800 border-amber-300',
    explanation: `Employees report differing statuses: ${parts.join(', ')}`,
    counts
  };
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

  // Expandable "More Summary" section
  const [showMoreSummary, setShowMoreSummary] = useState<boolean>(false);

  // Pagination state (10 projects per page)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Drawer Project Details State
  const [drawerProjectId, setDrawerProjectId] = useState<string | null>(null);
  const [drawerDetails, setDrawerDetails] = useState<{
    project: ProjectSummary;
    tasks: TaskItem[];
    work_sessions: any[];
    progress_notes: any[];
    employee_contributions: any[];
    audit_records: any[];
    period_info?: any;
  } | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState<boolean>(false);
  const [drawerError, setDrawerError] = useState<string>('');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [showAdditionalInfo, setShowAdditionalInfo] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<'tasks' | 'sessions' | 'notes' | 'contributions'>('tasks');

  const projectReqSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const detailsCacheRef = useRef<Record<string, any>>({});
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

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
      .catch(() => {});
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
        return;
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

  // Fetch project details for the drawer
  const fetchDrawerDetails = async (projectId: string) => {
    setLoadingDrawer(true);
    setDrawerError('');

    const cacheKey = `${projectId}_${viewPeriod}_${selectedDate}_${selectedWeekDate}_${selectedMonth}_${selectedYear}_${customStartDate}_${customEndDate}_${filterEmployee}`;
    if (detailsCacheRef.current[cacheKey]) {
      setDrawerDetails(detailsCacheRef.current[cacheKey]);
      setLoadingDrawer(false);
      return;
    }

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
      setDrawerDetails(res.data);
    } catch (err: any) {
      setDrawerError(err.response?.data?.error || 'Failed to load project details. Please check your connection and retry.');
    } finally {
      setLoadingDrawer(false);
    }
  };

  // Open details drawer
  const handleOpenDrawer = (projectId: string, initialTab: 'tasks' | 'sessions' | 'notes' | 'contributions' = 'tasks') => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    setDrawerProjectId(projectId);
    setDrawerDetails(null); // Prevent previous project data from flashing
    setDrawerError('');
    setExpandedTaskIds(new Set());
    setShowAdditionalInfo(false);
    setDrawerTab(initialTab);
    fetchDrawerDetails(projectId);
  };

  // Close details drawer & restore focus
  const handleCloseDrawer = () => {
    setDrawerProjectId(null);
    setDrawerDetails(null);
    setDrawerError('');
    if (lastFocusedElementRef.current) {
      try {
        lastFocusedElementRef.current.focus();
      } catch {}
    }
  };

  // Escape key listener to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawerProjectId) {
        handleCloseDrawer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerProjectId]);

  // Toggle expand individual task within drawer
  const toggleTaskExpand = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
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

  // Current active date range text for single IST display
  const activeRangeText = useMemo(() => {
    if (summaryTotals?.period_info?.range_display) {
      return `${summaryTotals.period_info.range_display} (IST)`;
    }
    if (viewPeriod === 'TODAY') {
      return `${formatUnambiguousDate(todayIst)} (Today, IST)`;
    }
    if (viewPeriod === 'SPECIFIC') {
      return `${formatUnambiguousDate(selectedDate)} (IST)`;
    }
    if (viewPeriod === 'WEEKLY') {
      return `${getMondaySundayOfWeek(selectedWeekDate).label} (IST)`;
    }
    if (viewPeriod === 'MONTHLY') {
      return `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} (IST)`;
    }
    if (viewPeriod === 'CUSTOM') {
      return `${formatUnambiguousDate(customStartDate)} – ${formatUnambiguousDate(customEndDate)} (IST)`;
    }
    return 'All Time (Lifetime Activity)';
  }, [summaryTotals, viewPeriod, todayIst, selectedDate, selectedWeekDate, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // Distinct contributing employees count across projects
  const activeEmployeesCount = useMemo(() => {
    const s = new Set<number>();
    projects.forEach((p) => {
      p.assigned_employees?.forEach((e) => s.add(e.id));
    });
    return s.size;
  }, [projects]);

  // Total recorded tasks across projects
  const totalRecordedTasksCount = useMemo(() => {
    return projects.reduce((acc, p) => acc + (p.total_tasks || 0), 0);
  }, [projects]);

  // Active project summary for the drawer (falls back to project in list if details still loading)
  const activeProjectSummary = useMemo(() => {
    if (!drawerProjectId) return null;
    return drawerDetails?.project || projects.find((p) => p.project_id === drawerProjectId) || null;
  }, [drawerProjectId, drawerDetails, projects]);

  return (
    <div className="space-y-5">
      {/* Error Notification */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-semibold flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="p-1 hover:bg-rose-100 rounded-md transition cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 1. COMPACT FILTER BAR */}
      <div className="clay-card p-4 sm:p-5 space-y-3.5">
        {/* Top Filter Strip: Period Selector + Active Range Badge */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Period Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
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
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-teal-600 text-white shadow-xs ring-2 ring-indigo-500/20'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span>{p.label}</span>
                  {isActive && <Sparkles size={11} className="opacity-80" />}
                </button>
              );
            })}
          </div>

          {/* Single IST Date Range Display */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50/90 border border-indigo-200/80 text-xs font-semibold text-indigo-900 shrink-0">
            <Calendar size={13} className="text-indigo-600 shrink-0" />
            <span>Active Window: <strong className="font-bold text-indigo-950">{activeRangeText}</strong></span>
          </div>
        </div>

        {/* Inline Period Controls (Visible when not TODAY or ALL) */}
        {viewPeriod === 'SPECIFIC' && (
          <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedDate((prev) => shiftDateDays(prev, -1))}
              className="clay-btn clay-btn-secondary min-h-[36px] px-2.5 text-xs font-bold flex items-center gap-1"
              title="Previous Day"
            >
              <ChevronLeft size={14} />
              <span>Prev Day</span>
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              className="clay-input text-xs font-semibold min-h-[36px] max-w-[160px]"
            />
            <button
              type="button"
              onClick={() => setSelectedDate((prev) => shiftDateDays(prev, 1))}
              className="clay-btn clay-btn-secondary min-h-[36px] px-2.5 text-xs font-bold flex items-center gap-1"
              title="Next Day"
            >
              <span>Next Day</span>
              <ChevronRight size={14} />
            </button>
            {selectedDate !== todayIst && (
              <button
                type="button"
                onClick={() => setSelectedDate(todayIst)}
                className="clay-btn min-h-[36px] px-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200"
              >
                Today
              </button>
            )}
          </div>
        )}

        {viewPeriod === 'WEEKLY' && (
          <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedWeekDate((prev) => shiftDateDays(prev, -7))}
              className="clay-btn clay-btn-secondary min-h-[36px] px-2.5 text-xs font-bold flex items-center gap-1"
              title="Previous Week"
            >
              <ChevronLeft size={14} />
              <span>Prev Week</span>
            </button>
            <input
              type="date"
              value={selectedWeekDate}
              onChange={(e) => {
                if (e.target.value) setSelectedWeekDate(e.target.value);
              }}
              className="clay-input text-xs font-semibold min-h-[36px] max-w-[160px]"
            />
            <button
              type="button"
              onClick={() => setSelectedWeekDate((prev) => shiftDateDays(prev, 7))}
              className="clay-btn clay-btn-secondary min-h-[36px] px-2.5 text-xs font-bold flex items-center gap-1"
              title="Next Week"
            >
              <span>Next Week</span>
              <ChevronRight size={14} />
            </button>
            {selectedWeekDate !== todayIst && (
              <button
                type="button"
                onClick={() => setSelectedWeekDate(todayIst)}
                className="clay-btn min-h-[36px] px-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200"
              >
                Current Week
              </button>
            )}
          </div>
        )}

        {viewPeriod === 'MONTHLY' && (
          <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
            <button
              type="button"
              onClick={() => {
                let m = selectedMonth - 1;
                let y = selectedYear;
                if (m < 1) { m = 12; y -= 1; }
                setSelectedMonth(m);
                setSelectedYear(y);
              }}
              className="clay-btn clay-btn-secondary min-h-[36px] px-2.5 text-xs font-bold flex items-center gap-1"
              title="Previous Month"
            >
              <ChevronLeft size={14} />
              <span>Prev</span>
            </button>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
              className="clay-input text-xs font-semibold min-h-[36px] min-w-[120px]"
            >
              {MONTH_NAMES.map((mName, idx) => (
                <option key={mName} value={idx + 1}>{mName}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              className="clay-input text-xs font-semibold min-h-[36px] min-w-[80px]"
            >
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                let m = selectedMonth + 1;
                let y = selectedYear;
                if (m > 12) { m = 1; y += 1; }
                setSelectedMonth(m);
                setSelectedYear(y);
              }}
              className="clay-btn clay-btn-secondary min-h-[36px] px-2.5 text-xs font-bold flex items-center gap-1"
              title="Next Month"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {viewPeriod === 'CUSTOM' && (
          <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
            <span className="font-semibold text-slate-600">From:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => {
                if (e.target.value) setCustomStartDate(e.target.value);
              }}
              className="clay-input text-xs font-semibold min-h-[36px]"
            />
            <span className="font-semibold text-slate-600">To:</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => {
                if (e.target.value) setCustomEndDate(e.target.value);
              }}
              className="clay-input text-xs font-semibold min-h-[36px]"
            />
          </div>
        )}

        {/* Bottom Strip: Search, Employee, Status, Clear Filters, Refresh */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100 flex-wrap">
          {/* Search Project */}
          <div className="flex-1 min-w-[220px] relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search project name or ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="clay-input has-icon-left w-full pl-9 pr-3 text-xs min-h-[38px]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Employee Filter */}
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="clay-input text-xs font-medium min-w-[150px] min-h-[38px]"
            >
              <option value="ALL">All Employees</option>
              {availableEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employee_id})
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="clay-input text-xs font-medium min-w-[140px] min-h-[38px]"
            >
              <option value="ALL">All Statuses</option>
              <option value="NOT_STARTED">Not Started</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="ALL_RECORDED_COMPLETED">Recorded Tasks Completed</option>
            </select>

            {/* Clear Filters Button */}
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="clay-btn clay-btn-secondary min-h-[38px] px-3 text-xs font-bold text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5 cursor-pointer"
                title="Reset to Today and clear all search/filter options"
              >
                <RotateCcw size={13} />
                <span>Clear Filters</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              type="button"
              onClick={loadProjects}
              className="clay-btn clay-btn-secondary min-h-[38px] px-3 text-xs font-bold flex items-center gap-1.5"
              title="Refresh project data"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-indigo-600' : 'text-slate-600'} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. FOUR MAIN SUMMARY CARDS */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Card 1: Projects with Activity */}
          <div className="clay-card-flat p-4 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Projects with Activity
              </span>
              <FolderKanban size={16} className="text-indigo-600 shrink-0" />
            </div>
            <p className="text-2xl font-black text-slate-900 mt-1.5">
              {hasLoadedSuccessfully ? (summaryTotals?.total_projects ?? projects.length) : '--'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Active in selected period
            </p>
          </div>

          {/* Card 2: Tasks Worked On */}
          <div className="clay-card-flat p-4 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
                Tasks Worked On
              </span>
              <Briefcase size={16} className="text-blue-600 shrink-0" />
            </div>
            <p className="text-2xl font-black text-blue-700 mt-1.5">
              {hasLoadedSuccessfully ? (summaryTotals?.tasks_worked_count ?? 0) : '--'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Distinct tasks worked in period
            </p>
          </div>

          {/* Card 3: Tasks Completed */}
          <div className="clay-card-flat p-4 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                Tasks Completed
              </span>
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            </div>
            <p className="text-2xl font-black text-emerald-700 mt-1.5">
              {hasLoadedSuccessfully ? (summaryTotals?.tasks_completed_count ?? 0) : '--'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Recorded tasks completed in period
            </p>
          </div>

          {/* Card 4: Time Worked */}
          <div className="clay-card-flat p-4 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">
                Time Worked
              </span>
              <Clock size={16} className="text-amber-600 shrink-0" />
            </div>
            <p className="text-2xl font-black text-amber-700 mt-1.5">
              {hasLoadedSuccessfully ? formatCompactDuration(summaryTotals?.period_tracked_seconds ?? 0) : '--'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Tracked in selected period
            </p>
          </div>
        </div>

        {/* Expandable "More Summary" Toggle & Panel */}
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setShowMoreSummary((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 transition px-2.5 py-1 rounded-lg hover:bg-indigo-50 cursor-pointer"
          >
            <span>{showMoreSummary ? 'Hide Extra Statistics' : 'More Summary'}</span>
            {showMoreSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {showMoreSummary && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 animate-in fade-in duration-200 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Contributing Employees</span>
              <span className="text-base font-bold text-slate-900">{activeEmployeesCount}</span>
              <span className="block text-[10px] text-slate-500">Active across matching projects</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Tasks First Started</span>
              <span className="text-base font-bold text-slate-900">{summaryTotals?.tasks_started_count ?? 0}</span>
              <span className="block text-[10px] text-slate-500">Started during selected window</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Recorded Tasks</span>
              <span className="text-base font-bold text-slate-900">{totalRecordedTasksCount}</span>
              <span className="block text-[10px] text-slate-500">Total in matching projects</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Lifetime Tracked Time</span>
              <span className="text-base font-bold text-slate-900">
                {formatCompactDuration(summaryTotals?.total_tracked_seconds ?? 0)}
              </span>
              <span className="block text-[10px] text-slate-500">Total historical tracked time</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. PROJECT MONITORING LIST / TABLE */}
      <div>
        {loading ? (
          <div className="clay-card p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <RefreshCw size={26} className="animate-spin text-indigo-600" />
            <p className="text-sm font-semibold">Loading project progress for {activeRangeText}...</p>
          </div>
        ) : !hasLoadedSuccessfully && errorMsg ? (
          <div className="clay-card p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
            <AlertTriangle size={32} className="text-rose-500 mx-auto" />
            <p className="text-base font-bold text-slate-800">Unable to load project progress data</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">{errorMsg}</p>
            <button
              onClick={loadProjects}
              className="mt-2 min-h-[40px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center gap-2 shadow-xs cursor-pointer"
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
                ? `No projects had recorded activity during ${activeRangeText} matching your filters. Try resetting filters.`
                : 'Project activity will appear here as employees track time.'}
            </p>
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="mt-4 inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>Reset to Today</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* DESKTOP TABLE (Hidden on mobile) */}
            <div className="hidden md:block clay-card overflow-hidden border border-slate-200/80">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Project</th>
                    <th className="py-3 px-4">Employees</th>
                    <th className="py-3 px-4">Reported Status</th>
                    <th className="py-3 px-4">Time in Period</th>
                    <th className="py-3 px-4">
                      <div>Interval (IST)</div>
                      <div className="text-[10px] text-slate-400 font-normal lowercase">Work session times</div>
                    </th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedProjects.map((project) => {
                    const isSelected = drawerProjectId === project.project_id;
                    const reportedStatus = getProjectReportedStatus(project.assigned_employees);
                    const cleanDesc = getCleanProjectDescription(project.description, project.name);

                    return (
                      <tr
                        key={project.project_id}
                        tabIndex={0}
                        role="button"
                        aria-label={`View details for project ${project.name}`}
                        onClick={() => handleOpenDrawer(project.project_id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleOpenDrawer(project.project_id);
                          }
                        }}
                        className={`group cursor-pointer transition-colors focus:outline-hidden focus:bg-indigo-50/60 focus:ring-2 focus:ring-inset focus:ring-indigo-500/40 ${
                          isSelected ? 'bg-indigo-50/60 ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        {/* Project Name & ID */}
                        <td className="py-3.5 px-4 align-top">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDrawer(project.project_id);
                            }}
                            className="font-extrabold text-slate-900 text-sm hover:text-indigo-600 transition text-left cursor-pointer focus:outline-hidden focus:underline"
                          >
                            {project.name}
                          </button>
                          <div className="font-mono text-[11px] text-slate-400 mt-0.5">{project.project_id}</div>
                          {cleanDesc && (
                            <div className="text-[11px] text-slate-500 line-clamp-1 max-w-xs mt-0.5">
                              {cleanDesc}
                            </div>
                          )}
                        </td>

                        {/* Contributing Employees */}
                        <td className="py-3.5 px-4 align-top">
                          {project.assigned_employees.length === 0 ? (
                            <span className="text-slate-400 italic">None</span>
                          ) : project.assigned_employees.length <= 2 ? (
                            <div className="flex flex-col gap-0.5">
                              {project.assigned_employees.map((e) => (
                                <span key={e.id} className="font-medium text-slate-800 truncate max-w-[170px]">
                                  {e.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-slate-800">
                                {project.assigned_employees[0].name}
                              </span>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-md border border-slate-200 cursor-help"
                                title={project.assigned_employees.map((e) => e.name).join(', ')}
                              >
                                +{project.assigned_employees.length - 1} more
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Reported Status Badge */}
                        <td className="py-3.5 px-4 align-top">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${reportedStatus.colorClass}`}
                            title={reportedStatus.explanation}
                          >
                            {reportedStatus.status === 'MIXED' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                            ) : reportedStatus.status === 'COMPLETED' ? (
                              <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                            ) : reportedStatus.status === 'IN_PROGRESS' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                            ) : (
                              <Clock size={12} className="text-slate-400 shrink-0" />
                            )}
                            <span>{reportedStatus.label}</span>
                          </span>
                        </td>

                        {/* Time in Period (e.g. 1h 25m) */}
                        <td className="py-3.5 px-4 align-top font-mono font-bold text-slate-900 text-xs">
                          {formatCompactDuration(project.period_tracked_seconds)}
                        </td>

                        {/* Interval (IST) */}
                        <td className="py-3.5 px-4 align-top">
                          {!project.primary_interval || project.primary_interval === 'No work session' ? (
                            <span className="text-slate-400 italic text-xs">No work session</span>
                          ) : (
                            <div className="flex flex-col gap-1 items-start">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {project.primary_interval.includes('Running') && (
                                  <span
                                    className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block shrink-0"
                                    title="Active session running"
                                  />
                                )}
                                <span
                                  className={`font-mono text-xs font-semibold ${
                                    project.primary_interval.includes('Running')
                                      ? 'text-emerald-700'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {project.primary_interval}
                                </span>
                              </div>
                              {project.extra_intervals_count && project.extra_intervals_count > 0 ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenDrawer(project.project_id, 'sessions');
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80 hover:bg-indigo-100 hover:text-indigo-800 transition cursor-pointer"
                                  title={`Click to view all ${project.extra_intervals_count + 1} work intervals`}
                                >
                                  <span>+{project.extra_intervals_count} more</span>
                                </button>
                              ) : null}
                            </div>
                          )}
                        </td>

                        {/* View Details Action Button */}
                        <td className="py-3.5 px-4 align-top text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDrawer(project.project_id);
                            }}
                            className={`min-h-[36px] px-3.5 py-1 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200'
                            }`}
                            title="View Details"
                          >
                            <span>View Details</span>
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE CARDS (Visible on mobile, hidden on desktop) */}
            <div className="block md:hidden space-y-3">
              {paginatedProjects.map((project) => {
                const isSelected = drawerProjectId === project.project_id;
                const reportedStatus = getProjectReportedStatus(project.assigned_employees);
                const cleanDesc = getCleanProjectDescription(project.description, project.name);

                return (
                  <div
                    key={project.project_id}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for project ${project.name}`}
                    onClick={() => handleOpenDrawer(project.project_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenDrawer(project.project_id);
                      }
                    }}
                    className={`clay-card p-4 space-y-3 border transition cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50 ${
                      isSelected ? 'ring-2 ring-indigo-500/40 border-indigo-200 bg-indigo-50/20' : 'border-slate-200/80 hover:border-slate-300'
                    }`}
                  >
                    {/* Project Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">{project.name}</h3>
                        <span className="font-mono text-[10px] text-slate-400">{project.project_id}</span>
                        {cleanDesc && (
                          <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{cleanDesc}</p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border shrink-0 ${reportedStatus.colorClass}`}
                      >
                        {reportedStatus.label}
                      </span>
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">Employees</span>
                        <span className="font-medium text-slate-800 line-clamp-1">
                          {project.assigned_employees.length > 0
                            ? project.assigned_employees.map((e) => e.name).join(', ')
                            : 'None'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">Time in Period</span>
                        <span className="font-mono font-bold text-indigo-700">
                          {formatCompactDuration(project.period_tracked_seconds)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">Interval (IST)</span>
                        {!project.primary_interval || project.primary_interval === 'No work session' ? (
                          <span className="text-slate-400 italic text-xs">No work session</span>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            {project.primary_interval.includes('Running') && (
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            )}
                            <span
                              className={`font-mono text-xs font-bold ${
                                project.primary_interval.includes('Running')
                                  ? 'text-emerald-700'
                                  : 'text-slate-800'
                              }`}
                            >
                              {project.primary_interval}
                            </span>
                            {project.extra_intervals_count && project.extra_intervals_count > 0 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenDrawer(project.project_id, 'sessions');
                                }}
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 cursor-pointer"
                              >
                                +{project.extra_intervals_count} more
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* View Details Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDrawer(project.project_id);
                      }}
                      className="w-full min-h-[44px] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 cursor-pointer"
                    >
                      <span>View Details</span>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                );
              })}
            </div>

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
                    className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-200 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
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
                    className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-200 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. DETAILS DRAWER: Right-side on Desktop, Full-screen on Mobile */}
      {drawerProjectId && (
        <>
          {/* Desktop Backdrop */}
          <div
            className="hidden md:block fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-40 transition-opacity animate-in fade-in"
            onClick={handleCloseDrawer}
            aria-hidden="true"
          />

          {/* Drawer Container */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Project Details Panel"
            className="fixed inset-y-0 right-0 z-50 w-full md:max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 border-l border-slate-200"
          >
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-white flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {drawerProjectId}
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900 truncate">
                    {activeProjectSummary?.name || 'Project Details'}
                  </h3>
                </div>
                {activeProjectSummary && getCleanProjectDescription(activeProjectSummary.description, activeProjectSummary.name) && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {getCleanProjectDescription(activeProjectSummary.description, activeProjectSummary.name)}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1 font-medium text-slate-700">
                    <Calendar size={13} className="text-indigo-600" />
                    <span>{activeRangeText}</span>
                  </span>
                  {filterEmployee !== 'ALL' && (
                    <span className="text-indigo-600 font-semibold">
                      • Filtered by employee
                    </span>
                  )}
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer shrink-0 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                title="Close Details (Esc)"
                aria-label="Close details"
              >
                <X size={20} />
              </button>
            </div>

            {/* Drawer Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* If Drawer Error */}
              {drawerError ? (
                <div className="p-6 rounded-xl bg-rose-50 border border-rose-200 text-center space-y-2">
                  <AlertTriangle size={24} className="text-rose-600 mx-auto" />
                  <p className="text-sm font-bold text-rose-900">{drawerError}</p>
                  <button
                    type="button"
                    onClick={() => fetchDrawerDetails(drawerProjectId)}
                    className="min-h-[38px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer mt-2"
                  >
                    <RefreshCw size={14} />
                    <span>Retry</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Top 3 KPI Cards */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {/* KPI 1: Time in Period */}
                    <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100">
                      <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                        Time in Period
                      </span>
                      <p className="text-lg font-black text-indigo-950 font-mono mt-0.5">
                        {formatCompactDuration(activeProjectSummary?.period_tracked_seconds)}
                      </p>
                      <span className="text-[10px] text-indigo-600 block truncate">In selected window</span>
                    </div>

                    {/* KPI 2: Tasks Completed */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        Tasks Completed
                      </span>
                      <p className="text-lg font-black text-slate-900 mt-0.5">
                        {activeProjectSummary ? `${activeProjectSummary.completed_tasks} of ${activeProjectSummary.total_tasks}` : '--'}
                      </p>
                      <span className="text-[10px] text-slate-400 block truncate">Recorded tasks completed</span>
                    </div>

                    {/* KPI 3: Reported Status */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        Reported Status
                      </span>
                      <div className="mt-1">
                        {activeProjectSummary ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${
                              getProjectReportedStatus(activeProjectSummary.assigned_employees).colorClass
                            }`}
                          >
                            {getProjectReportedStatus(activeProjectSummary.assigned_employees).label}
                          </span>
                        ) : '--'}
                      </div>
                      <span className="text-[10px] text-slate-400 block truncate mt-0.5">Current contribution</span>
                    </div>
                  </div>

                  {/* Contributing Employees and Reported Project Status */}
                  <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                        <Users size={14} className="text-indigo-600" />
                        <span>Contributing Employees & Reported Status</span>
                      </span>
                      {activeProjectSummary && getProjectReportedStatus(activeProjectSummary.assigned_employees).status === 'MIXED' && (
                        <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                          Mixed Status
                        </span>
                      )}
                    </div>

                    {activeProjectSummary?.assigned_employees && activeProjectSummary.assigned_employees.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activeProjectSummary.assigned_employees.map((emp) => (
                          <div key={emp.id} className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900">{emp.name}</span>
                              <span className="font-mono text-[10px] text-slate-400">{emp.employee_id}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-slate-500">Reported:</span>
                              <span
                                className={`px-2 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider ${
                                  emp.employee_project_status === 'COMPLETED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : emp.employee_project_status === 'IN_PROGRESS'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-sky-100 text-sky-800'
                                }`}
                              >
                                {emp.employee_project_status_display || 'Just Started'}
                              </span>
                            </div>
                            {emp.employee_project_status_updated_at_display && (
                              <span className="text-[10px] text-slate-400 block">
                                Updated: {emp.employee_project_status_updated_at_display}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No employees assigned to this project yet.</p>
                    )}
                  </div>

                  {/* Navigation Tabs inside Drawer */}
                  <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setDrawerTab('tasks')}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        drawerTab === 'tasks'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <Briefcase size={13} />
                      <span>Tasks ({drawerDetails?.tasks?.length ?? activeProjectSummary?.total_tasks ?? 0})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDrawerTab('sessions')}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        drawerTab === 'sessions'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <Clock size={13} />
                      <span>Work Sessions ({drawerDetails?.work_sessions?.length || 0})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDrawerTab('notes')}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        drawerTab === 'notes'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <MessageSquare size={13} />
                      <span>Progress Notes ({drawerDetails?.progress_notes?.length || 0})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDrawerTab('contributions')}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        drawerTab === 'contributions'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <Users size={13} />
                      <span>Employee Breakdown</span>
                    </button>
                  </div>

                  {/* Loading indicator while fetching details */}
                  {loadingDrawer ? (
                    <div className="py-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                      <RefreshCw size={22} className="animate-spin text-indigo-600" />
                      <p className="text-xs font-semibold">Loading details for {activeProjectSummary?.name}...</p>
                    </div>
                  ) : (
                    <>
                      {/* TAB 1: TASKS LIST WITH EXPANDABLE TASK DETAILS */}
                      {drawerTab === 'tasks' && (
                        <div className="space-y-2.5">
                          {drawerDetails?.tasks?.length === 0 ? (
                            <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                              No tasks found under this project for {activeRangeText}.
                            </div>
                          ) : (
                            drawerDetails?.tasks?.map((task) => {
                              const isTaskExpanded = expandedTaskIds.has(task.task_id);

                              return (
                                <div
                                  key={task.task_id}
                                  className="rounded-xl border border-slate-200 bg-white overflow-hidden transition"
                                >
                                  {/* Task Summary Row */}
                                  <div
                                    tabIndex={0}
                                    role="button"
                                    onClick={() => toggleTaskExpand(task.task_id)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggleTaskExpand(task.task_id);
                                      }
                                    }}
                                    className="p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer hover:bg-slate-50/80 transition"
                                  >
                                    <div className="space-y-1 flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                          {task.task_id}
                                        </span>
                                        <h4 className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                                          {task.title}
                                        </h4>
                                        {task.status === 'COMPLETED' ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            <Check size={10} /> Completed
                                          </span>
                                        ) : task.status === 'IN_PROGRESS' ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" /> In Progress
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                            Not Started
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
                                        {task.assigned_to && (
                                          <span>
                                            Employee: <strong className="text-slate-800">{task.assigned_to.name}</strong>
                                          </span>
                                        )}
                                        <span>
                                          Period: <strong className="font-mono text-indigo-700">{formatCompactDuration(task.period_duration_seconds)}</strong>
                                        </span>
                                        {task.last_activity_display && (
                                          <span>Last activity: <strong className="text-slate-700">{task.last_activity_display}</strong></span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-[11px] text-slate-400 font-semibold">
                                        {isTaskExpanded ? 'Hide' : 'Expand'}
                                      </span>
                                      {isTaskExpanded ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} className="text-slate-500" />}
                                    </div>
                                  </div>

                                  {/* Expanded Task Details */}
                                  {isTaskExpanded && (
                                    <div className="border-t border-slate-100 bg-slate-50/60 p-3.5 space-y-3 text-xs">
                                      {task.description && (
                                        <div>
                                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Description</span>
                                          <p className="text-slate-700 mt-0.5">{task.description}</p>
                                        </div>
                                      )}

                                      {/* Task Sessions */}
                                      <div>
                                        <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                                          Work Sessions in Period ({task.work_sessions?.length || 0})
                                        </span>
                                        {task.work_sessions && task.work_sessions.length > 0 ? (
                                          <div className="space-y-1">
                                            {task.work_sessions.map((ws: any, idx: number) => (
                                              <div key={ws.session_id || idx} className="p-2 rounded bg-white border border-slate-200 flex items-center justify-between text-[11px]">
                                                <span className="font-semibold text-slate-800">{ws.date_display || ws.date}</span>
                                                <span className="font-mono text-slate-500">{ws.start_time_display || '--'} – {ws.end_time_display || 'Active'}</span>
                                                <span className="font-mono font-bold text-indigo-700">{formatCompactDuration(ws.duration_seconds)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-[11px] text-slate-400 italic">No work sessions recorded for this task in the selected period.</p>
                                        )}
                                      </div>

                                      {/* Task Notes */}
                                      {task.progress_notes && task.progress_notes.length > 0 && (
                                        <div>
                                          <span className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                                            Progress Notes ({task.progress_notes.length})
                                          </span>
                                          <div className="space-y-1">
                                            {task.progress_notes.map((note) => (
                                              <div key={note.note_id} className="p-2 rounded bg-white border border-slate-200 text-[11px]">
                                                <div className="flex items-center justify-between text-slate-400 mb-0.5">
                                                  <span className="font-bold text-slate-700">{note.author_name}</span>
                                                  <span>{note.created_at_display}</span>
                                                </div>
                                                <p className="text-slate-800">{note.content}</p>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}

                      {/* TAB 2: WORK SESSIONS */}
                      {drawerTab === 'sessions' && (
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                          {drawerDetails?.work_sessions?.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-xs">
                              No work sessions recorded within {activeRangeText}.
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold">
                                  <tr>
                                    <th className="py-2.5 px-3">Date (IST)</th>
                                    <th className="py-2.5 px-3">Task</th>
                                    <th className="py-2.5 px-3">Employee</th>
                                    <th className="py-2.5 px-3">Interval</th>
                                    <th className="py-2.5 px-3">Duration</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {drawerDetails?.work_sessions?.map((ws: any, idx: number) => (
                                    <tr key={ws.session_id || idx} className="hover:bg-slate-50/50">
                                      <td className="py-2 px-3 font-semibold text-slate-900">{ws.date_display || ws.date}</td>
                                      <td className="py-2 px-3 text-slate-800 font-medium">{ws.task_title}</td>
                                      <td className="py-2 px-3 text-slate-700">
                                        <span className="font-semibold text-slate-800">{ws.user_name}</span>
                                        {ws.employee_id && (
                                          <span className="font-mono text-slate-400 text-[10px] ml-1">({ws.employee_id})</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 font-mono text-[11px]">
                                        <div className="flex items-center gap-1.5">
                                          {ws.is_running && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                                          )}
                                          <span className={ws.is_running ? 'text-emerald-700 font-bold' : 'text-slate-700 font-semibold'}>
                                            {ws.interval_display || `${ws.start_time_display || '--'} – ${ws.end_time_display || (ws.is_running ? 'Running' : '--')}`}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 font-mono font-bold text-indigo-700">
                                        {formatCompactDuration(ws.duration_seconds)}
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
                      {drawerTab === 'notes' && (
                        <div className="space-y-2">
                          {drawerDetails?.progress_notes?.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-slate-200">
                              No progress notes recorded during {activeRangeText}.
                            </div>
                          ) : (
                            drawerDetails?.progress_notes?.map((note: any) => (
                              <div
                                key={note.note_id}
                                className="p-3 rounded-xl bg-white border border-slate-200 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between text-[11px] text-slate-500 border-b border-slate-100 pb-1">
                                  <span className="font-bold text-slate-800">
                                    {note.author_name} • <span className="font-medium text-slate-600">{note.task_title}</span>
                                  </span>
                                  <span className="font-mono text-slate-400">{note.created_at_display}</span>
                                </div>
                                <p className="text-slate-800 text-xs mt-0.5">{note.content}</p>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* TAB 4: EMPLOYEE CONTRIBUTIONS */}
                      {drawerTab === 'contributions' && (
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                          {drawerDetails?.employee_contributions?.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-xs">
                              No employee contributions recorded yet.
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold">
                                  <tr>
                                    <th className="py-2.5 px-3">Employee</th>
                                    <th className="py-2.5 px-3">Reported</th>
                                    <th className="py-2.5 px-3">Period Time</th>
                                    <th className="py-2.5 px-3">Tasks Completed</th>
                                    <th className="py-2.5 px-3">Lifetime Time</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {drawerDetails?.employee_contributions?.map((c) => (
                                    <tr key={c.user_id} className="hover:bg-slate-50/50">
                                      <td className="py-2.5 px-3 font-bold text-slate-900">
                                        {c.employee_name} <span className="font-mono text-slate-400 text-[11px]">({c.employee_id})</span>
                                      </td>
                                      <td className="py-2.5 px-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          c.employee_project_status === 'COMPLETED'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : c.employee_project_status === 'IN_PROGRESS'
                                            ? 'bg-blue-100 text-blue-800'
                                            : 'bg-sky-100 text-sky-800'
                                        }`}>
                                          {c.employee_project_status_display || 'Just Started'}
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-700 bg-indigo-50/30">
                                        {formatCompactDuration(c.period_duration_seconds ?? 0)}
                                      </td>
                                      <td className="py-2.5 px-3 text-emerald-700 font-bold">{c.period_tasks_completed ?? 0}</td>
                                      <td className="py-2.5 px-3 font-mono text-slate-600">
                                        {formatCompactDuration(c.total_duration_seconds ?? 0)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* 5. ADDITIONAL INFORMATION (Collapsible Accordion) */}
                  <div className="border border-slate-200 rounded-xl bg-slate-50/70 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setShowAdditionalInfo((prev) => !prev)}
                      className="w-full p-3.5 flex items-center justify-between text-left font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 transition cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Info size={14} className="text-indigo-600" />
                        <span>Additional Information (Lifetime & History)</span>
                      </span>
                      {showAdditionalInfo ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>

                    {showAdditionalInfo && (
                      <div className="p-3.5 border-t border-slate-200 bg-white grid grid-cols-2 gap-3 animate-in fade-in duration-150">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Lifetime Tracked Time</span>
                          <span className="font-mono font-bold text-slate-900 text-sm">
                            {formatCompactDuration(activeProjectSummary?.lifetime_tracked_seconds ?? activeProjectSummary?.total_tracked_seconds)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">First Started Date</span>
                          <span className="font-semibold text-slate-800">
                            {activeProjectSummary?.started_at_display || (activeProjectSummary?.first_started_at ? formatDateTimeIst(activeProjectSummary.first_started_at) : 'Not started')}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Project Created</span>
                          <span className="font-medium text-slate-700">
                            {activeProjectSummary?.created_at ? formatDateTimeIst(activeProjectSummary.created_at) : '--'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Last Updated</span>
                          <span className="font-medium text-slate-700">
                            {activeProjectSummary?.updated_at ? formatDateTimeIst(activeProjectSummary.updated_at) : '--'}
                          </span>
                        </div>
                        <div className="col-span-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                          <strong>Note:</strong> Time in Period includes only activity recorded within {activeRangeText}. Lifetime time and reported status reflect overall historical metrics.
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
