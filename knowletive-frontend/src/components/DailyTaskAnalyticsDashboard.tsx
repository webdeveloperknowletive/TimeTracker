import { useState, useMemo } from 'react';
import {
  Clock,
  ListTodo,
  Activity,
  Users,
  FolderKanban,
  Sparkles,
  TrendingUp,
  BarChart3,
  PieChart,
  CheckCircle2,
  RotateCcw,
  Calendar
} from 'lucide-react';

export interface TaskRecord {
  sr_no: number;
  task_log_id: string;
  user_id: number;
  employee_id: string;
  employee_name: string;
  email: string;
  department: string;
  project_name: string;
  task_name: string;
  description: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  duration_hours: number;
  duration_formatted: string;
  status: string;
}

export interface EmployeeSummary {
  user_id: number;
  employee_id: string;
  employee_name: string;
  email: string;
  department: string;
  total_seconds: number;
  total_hours: number;
  duration_formatted: string;
  tasks_count: number;
}

export interface ProjectEmployeeSummary {
  project_name: string;
  employee_name: string;
  total_seconds: number;
  total_hours: number;
  duration_formatted: string;
  tasks_count: number;
}

export interface TaskReportData {
  date: string;
  tasks: TaskRecord[];
  by_employee: EmployeeSummary[];
  by_project_and_employee: ProjectEmployeeSummary[];
  summary: {
    total_tasks: number;
    active_in_progress: number;
    completed: number;
    total_seconds: number;
    total_hours: number;
  };
}

interface Props {
  data: TaskReportData;
  filterDate: string;
  filterEmpId: string;
  filterProject: string;
  onClearFilters: () => void;
  onSetToday: () => void;
  isLoading?: boolean;
}

