import { useState, useEffect, useCallback } from 'react';
import { formatHumanReadableDuration } from '../utils/formatters';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import {
  Clock,
  Coffee,
  ListTodo,
  Users,
  FolderKanban,
  Calendar,
  RotateCcw,
  RefreshCw,
  Search,
  TrendingUp,
  PieChart as PieIcon,
  BarChart3,
  AlertTriangle
} from 'lucide-react';
import api from '../lib/api';

const COLORS = [
  '#2563eb', // blue-600
  '#0d9488', // teal-600
  '#0284c7', // sky-600
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#3b82f6', // blue-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
  '#64748b'  // slate-500
];

interface AnalyticsSummary {
  total_work_seconds: number;
  total_work_hours: number;
  total_work_formatted: string;
  total_break_seconds: number;
  total_break_hours: number;
  total_break_formatted: string;
  total_tasks: number;
  completed_tasks: number;
  in_progress_tasks: number;
  employee_count: number;
  employees_with_records?: number;
  total_registered_employees?: number;
  active_projects_count: number;
  days_worked_count: number;
  avg_daily_work_hours: number;
}

interface DailyTrendItem {
  date: string;
  label: string;
  day_name: string;
  work_hours: number;
  work_seconds: number;
  break_hours: number;
  break_seconds: number;
  tasks_count: number;
  active_employees: number;
}

interface ProjectBreakdownItem {
  project_name: string;
  work_hours: number;
  work_seconds: number;
  work_duration_formatted: string;
  tasks_count: number;
  employee_count: number;
  percentage: number;
}

interface EmployeeBreakdownItem {
  user_id: number;
  employee_id: string;
  employee_name: string;
  department: string;
  work_hours: number;
  work_seconds: number;
  work_duration_formatted: string;
  break_hours: number;
  tasks_count: number;
  percentage: number;
}

interface TaskBreakdownItem {
  task_name: string;
  project_name: string;
  work_hours: number;
  work_seconds: number;
  work_duration_formatted: string;
  count: number;
  status: string;
}

interface AnalyticsApiResponse {
  user_role: string;
  is_admin: boolean;
  date_range: {
    start_date: string;
    end_date: string;
    period: string;
  };
  summary: AnalyticsSummary;
  daily_trend: DailyTrendItem[];
  by_project: ProjectBreakdownItem[];
  by_employee: EmployeeBreakdownItem[];
  by_task: TaskBreakdownItem[];
  filters: {
    employees: Array<{ id: number; employee_id: string; name: string }>;
    projects: string[];
  };
}

interface Props {
  initialEmployeeId?: string;
  onNavigateToTimesheet?: () => void;
  showTitle?: boolean;
}