// Consistent palette for projects and categories
const PALETTE = [
  { stroke: '#2563eb', fill: 'bg-blue-600', text: 'text-blue-600', light: 'bg-blue-50 border-blue-200' },
  { stroke: '#0d9488', fill: 'bg-teal-600', text: 'text-teal-600', light: 'bg-teal-50 border-teal-200' },
  { stroke: '#0284c7', fill: 'bg-sky-500', text: 'text-sky-600', light: 'bg-sky-50 border-sky-200' },
  { stroke: '#10b981', fill: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50 border-emerald-200' },
  { stroke: '#f59e0b', fill: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50 border-amber-200' },
  { stroke: '#14b8a6', fill: 'bg-teal-500', text: 'text-teal-600', light: 'bg-teal-50 border-teal-200' },
  { stroke: '#3b82f6', fill: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50 border-blue-200' },
  { stroke: '#64748b', fill: 'bg-slate-500', text: 'text-slate-600', light: 'bg-slate-50 border-slate-200' },
];

import { formatHumanReadableDuration } from '../utils/formatters';

function parseHourFromTimeString(timeStr: string): number | null {
  if (!timeStr || timeStr === '-' || timeStr.toLowerCase().includes('progress')) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return hour;
}

export default function DailyTaskAnalyticsDashboard({
  data,
  filterDate,
  filterEmpId,
  filterProject,
  onClearFilters,
  onSetToday,
  isLoading
}: Props) {
  const [activeProjectHover, setActiveProjectHover] = useState<string | null>(null);
  const [activeHourHover, setActiveHourHover] = useState<number | null>(null);

  // 1. Core Summary Metrics
  const summary = useMemo(() => {
    const totalTasks = data.summary?.total_tasks ?? data.tasks?.length ?? 0;
    const completed = data.summary?.completed ?? data.tasks?.filter(t => t.status !== 'IN_PROGRESS').length ?? 0;
    const inProgress = data.summary?.active_in_progress ?? data.tasks?.filter(t => t.status === 'IN_PROGRESS').length ?? 0;
    const totalSeconds = data.summary?.total_seconds ?? (data.tasks || []).reduce((acc, t) => acc + (t.duration_seconds || 0), 0);
    const totalHours = data.summary?.total_hours ?? Number((totalSeconds / 3600).toFixed(2));
    const completionRate = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;
    const avgTaskMinutes = totalTasks > 0 ? Math.round((totalSeconds / 60) / totalTasks) : 0;
    const employeeCount = data.by_employee?.length ?? 0;

    // Distinct projects
    const uniqueProjects = new Set<string>();
    (data.tasks || []).forEach(t => {
      if (t.project_name) uniqueProjects.add(t.project_name);
    });
    const projectCount = uniqueProjects.size;

    return {
      totalTasks,
      completed,
      inProgress,
      totalSeconds,
      totalHours,
      completionRate,
      avgTaskMinutes,
      employeeCount,
      projectCount
    };
  }, [data]);

  // 2. Project Aggregates & Proportions
  const projectStats = useMemo(() => {
    const map = new Map<string, {
      name: string;
      totalSeconds: number;
      tasksCount: number;
      employees: Set<string>;
    }>();

    (data.tasks || []).forEach(t => {
      const pName = t.project_name || 'Unassigned Project';
      const entry = map.get(pName) || {
        name: pName,
        totalSeconds: 0,
        tasksCount: 0,
        employees: new Set<string>()
      };
      entry.totalSeconds += (t.duration_seconds || 0);
      entry.tasksCount += 1;
      if (t.employee_name) entry.employees.add(t.employee_name);
      map.set(pName, entry);
    });

    const list = Array.from(map.values()).map((p, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      const hours = Number((p.totalSeconds / 3600).toFixed(2));
      const percentage = summary.totalSeconds > 0
        ? Number(((p.totalSeconds / summary.totalSeconds) * 100).toFixed(1))
        : (summary.projectCount > 0 ? Number((100 / summary.projectCount).toFixed(1)) : 0);

      return {
        ...p,
        totalHours: hours,
        percentage,
        formattedDuration: formatHumanReadableDuration(p.totalSeconds),
        color
      };
    });

    // Sort descending by time spent, then task count
    list.sort((a, b) => b.totalSeconds - a.totalSeconds || b.tasksCount - a.tasksCount);
    return list;
  }, [data.tasks, summary.totalSeconds, summary.projectCount]);

  // Top project
  const topProject = projectStats[0] || null;

  // 3. Employee Workload Ranking
  const employeeStats = useMemo(() => {
    const list = [...(data.by_employee || [])];
    const maxSec = Math.max(...list.map(e => e.total_seconds), 1);

    return list.map((e, idx) => {
      const percentageOfMax = Math.round((e.total_seconds / maxSec) * 100);
      const percentageOfTotal = summary.totalSeconds > 0
        ? Math.round((e.total_seconds / summary.totalSeconds) * 100)
        : 0;
      const color = PALETTE[idx % PALETTE.length];

      return {
        ...e,
        percentageOfMax,
        percentageOfTotal,
        color
      };
    });
  }, [data.by_employee, summary.totalSeconds]);

  // Top contributor
  const topEmployee = employeeStats[0] || null;

  // 4. Hourly Workday Distribution (from 9 AM to 7 PM IST or dynamic range)
  const hourlyActivity = useMemo(() => {
    // Check if any task starts outside 9-19
    const taskHours: number[] = [];
    (data.tasks || []).forEach(t => {
      const h = parseHourFromTimeString(t.start_time);
      if (h !== null) taskHours.push(h);
    });

    const minHour = taskHours.length > 0 ? Math.min(9, ...taskHours) : 9;
    const maxHour = taskHours.length > 0 ? Math.max(19, ...taskHours) : 19;

    const fullHours: number[] = [];
    for (let h = minHour; h <= maxHour; h++) {
      fullHours.push(h);
    }

    let maxTasksInAnyHour = 1;
    let maxMinutesInAnyHour = 1;

    const buckets = fullHours.map(hour => {
      const matchingTasks = (data.tasks || []).filter(t => {
        const h = parseHourFromTimeString(t.start_time);
        return h === hour;
      });

      const totalSec = matchingTasks.reduce((acc, t) => acc + (t.duration_seconds || 0), 0);
      const totalMin = Math.round(totalSec / 60);

      if (matchingTasks.length > maxTasksInAnyHour) maxTasksInAnyHour = matchingTasks.length;
      if (totalMin > maxMinutesInAnyHour) maxMinutesInAnyHour = totalMin;

      // Label (e.g. 10 AM, 1 PM)
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const label = `${String(displayHour).padStart(2, '0')} ${period}`;

      return {
        hour,
        label,
        count: matchingTasks.length,
        totalMinutes: totalMin,
        tasks: matchingTasks
      };
    });

    // Find peak hour
    let peak = buckets[0];
    buckets.forEach(b => {
      if (b.count > peak.count || (b.count === peak.count && b.totalMinutes > peak.totalMinutes)) {
        peak = b;
      }
    });

    return {
      buckets,
      maxTasksInAnyHour,
      maxMinutesInAnyHour,
      peakHour: peak && peak.count > 0 ? peak : null
    };
  }, [data.tasks]);

  // SVG Donut calculation constants
  const donutRadius = 70;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * donutRadius;

  // Has active filter applied?
  const hasFilterApplied = Boolean(filterEmpId || filterProject);

  // Format date readable
  const formattedDisplayDate = useMemo(() => {
    if (!filterDate) return 'Today';
    try {
      const parts = filterDate.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    } catch {
      // fallback
    }
    return filterDate;
  }, [filterDate]);

  // If no tasks match current filters
  if (!isLoading && summary.totalTasks === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center shadow-xs">
        <div className="w-16 h-16 mx-auto mb-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 shadow-inner">
          <Calendar size={32} />
        </div>
        <h4 className="text-lg font-bold text-slate-800">No Task Records Found</h4>
        <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1.5 leading-relaxed">
          There are no recorded task sessions matching the selected date (<span className="font-semibold text-slate-700">{formattedDisplayDate}</span>)
          {filterProject ? <span> and project filter "<span className="font-semibold text-indigo-600">{filterProject}</span>"</span> : ''}
          {filterEmpId ? <span> for the selected employee</span> : ''}.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
          {hasFilterApplied && (
            <button
              onClick={onClearFilters}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition"
            >
              <RotateCcw size={14} />
              <span>Clear Employee & Project Filters</span>
            </button>
          )}
          <button
            onClick={onSetToday}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition"
          >
            <Calendar size={14} />
            <span>Switch to Today</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Real-Time Analysis Highlight Banner */}
      <div className="bg-gradient-to-r from-blue-50/90 via-teal-50/60 to-white border border-blue-100 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-700">Real-Time Analysis</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100/80 text-blue-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Verified
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-700 mt-0.5">
              <span className="font-semibold text-slate-900">{summary.employeeCount} team member{summary.employeeCount !== 1 ? 's' : ''}</span> logged{' '}
              <span className="font-semibold text-slate-900">{summary.totalTasks} task{summary.totalTasks !== 1 ? 's' : ''}</span> across{' '}
              <span className="font-semibold text-slate-900">{summary.projectCount} project{summary.projectCount !== 1 ? 's' : ''}</span> on{' '}
              <span className="font-semibold text-blue-900">{formattedDisplayDate}</span> totaling{' '}
              <span className="font-semibold text-blue-900">{formatHumanReadableDuration(summary.totalSeconds)}</span>.
              {topProject && (
                <span className="hidden sm:inline">
                  {' '}Primary allocation was on <strong className="text-slate-900 font-semibold">{topProject.name}</strong> ({topProject.formattedDuration}, {topProject.percentage}%).
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Quick filter summary badge & clear option */}
        <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
          {hasFilterApplied && (
            <button
              onClick={onClearFilters}
              title="Clear active filters"
              className="px-3 py-1.5 text-[11px] font-semibold bg-white hover:bg-slate-50 text-blue-600 border border-blue-200 rounded-lg flex items-center gap-1.5 shadow-2xs transition"
            >
              <RotateCcw size={12} />
              <span>Reset Filters</span>
            </button>
          )}
          <div className="px-3 py-1.5 bg-white/90 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-600">
            {summary.completionRate}% Done
          </div>
        </div>
      </div>

      {/* 2. Key Metrics Grid (Totals & Useful Comparisons) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {/* Metric 1: Total Tracked Time */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden group hover:border-blue-300 transition">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Tracked Time</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock size={15} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 font-mono tracking-tight">
            <span className="font-black text-slate-900">{formatHumanReadableDuration(summary.totalSeconds)}</span>
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600">
            <span className="font-semibold text-blue-600">Productive Time</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-500">~{summary.avgTaskMinutes}m / task</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600" />
        </div>

        {/* Metric 2: Employee Tasks */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden group hover:border-blue-300 transition">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee Tasks</span>
            <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <ListTodo size={15} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 tracking-tight">
            {summary.totalTasks}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px]">
            <span className="text-emerald-700 font-semibold">{summary.completed} Completed</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-500">{summary.completionRate}% Rate</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-teal-500" />
        </div>

        {/* Metric 3: In Progress */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden group hover:border-amber-300 transition">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">In Progress</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Activity size={15} />
            </div>
          </div>
          <p className="text-2xl font-black text-amber-600 tracking-tight">
            {summary.inProgress}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
            {summary.inProgress > 0 ? (
              <span className="text-amber-700 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                Live Running Task
              </span>
            ) : (
              <span className="text-slate-500 flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-500" />
                All Sessions Closed
              </span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500" />
        </div>

        {/* Metric 4: Team Contributors */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden group hover:border-blue-300 transition">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Active Team</span>
            <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
              <Users size={15} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 tracking-tight">
            {summary.employeeCount} <span className="text-sm font-semibold text-slate-500">logged</span>
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500 truncate">
            {topEmployee ? (
              <span className="truncate">Top: <strong className="text-slate-800 font-semibold">{topEmployee.employee_name}</strong></span>
            ) : (
              <span>0 Contributors</span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-sky-500" />
        </div>

        {/* Metric 5: Active Projects */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden group hover:border-violet-300 transition col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Active Projects</span>
            <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
              <FolderKanban size={15} />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 tracking-tight">
            {summary.projectCount} <span className="text-sm font-semibold text-slate-500">projects</span>
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500 truncate">
            {topProject ? (
              <span className="truncate">Lead: <strong className="text-slate-800 font-semibold">{topProject.name}</strong></span>
            ) : (
              <span>No projects</span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-violet-500" />
        </div>
      </div>

      {/* 3. Visual Charts Grid: Project Allocation & Employee Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CHART 1: Project Time Distribution (Donut & Ranked Allocation) - 6 cols */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <PieChart size={16} className="text-blue-600" />
                  <span>Project Time Distribution</span>
                </h4>
                <p className="text-xs text-slate-500">Work duration and percentage share by project</p>
              </div>
              <span className="px-2.5 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[11px] font-mono font-bold text-blue-700">
                {summary.projectCount} Project{summary.projectCount !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Donut Chart and Interactive Segment Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-2">
              {/* Donut Chart Visual */}
              <div className="sm:col-span-5 flex flex-col items-center justify-center relative py-2">
                <svg className="w-44 h-44 -rotate-90 transform" viewBox="0 0 200 200">
                  {/* Background Track */}
                  <circle
                    cx="100"
                    cy="100"
                    r={donutRadius}
                    fill="transparent"
                    stroke="#f1f5f9"
                    strokeWidth={strokeWidth}
                  />

                  {/* SVG Segments */}
                  {(() => {
                    let accumulatedPercent = 0;
                    return projectStats.map((p) => {
                      // Proportional dash
                      const dashLength = (p.percentage / 100) * circumference;
                      const offset = -((accumulatedPercent / 100) * circumference);
                      accumulatedPercent += p.percentage;

                      const isHovered = activeProjectHover === p.name;

                      return (
                        <circle
                          key={p.name}
                          cx="100"
                          cy="100"
                          r={donutRadius}
                          fill="transparent"
                          stroke={p.color.stroke}
                          strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                          strokeDasharray={`${dashLength} ${circumference}`}
                          strokeDashoffset={offset}
                          className="transition-all duration-300 cursor-pointer"
                          onMouseEnter={() => setActiveProjectHover(p.name)}
                          onMouseLeave={() => setActiveProjectHover(null)}
                        />
                      );
                    });
                  })()}
                </svg>

                {/* Center Callout inside Donut */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                  {activeProjectHover ? (
                    (() => {
                      const hovered = projectStats.find(p => p.name === activeProjectHover);
                      return hovered ? (
                        <div className="px-2 animate-fade-in">
                          <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500 truncate max-w-[100px]">
                            {hovered.name}
                          </p>
                          <p className="text-base font-black text-slate-900 font-mono">
                            {hovered.percentage}%
                          </p>
                          <p className="text-[10px] text-slate-600 font-semibold">
                            {hovered.formattedDuration}
                          </p>
                        </div>
                      ) : null;
                    })()
                  ) : (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total Tracked</p>
                      <p className="text-lg font-black text-slate-900 font-mono tracking-tight">
                        {formatHumanReadableDuration(summary.totalSeconds)}
                      </p>
                      <p className="text-[10px] text-slate-500 font-semibold">
                        Overall Focus
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Project Legend / Breakdown List with Progress Bars */}
              <div className="sm:col-span-7 space-y-2.5">
                {projectStats.map((p) => {
                  const isHovered = activeProjectHover === p.name;
                  return (
                    <div
                      key={p.name}
                      onMouseEnter={() => setActiveProjectHover(p.name)}
                      onMouseLeave={() => setActiveProjectHover(null)}
                      className={`p-2.5 rounded-xl border transition cursor-default ${
                        isHovered
                          ? 'bg-slate-50 border-blue-300 shadow-2xs'
                          : 'bg-white border-slate-150 hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-2 truncate pr-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: p.color.stroke }}
                          />
                          <span className="font-semibold text-slate-900 truncate" title={p.name}>
                            {p.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono">
                          <span className="font-bold text-slate-900">{p.formattedDuration}</span>
                          <span className="text-slate-400 text-[11px]">({p.percentage}%)</span>
                        </div>
                      </div>

                      {/* Bar Fill */}
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max(p.percentage, 2)}%`,
                            backgroundColor: p.color.stroke
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                        <span>{p.tasksCount} task{p.tasksCount !== 1 ? 's' : ''}</span>
                        <span>{p.employees.size} contributor{p.employees.size !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Hover slices or projects for exact contribution breakdown</span>
            <span className="font-mono text-slate-700 font-semibold">{summary.projectCount} Projects Recorded</span>
          </div>
        </div>

        {/* CHART 2: Employee Workload & Contribution (Comparative Bar Chart) - 6 cols */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 size={16} className="text-teal-600" />
                  <span>Employee Workload & Contribution</span>
                </h4>
                <p className="text-xs text-slate-500">Time logged and task throughput per team member</p>
              </div>
              <span className="px-2.5 py-1 bg-teal-50 border border-teal-100 rounded-lg text-[11px] font-mono font-bold text-teal-700">
                {summary.employeeCount} Member{summary.employeeCount !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="space-y-3.5 pt-1">
              {employeeStats.map((emp) => (
                <div
                  key={emp.user_id}
                  className="p-3 bg-slate-50/70 border border-slate-200/90 rounded-xl hover:border-blue-300 hover:bg-slate-50 transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-xs">
                          {emp.employee_name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200">
                          {emp.employee_id || '-'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {emp.department || 'General'}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-mono text-xs font-bold text-slate-900">
                        {emp.duration_formatted}
                      </p>
                      <p className="text-[11px] font-mono text-blue-600 font-semibold">
                        {formatHumanReadableDuration(emp.total_seconds)} ({emp.percentageOfTotal}% share)
                      </p>
                    </div>
                  </div>

                  {/* Visual Bar relative to maximum employee */}
                  <div className="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-blue-600 to-teal-500"
                      style={{ width: `${Math.max(emp.percentageOfMax, 3)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
                    <span className="font-mono text-slate-700">
                      {emp.tasks_count} task{emp.tasks_count !== 1 ? 's' : ''} logged
                    </span>
                    <span className="text-emerald-700 font-semibold">
                      {(emp.total_seconds / 3600).toFixed(2)}h recorded
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Bars scaled relative to the highest logged team member</span>
            <span className="font-mono text-slate-700 font-semibold">Total: {formatHumanReadableDuration(summary.totalSeconds)}</span>
          </div>
        </div>
      </div>

      {/* 4. CHART 3: Hourly Activity Timeline Distribution (Workday Productivity Trend) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp size={16} className="text-blue-600" />
              <span>Workday Hourly Activity Timeline</span>
            </h4>
            <p className="text-xs text-slate-500">
              When tasks were initiated and active throughout the day (IST)
            </p>
          </div>

          {hourlyActivity.peakHour && (
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold self-start sm:self-auto">
              <span>🔥 Peak Hour:</span>
              <span className="font-mono font-bold">{hourlyActivity.peakHour.label}</span>
              <span className="text-[11px] text-amber-700">
                ({hourlyActivity.peakHour.count} task{hourlyActivity.peakHour.count !== 1 ? 's' : ''}, {hourlyActivity.peakHour.totalMinutes}m)
              </span>
            </div>
          )}
        </div>

        {/* Hourly Histogram / Bar Graph */}
        <div className="pt-4 pb-2">
          <div className="grid grid-cols-11 gap-1.5 sm:gap-2.5 items-end h-40 px-2 border-b border-slate-200 pb-2">
            {hourlyActivity.buckets.map((b) => {
              const isPeak = hourlyActivity.peakHour?.hour === b.hour;
              const hasActivity = b.count > 0;
              const isHovered = activeHourHover === b.hour;

              // Height proportion based on max tasks or max minutes
              const heightPercent = hasActivity
                ? Math.max(18, Math.round((b.count / hourlyActivity.maxTasksInAnyHour) * 100))
                : 4;

              return (
                <div
                  key={b.hour}
                  className="flex flex-col items-center h-full justify-end relative group cursor-pointer"
                  onMouseEnter={() => setActiveHourHover(b.hour)}
                  onMouseLeave={() => setActiveHourHover(null)}
                >
                  {/* Tooltip on Hover */}
                  {isHovered && hasActivity && (
                    <div className="absolute bottom-full mb-2 z-20 w-48 p-2.5 bg-slate-900 text-white rounded-xl text-xs shadow-xl pointer-events-none transform -translate-x-1/2 left-1/2">
                      <p className="font-bold text-[11px] text-blue-300 mb-1">
                        {b.label} (IST)
                      </p>
                      <p className="text-slate-200 font-semibold mb-1">
                        {b.count} Task{b.count !== 1 ? 's' : ''} started • {b.totalMinutes} mins
                      </p>
                      <div className="border-t border-slate-700/80 pt-1 space-y-1">
                        {b.tasks.map((t, idx) => (
                          <div key={idx} className="text-[10px] text-slate-300 truncate">
                            <span className="text-teal-400 font-medium">[{t.project_name}]</span> {t.task_name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Value Badge on top of active bar */}
                  {hasActivity && (
                    <span className={`text-[10px] font-mono font-bold mb-1 transition ${
                      isPeak ? 'text-amber-600' : 'text-blue-600'
                    }`}>
                      {b.count}
                    </span>
                  )}

                  {/* Bar Element */}
                  <div
                    className={`w-full max-w-[34px] rounded-t-lg transition-all duration-300 ${
                      !hasActivity
                        ? 'bg-slate-100 hover:bg-slate-200'
                        : isPeak
                        ? 'bg-gradient-to-t from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 shadow-xs'
                        : 'bg-gradient-to-t from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 shadow-xs'
                    } ${isHovered ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>
              );
            })}
          </div>

          {/* Hour Labels below the axis */}
          <div className="grid grid-cols-11 gap-1.5 sm:gap-2.5 px-2 pt-2 text-center">
            {hourlyActivity.buckets.map((b) => (
              <div key={b.hour} className="text-[10px] sm:text-[11px] font-mono text-slate-500 truncate">
                {b.label}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-blue-600" />
              <span>Standard Activity Hours</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-amber-500" />
              <span>Peak Productivity Window</span>
            </span>
          </div>
          <span className="font-mono text-slate-600">Timezone: Asia/Kolkata (IST)</span>
        </div>
      </div>
    </div>
  );
}