export default function RechartsAnalyticsDashboard({
  initialEmployeeId = '',
  onNavigateToTimesheet,
  showTitle = true
}: Props) {
  // Filters State
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'month' | 'custom'>('7d');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId);
  const [projectFilter, setProjectFilter] = useState<string>('');

  // Data & Request State
  const [data, setData] = useState<AnalyticsApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Fetch from Django Backend
  const fetchAnalytics = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('period', period);
      if (period === 'custom') {
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
      }
      if (employeeId) {
        params.append('employee_id', employeeId);
      }
      if (projectFilter.trim()) {
        params.append('project', projectFilter.trim());
      }

      const res = await api.get<AnalyticsApiResponse>(`/analytics/dashboard/?${params.toString()}`);
      setData(res.data);
    } catch (err: any) {
      console.error('Failed to load analytics:', err);
      setError(err.response?.data?.error || 'Failed to load analytics data from server.');
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [period, startDate, endDate, employeeId, projectFilter]);

  // Initial fetch and automatic refresh on save, window focus, and 30-sec polling
  useEffect(() => {
    fetchAnalytics();
    const intervalTimer = setInterval(() => {
      fetchAnalytics(true);
    }, 30000);

    const handleRecordSaved = () => {
      fetchAnalytics(false);
    };

    window.addEventListener('timetracker_record_saved', handleRecordSaved);
    window.addEventListener('focus', handleRecordSaved);

    return () => {
      clearInterval(intervalTimer);
      window.removeEventListener('timetracker_record_saved', handleRecordSaved);
      window.removeEventListener('focus', handleRecordSaved);
    };
  }, [fetchAnalytics]);

  const handleClearFilters = () => {
    setPeriod('7d');
    setStartDate('');
    setEndDate('');
    setEmployeeId('');
    setProjectFilter('');
  };

  const summary = data?.summary;
  const isAdmin = data?.is_admin;

  // Check if data is completely empty
  const hasNoRecords =
    !loading &&
    (!summary ||
      (summary.total_work_seconds === 0 &&
        summary.total_break_seconds === 0 &&
        summary.total_tasks === 0));

  return (
    <div className="space-y-6">
      {/* 1. Header with Role Badge & Actions */}
      {showTitle && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp size={22} className="text-indigo-600" />
                <span>Time & Work Analytics</span>
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                isAdmin ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {isAdmin ? 'Admin Console' : 'My Personal Analytics'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {isAdmin
                ? 'Team-wide tracked hours, productivity trends, and project distributions powered by Recharts'
                : 'Review your tracked work hours, breaks, tasks, and project breakdowns over time'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {onNavigateToTimesheet && (
              <button
                onClick={onNavigateToTimesheet}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition"
              >
                <Calendar size={14} />
                <span>View Timesheet</span>
              </button>
            )}
            <button
              onClick={() => fetchAnalytics()}
              disabled={loading}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition disabled:opacity-60"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Interactive Filters Bar (Period, Date Range, Employee, Project) */}
      <div className="clay-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          {/* Quick Period Selector */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-2xl text-xs font-bold">
            <button
              onClick={() => setPeriod('today')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === 'today' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setPeriod('7d')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === '7d' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setPeriod('30d')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === '30d' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setPeriod('month')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === 'month' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setPeriod('custom')}
              className={`px-3 py-1.5 rounded-xl transition ${
                period === 'custom' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Custom Range
            </button>
          </div>

          {/* Clear Filters Button */}
          {(period !== '7d' || employeeId || projectFilter || startDate || endDate) && (
            <button
              onClick={handleClearFilters}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1.5 transition"
            >
              <RotateCcw size={12} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        {/* Detailed Filter Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Custom Date Pickers (Active when period is custom) */}
          {period === 'custom' ? (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Start Date (IST)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="clay-input w-full text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  End Date (IST)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="clay-input w-full text-xs font-mono"
                />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2 flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600">
              <Calendar size={15} className="text-indigo-600 shrink-0" />
              <span>
                Active Window: <strong className="text-slate-900 font-mono">{data?.date_range.start_date || '...'}</strong> to{' '}
                <strong className="text-slate-900 font-mono">{data?.date_range.end_date || '...'}</strong>
              </span>
            </div>
          )}

          {/* Filter by Employee (Admin Only) */}
          {isAdmin ? (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Filter by Employee
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="clay-input w-full text-xs"
              >
                <option value="">All Permitted Employees</option>
                {data?.filters.employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} [{emp.employee_id}]
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600">
              <Users size={15} className="text-emerald-600 shrink-0" />
              <span>Role: <strong className="text-slate-900">Personal Employee Data Only</strong></span>
            </div>
          )}

          {/* Filter by Project */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Filter by Project
            </label>
            <div className="relative">
              <input
                type="text"
                list="projects-filter-datalist"
                placeholder="All Projects or search..."
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="clay-input w-full pl-8 text-xs"
              />
              <Search size={14} className="absolute left-2.5 top-3 text-slate-400" />
              <datalist id="projects-filter-datalist">
                {data?.filters?.projects?.map((proj) => (
                  <option key={proj} value={proj} />
                ))}
              </datalist>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Error Banner */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchAnalytics()}
            className="px-3 py-1 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* 4. Loading State Skeleton */}
      {loading && !data && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-slate-200/70 rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-80 bg-slate-200/70 rounded-2xl" />
            <div className="h-80 bg-slate-200/70 rounded-2xl" />
          </div>
        </div>
      )}

      {/* 5. No Results / Empty State */}
      {hasNoRecords && (
        <div className="clay-card p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-3.5 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
            <Calendar size={30} />
          </div>
          <h3 className="text-base font-bold text-slate-900">No Time Tracking Activity Found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
            There are no recorded work events, clock-ins, or tasks for the selected date window
            {projectFilter ? ` and project "${projectFilter}"` : ''}.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              onClick={handleClearFilters}
              className="clay-btn clay-btn-primary text-xs flex items-center gap-2"
            >
              <RotateCcw size={14} />
              <span>Reset All Filters</span>
            </button>
          </div>
        </div>
      )}

      {/* 6. Active Analytics Dashboard (When data exists) */}
      {data && summary && !hasNoRecords && (
        <>
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Tracked Time */}
            <div className="clay-card-flat p-4 relative overflow-hidden group hover:border-indigo-300 transition">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tracked Work Time</span>
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-2xs">
                  <Clock size={16} />
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-black text-slate-900 font-mono tracking-tight">
                {formatHumanReadableDuration(summary.total_work_seconds || 0)}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600 font-medium">
                <span className="font-bold text-indigo-600">Productive Time</span>
                <span className="text-slate-300">•</span>
                <span>{summary.days_worked_count} day{summary.days_worked_count !== 1 ? 's' : ''} active</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600" />
            </div>

            {/* Card 2: Total Break Time */}
            <div className="clay-card-flat p-4 relative overflow-hidden group hover:border-amber-300 transition">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Total Break Time</span>
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-2xs">
                  <Coffee size={16} />
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-black text-amber-600 font-mono tracking-tight">
                {formatHumanReadableDuration(summary.total_break_seconds || 0)}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600">
                <span className="font-bold text-amber-700">Pause sessions</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500" />
            </div>

            {/* Card 3: Tasks Count */}
            <div className="clay-card-flat p-4 relative overflow-hidden group hover:border-emerald-300 transition">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Tasks Logged</span>
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-2xs">
                  <ListTodo size={16} />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {summary.total_tasks}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]">
                <span className="text-emerald-700 font-bold">{summary.completed_tasks} Completed</span>
                <span className="text-slate-300">•</span>
                <span className="text-amber-700 font-bold">{summary.in_progress_tasks} Active</span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500" />
            </div>

            {/* Card 4: Employees with Records / Projects Count */}
            <div className="clay-card-flat p-4 relative overflow-hidden group hover:border-teal-300 transition">
              <div className="flex items-center justify-between text-slate-500 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {isAdmin ? 'Employees With Records' : 'Active Projects'}
                </span>
                <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shadow-2xs">
                  {isAdmin ? <Users size={16} /> : <FolderKanban size={16} />}
                </div>
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {isAdmin ? (summary.employees_with_records ?? summary.employee_count) : summary.active_projects_count}
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600 truncate font-medium">
                {isAdmin ? (
                  <span>With active tracked sessions or tasks</span>
                ) : (
                  <span>Avg {formatHumanReadableDuration(Math.round((summary.avg_daily_work_hours || 0) * 3600))} / workday</span>
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-teal-500" />
            </div>
          </div>

          {/* Recharts Chart 1: Daily Work & Break Trends Over Time */}
          <div className="clay-card p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <TrendingUp size={16} className="text-indigo-600" />
                  <span>Work & Break Hours Trend (Daily Breakdown)</span>
                </h3>
                <p className="text-xs text-slate-500">Tracked work time vs break duration over the selected period</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                  <span className="w-3 h-3 rounded bg-indigo-600" />
                  Work Hours
                </span>
                <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                  <span className="w-3 h-3 rounded bg-amber-500" />
                  Break Hours
                </span>
              </div>
            </div>

            <div className="h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily_trend} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorWork" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorBreak" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `${val}h`}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload as DailyTrendItem;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1">
                          <p className="font-bold text-indigo-300">
                            {d.date} ({d.day_name})
                          </p>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300">Work Time:</span>
                            <span className="font-mono font-bold text-emerald-400">{formatHumanReadableDuration(d.work_seconds || Math.round((d.work_hours || 0) * 3600))}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300">Break Time:</span>
                            <span className="font-mono font-bold text-amber-400">{formatHumanReadableDuration(d.break_seconds || Math.round((d.break_hours || 0) * 3600))}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-t border-slate-700/80 pt-1 text-[11px]">
                            <span className="text-slate-400">Tasks logged:</span>
                            <span className="font-mono text-slate-200">{d.tasks_count}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="work_hours"
                    stroke="#4f46e5"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorWork)"
                    name="Work Hours"
                  />
                  <Bar
                    dataKey="break_hours"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                    name="Break Hours"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recharts Charts 2 & 3: Project Allocation (Donut) & Employee / Task Workload */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Chart 2: Project Allocation Breakdown (Donut Chart) - 6 cols */}
            <div className="lg:col-span-6 clay-card p-5 sm:p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <PieIcon size={16} className="text-indigo-600" />
                      <span>Project Time Allocation</span>
                    </h3>
                    <p className="text-xs text-slate-500">Tracked hours and relative share by project</p>
                  </div>
                  <span className="px-2.5 py-1 clay-pill bg-indigo-50 border-indigo-100 text-[11px] font-mono font-bold text-indigo-700">
                    {data.by_project.length} Project{data.by_project.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {data.by_project.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-8 text-center">No project activity recorded in this period.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-2">
                    {/* Donut Chart */}
                    <div className="sm:col-span-6 h-56 flex items-center justify-center relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.by_project}
                            dataKey="work_hours"
                            nameKey="project_name"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={3}
                          >
                            {data.by_project.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload.length) return null;
                              const p = payload[0].payload as ProjectBreakdownItem;
                              return (
                                <div className="bg-slate-900 text-white p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                                  <p className="font-bold text-indigo-300">{p.project_name}</p>
                                  <p className="text-slate-200">
                                    Time: <strong className="font-mono text-emerald-400">{formatHumanReadableDuration(p.work_seconds || Math.round((p.work_hours || 0) * 3600))}</strong>
                                  </p>
                                  <p className="text-slate-400 text-[11px]">
                                    Share: {p.percentage}% • {p.tasks_count} tasks
                                  </p>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Total Tracked</span>
                        <span className="text-lg font-black text-slate-900 font-mono">{formatHumanReadableDuration(summary.total_work_seconds || 0)}</span>
                      </div>
                    </div>

                    {/* Project Ranked List */}
                    <div className="sm:col-span-6 space-y-2">
                      {data.by_project.slice(0, 5).map((p, idx) => (
                        <div key={p.project_name} className="p-2 bg-slate-50 border border-slate-150 rounded-xl text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 truncate pr-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                              />
                              <span className="font-semibold text-slate-800 truncate" title={p.project_name}>
                                {p.project_name}
                              </span>
                            </div>
                            <span className="font-mono font-bold text-slate-900 shrink-0">
                              {p.work_duration_formatted}
                            </span>
                          </div>
                          <div className="w-full bg-slate-200/80 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(p.percentage, 3)}%`,
                                backgroundColor: COLORS[idx % COLORS.length]
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                            <span>{p.percentage}% share</span>
                            <span>{p.tasks_count} task{p.tasks_count !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>Hover pie slices to inspect exact hours</span>
                <span className="font-mono text-slate-700 font-bold">{summary.active_projects_count} Total Projects</span>
              </div>
            </div>

            {/* Chart 3: Employee Workload (Admin) OR Top Tasks Breakdown (Employee) - 6 cols */}
            <div className="lg:col-span-6 clay-card p-5 sm:p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <BarChart3 size={16} className="text-teal-600" />
                      <span>{isAdmin ? 'Employee Time Contribution' : 'Top Task Activity Breakdown'}</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      {isAdmin
                        ? 'Comparative tracked work and break hours per team member'
                        : 'Your highest duration tasks and recorded project hours'}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-teal-50 border border-teal-100 rounded-lg text-[11px] font-mono font-bold text-teal-700">
                    {isAdmin ? `${data.by_employee.length} Members` : `${data.by_task.length} Tasks`}
                  </span>
                </div>

                {isAdmin ? (
                  // Admin View: Recharts Horizontal Bar Chart of Employees
                  data.by_employee.length === 0 ? (
                    <p className="text-xs text-slate-400 italic py-8 text-center">No employee records in this window.</p>
                  ) : (
                    <div className="h-64 w-full pt-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={data.by_employee.slice(0, 6)}
                          margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                          <XAxis type="number" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${v}h`} />
                          <YAxis
                            type="category"
                            dataKey="employee_name"
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            width={90}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload.length) return null;
                              const e = payload[0].payload as EmployeeBreakdownItem;
                              return (
                                <div className="bg-slate-900 text-white p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                                  <p className="font-bold text-blue-300">
                                    {e.employee_name} [{e.employee_id}]
                                  </p>
                                  <p className="text-slate-300 text-[11px]">{e.department}</p>
                                  <div className="flex justify-between gap-3 pt-1 border-t border-slate-700">
                                    <span>Work Hours:</span>
                                    <span className="font-mono text-emerald-400 font-bold">{formatHumanReadableDuration(e.work_seconds || Math.round((e.work_hours || 0) * 3600))}</span>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <span>Share:</span>
                                    <span className="font-mono text-blue-300">{e.percentage}%</span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="work_hours" fill="#2563eb" radius={[0, 6, 6, 0]} maxBarSize={18} name="Work Hours" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )
                ) : (
                  // Employee View: Recharts Bar Chart of Tasks
                  data.by_task.length === 0 ? (
                    <p className="text-xs text-slate-400 italic py-8 text-center">No tasks recorded in this window.</p>
                  ) : (
                    <div className="h-64 w-full pt-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={data.by_task.slice(0, 6)}
                          margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                          <XAxis type="number" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${v}h`} />
                          <YAxis
                            type="category"
                            dataKey="task_name"
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            width={90}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload.length) return null;
                              const tk = payload[0].payload as TaskBreakdownItem;
                              return (
                                <div className="bg-slate-900 text-white p-2.5 rounded-xl shadow-xl text-xs space-y-1">
                                  <p className="font-bold text-indigo-300">{tk.task_name}</p>
                                  <p className="text-slate-300 text-[11px]">Project: {tk.project_name}</p>
                                  <div className="flex justify-between gap-3 pt-1 border-t border-slate-700">
                                    <span>Duration:</span>
                                    <span className="font-mono text-emerald-400 font-bold">{tk.work_duration_formatted}</span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="work_hours" fill="#10b981" radius={[0, 6, 6, 0]} maxBarSize={18} name="Hours" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{isAdmin ? 'Ranked by total recorded work hours' : 'Ranked by task duration'}</span>
                <span className="font-mono text-slate-700 font-semibold">
                  {isAdmin ? `Total Team: ${formatHumanReadableDuration(summary.total_work_seconds || 0)}` : `Tasks: ${summary.total_tasks}`}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
