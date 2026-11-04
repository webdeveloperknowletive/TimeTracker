import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Play, Pause, Square, CheckCircle2, MessageSquare, 
  History, Calendar, AlertTriangle, RefreshCw,
  Search, Check, X, ChevronDown, ChevronUp, Lock, RotateCcw
} from 'lucide-react';
import api from '../lib/api';
import { formatDigitalDuration, formatDisplayDate } from '../utils/formatters';

interface ProgressNote {
  note_id: string;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
}

interface WorkSessionItem {
  session_id: string;
  user_id: number;
  user_name: string;
  date: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number;
  status: string;
  work_segments: any[];
}

interface TaskItem {
  task_id: string;
  project_id: string;
  project_name: string;
  project_status: string;
  project_deadline: string | null;
  title: string;
  description: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  deadline: string | null;
  is_overdue: boolean;
  assigned_to: any;
  first_started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string;
  total_duration_seconds: number;
  today_duration_seconds?: number;
  time_worked_today?: string;
  active_session: {
    session_id: string;
    status: string;
    start_time: string;
    current_segment_start: string | null;
    elapsed_seconds: number;
  } | null;
  progress_notes: ProgressNote[];
  work_sessions: WorkSessionItem[];
  created_at: string;
  updated_at: string;
}

interface EmployeeProjectTasksProps {
  onTimerSync?: () => void;
}

export default function EmployeeProjectTasks({ onTimerSync }: EmployeeProjectTasksProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Local live tick for active timer
  const [tick, setTick] = useState<number>(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterProject, setFilterProject] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Expanded task history / notes
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskDetailTab, setTaskDetailTab] = useState<'sessions' | 'notes'>('sessions');

  // Note Modal
  const [showNoteModal, setShowNoteModal] = useState<boolean>(false);
  const [noteTargetTaskId, setNoteTargetTaskId] = useState<string>('');
  const [noteContent, setNoteContent] = useState<string>('');

  // Complete Confirmation Modal
  const [showCompleteConfirmModal, setShowCompleteConfirmModal] = useState<boolean>(false);
  const [completeTargetTaskId, setCompleteTargetTaskId] = useState<string>('');

  // Reopen Task Modal (Reason Required)
  const [showReopenTaskModal, setShowReopenTaskModal] = useState<boolean>(false);
  const [reopenTaskTargetId, setReopenTaskTargetId] = useState<string>('');
  const [reopenTaskReason, setReopenTaskReason] = useState<string>('');

  // Request sequencing to clear stale cached results and prevent previous responses from repopulating
  const reqSeqRef = useRef<number>(0);

  // Helper for current Asia/Kolkata date string (YYYY-MM-DD)
  const getIstTodayDateString = () => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  };

  const [activeDateStr, setActiveDateStr] = useState<string>(getIstTodayDateString());

  // Load employee tasks for today
  const loadMyTasks = async () => {
    const curSeq = ++reqSeqRef.current;
    setLoading(true);
    setErrorMsg('');
    try {
      const todayIst = getIstTodayDateString();
      const res = await api.get(`/tasks/my-tasks/?date=${todayIst}`);
      if (curSeq !== reqSeqRef.current) return; // Prevent race conditions & drop stale responses
      setTasks(res.data.tasks || []);
      setActiveDateStr(todayIst);
    } catch (err: any) {
      if (curSeq !== reqSeqRef.current) return;
      setErrorMsg(err.response?.data?.error || 'Failed to load assigned tasks.');
    } finally {
      if (curSeq === reqSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadMyTasks();
  }, []);

  // Periodic check for local date rollover (Asia/Kolkata midnight change) or window focus
  useEffect(() => {
    const checkDateChange = () => {
      const currentToday = getIstTodayDateString();
      if (currentToday !== activeDateStr) {
        setActiveDateStr(currentToday);
        loadMyTasks();
      }
    };

    const interval = setInterval(checkDateChange, 10000);
    window.addEventListener('focus', checkDateChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkDateChange);
    };
  }, [activeDateStr]);

  // Live timer interval: tick every second if any task is actively running
  useEffect(() => {
    const hasRunning = tasks.some((t) => t.active_session?.status === 'IN_PROGRESS');
    if (!hasRunning) return;

    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [tasks]);

  // Exact visibility rule on frontend: Show only tasks originally created today in Asia/Kolkata
  const isTaskCreatedTodayIst = (t: TaskItem, targetDate: string) => {
    if (!t.created_at) return false;
    try {
      const d = new Date(t.created_at);
      if (isNaN(d.getTime())) return false;
      const istStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
      return istStr === targetDate;
    } catch {
      return false;
    }
  };

  // Qualifying tasks: Deduplicated by stable ID, strictly created today (Asia/Kolkata)
  const qualifyingTasks = useMemo(() => {
    const seen = new Set<string>();
    const list: TaskItem[] = [];
    for (const t of tasks) {
      if (seen.has(t.task_id)) continue;
      seen.add(t.task_id);
      if (isTaskCreatedTodayIst(t, activeDateStr)) {
        list.push(t);
      }
    }
    return list;
  }, [tasks, activeDateStr]);

  // Distinct projects for filter dropdown: Only projects containing qualifying today's tasks
  const distinctProjects = useMemo(() => {
    const map = new Map<string, string>();
    qualifyingTasks.forEach((t) => {
      if (t.project_id && t.project_name) {
        map.set(t.project_id, t.project_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [qualifyingTasks]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return qualifyingTasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mTitle = t.title.toLowerCase().includes(q);
        const mDesc = (t.description || '').toLowerCase().includes(q);
        const mProj = t.project_name.toLowerCase().includes(q);
        if (!mTitle && !mDesc && !mProj) return false;
      }

      if (filterProject !== 'ALL' && t.project_id !== filterProject) {
        return false;
      }

      if (filterStatus !== 'ALL' && t.status !== filterStatus) {
        return false;
      }

      return true;
    });
  }, [qualifyingTasks, searchQuery, filterProject, filterStatus]);

  // Today Summary Counters
  const todayMetrics = useMemo(() => {
    let totalWorked = 0;
    let notStarted = 0;
    let inProgress = 0;
    let completed = 0;

    qualifyingTasks.forEach((t) => {
      if (t.status === 'COMPLETED') completed++;
      else if (t.status === 'IN_PROGRESS') inProgress++;
      else notStarted++;

      const isRunning = t.active_session?.status === 'IN_PROGRESS';
      const liveSegSec = isRunning && t.active_session?.current_segment_start
        ? Math.max(0, Math.floor((Date.now() - new Date(t.active_session.current_segment_start).getTime()) / 1000))
        : 0;
      totalWorked += (t.today_duration_seconds ?? 0) + liveSegSec;
    });

    return {
      total: qualifyingTasks.length,
      notStarted,
      inProgress,
      completed,
      totalWorkedSeconds: totalWorked
    };
  }, [qualifyingTasks, tick]);

  // Action: Start Work
  const handleStartWork = async (task: TaskItem) => {
    setActionLoading(task.task_id);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${task.task_id}/start/`);
      setSuccessMsg(`Started work on "${task.title}".`);
      await loadMyTasks();
      if (onTimerSync) onTimerSync();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to start task.');
    } finally {
      setActionLoading(null);
    }
  };

  // Action: Pause Work
  const handlePauseWork = async (task: TaskItem) => {
    setActionLoading(task.task_id);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${task.task_id}/pause/`);
      setSuccessMsg(`Paused timer for "${task.title}". Task remains In Progress.`);
      await loadMyTasks();
      if (onTimerSync) onTimerSync();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to pause task.');
    } finally {
      setActionLoading(null);
    }
  };

  // Action: Stop Work
  const handleStopWork = async (task: TaskItem) => {
    setActionLoading(task.task_id);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${task.task_id}/stop/`);
      setSuccessMsg(`Stopped timer session. Task remains In Progress.`);
      await loadMyTasks();
      if (onTimerSync) onTimerSync();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to stop timer.');
    } finally {
      setActionLoading(null);
    }
  };

  // Action: Add Progress Note
  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) {
      setErrorMsg('Note content cannot be empty.');
      return;
    }
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${noteTargetTaskId}/note/`, {
        content: noteContent.trim()
      });
      setSuccessMsg('Progress note added successfully.');
      setShowNoteModal(false);
      setNoteContent('');
      await loadMyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to add progress note.');
    }
  };

  // Action: Explicit Mark Completed
  const handleConfirmComplete = async () => {
    if (!completeTargetTaskId) return;
    setActionLoading(completeTargetTaskId);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${completeTargetTaskId}/complete/`);
      setSuccessMsg('Task marked as Completed! Great job!');
      setShowCompleteConfirmModal(false);
      await loadMyTasks();
      if (onTimerSync) onTimerSync();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to complete task.');
    } finally {
      setActionLoading(null);
    }
  };

  // Action: Reopen Task with Mandatory Reason
  const handleReopenTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTaskReason.trim()) {
      setErrorMsg('A mandatory reason is required to reopen this task.');
      return;
    }
    setActionLoading(reopenTaskTargetId);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${reopenTaskTargetId}/reopen/`, {
        reason: reopenTaskReason.trim()
      });
      setSuccessMsg('Task reopened successfully. You may now resume logging work.');
      setShowReopenTaskModal(false);
      setReopenTaskReason('');
      await loadMyTasks();
      if (onTimerSync) onTimerSync();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to reopen task.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="p-1 hover:bg-rose-100 rounded-md">
            <X size={14} />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="p-1 hover:bg-emerald-100 rounded-md">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header & Controls */}
      <div className="clay-card p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Calendar size={18} className="text-indigo-600" />
            <span>My Projects & Tasks</span>
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            Today's assigned tasks (created on {formatDisplayDate(activeDateStr)})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadMyTasks}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
            title="Refresh Tasks"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Today Task Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div 
          onClick={() => setFilterStatus('ALL')}
          className={`clay-card-flat p-3.5 space-y-1 cursor-pointer transition ${filterStatus === 'ALL' ? 'ring-2 ring-indigo-500/30' : ''}`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Tasks Today</span>
          <div className="text-xl sm:text-2xl font-black text-slate-900">{todayMetrics.total}</div>
          <span className="text-[11px] text-slate-400 font-medium">Created today</span>
        </div>
        <div 
          onClick={() => setFilterStatus('IN_PROGRESS')}
          className={`clay-card-flat p-3.5 space-y-1 cursor-pointer transition ${filterStatus === 'IN_PROGRESS' ? 'ring-2 ring-blue-500/30' : ''}`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">In Progress</span>
          <div className="text-xl sm:text-2xl font-black text-blue-600">{todayMetrics.inProgress}</div>
          <span className="text-[11px] text-slate-400 font-medium">Active / Paused</span>
        </div>
        <div 
          onClick={() => setFilterStatus('NOT_STARTED')}
          className={`clay-card-flat p-3.5 space-y-1 cursor-pointer transition ${filterStatus === 'NOT_STARTED' ? 'ring-2 ring-slate-500/30' : ''}`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Not Started</span>
          <div className="text-xl sm:text-2xl font-black text-slate-700">{todayMetrics.notStarted}</div>
          <span className="text-[11px] text-slate-400 font-medium">Pending today</span>
        </div>
        <div 
          onClick={() => setFilterStatus('COMPLETED')}
          className={`clay-card-flat p-3.5 space-y-1 cursor-pointer transition ${filterStatus === 'COMPLETED' ? 'ring-2 ring-emerald-500/30' : ''}`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Completed</span>
          <div className="text-xl sm:text-2xl font-black text-emerald-600">{todayMetrics.completed}</div>
          <span className="text-[11px] text-slate-400 font-medium">Finished today</span>
        </div>
        <div className="clay-card-flat p-3.5 space-y-1 col-span-2 sm:col-span-4 lg:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Time Worked Today</span>
          <div className="text-xl sm:text-2xl font-black font-mono text-indigo-700">
            {formatDigitalDuration(todayMetrics.totalWorkedSeconds)}
          </div>
          <span className="text-[11px] text-slate-400 font-medium">{formatDisplayDate(activeDateStr)} (IST)</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="clay-card-flat p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search my tasks or projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="clay-input has-icons-both w-full pl-11 pr-10 text-sm min-h-[44px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 p-1"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Project Filter */}
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="clay-input text-sm min-w-[150px]"
          >
            <option value="ALL">All Projects</option>
            {distinctProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="clay-input text-sm min-w-[150px]"
          >
            <option value="ALL">All Statuses</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="NOT_STARTED">Not Started</option>
            <option value="COMPLETED">Completed</option>
          </select>

          {(searchQuery || filterProject !== 'ALL' || filterStatus !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterProject('ALL');
                setFilterStatus('ALL');
              }}
              className="clay-btn clay-btn-secondary min-h-[44px] px-3.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Task Cards List */}
      <div className="space-y-4">
        {loading ? (
          <div className="clay-card p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <RefreshCw size={22} className="animate-spin text-indigo-600" />
            <p className="text-xs font-semibold">Loading assigned tasks...</p>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="clay-card p-12 text-center text-slate-500">
            <Calendar size={32} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-bold text-slate-700">No tasks recorded for {formatDisplayDate(activeDateStr)}</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchQuery || filterProject !== 'ALL' || filterStatus !== 'ALL'
                ? 'Try adjusting your search or filters.'
                : `Tasks created today in Asia/Kolkata (${formatDisplayDate(activeDateStr)}) will appear here.`}
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isExpanded = expandedTaskId === task.task_id;
            const isCompleted = task.status === 'COMPLETED';
            const isRunning = task.active_session?.status === 'IN_PROGRESS';
            const isPaused = task.active_session?.status === 'PAUSED';
            const liveSegSec = isRunning && task.active_session?.current_segment_start
              ? Math.max(0, Math.floor((Date.now() - new Date(task.active_session.current_segment_start).getTime()) / 1000)) + (tick * 0)
              : 0;
            const liveTodaySeconds = (task.today_duration_seconds ?? 0) + liveSegSec;

            return (
              <div
                key={task.task_id}
                className={`clay-card transition border ${
                  isRunning
                    ? 'ring-2 ring-blue-500/30 border-blue-200'
                    : isCompleted
                    ? 'bg-slate-50/50 border-slate-200'
                    : 'border-slate-200/80'
                }`}
              >
                <div className="p-5 space-y-4">
                  {/* Task Header: Project & Title */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {task.project_name}
                        </span>
                        <h4 className="text-base font-extrabold text-slate-900 tracking-tight truncate">
                          {task.title}
                        </h4>

                        {/* Status Badge */}
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check size={12} className="text-emerald-600" />
                            Completed
                          </span>
                        ) : isRunning ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
                            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                            Timer Running
                          </span>
                        ) : isPaused ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Pause size={11} className="text-amber-600" />
                            Timer Paused
                          </span>
                        ) : task.status === 'IN_PROGRESS' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            In Progress
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            Not Started
                          </span>
                        )}

                        {task.is_overdue && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertTriangle size={11} /> Overdue
                          </span>
                        )}
                      </div>

                      {task.description && (
                        <p className="text-xs text-slate-600 line-clamp-2 max-w-2xl">
                          {task.description}
                        </p>
                      )}
                    </div>

                    {/* Time Worked Today Live Counter */}
                    <div className="sm:text-right shrink-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Time Worked Today
                      </span>
                      <span
                        className={`text-lg sm:text-xl font-mono font-black ${
                          isRunning ? 'text-blue-600' : 'text-slate-800'
                        }`}
                      >
                        {formatDigitalDuration(liveTodaySeconds)}
                      </span>
                      {task.total_duration_seconds > (task.today_duration_seconds ?? 0) && (
                        <span className="text-[10px] text-slate-400 font-mono block">
                          Lifetime: {formatDigitalDuration(task.total_duration_seconds + liveSegSec)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Task Meta: Deadline, History counts */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 flex-wrap gap-2">
                    <div className="flex items-center gap-4 flex-wrap">
                      {task.deadline ? (
                        <span className="flex items-center gap-1 font-medium">
                          <Calendar size={13} className={task.is_overdue ? 'text-rose-600' : 'text-slate-400'} />
                          Due: {formatDisplayDate(task.deadline)}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">No deadline set</span>
                      )}

                      {task.completed_at && (
                        <span className="flex items-center gap-1 font-medium text-emerald-700">
                          <CheckCircle2 size={13} />
                          Completed on: {formatDisplayDate(task.completed_at)}
                        </span>
                      )}

                      {task.reopened_at && (
                        <span className="text-amber-700 font-medium">
                          Reopened: "{task.reopen_reason}"
                        </span>
                      )}
                    </div>

                    {/* Actions Toolbar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Timer controls */}
                      {isCompleted ? (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-semibold">
                            <Lock size={13} />
                            <span>Completed</span>
                          </div>
                          <button
                            onClick={() => {
                              setReopenTaskTargetId(task.task_id);
                              setReopenTaskReason('');
                              setShowReopenTaskModal(true);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs flex items-center gap-1.5 transition"
                          >
                            <RotateCcw size={13} />
                            <span>Reopen Task</span>
                          </button>
                        </div>
                      ) : (
                        <>
                          {isRunning ? (
                            <>
                              <button
                                onClick={() => handlePauseWork(task)}
                                disabled={actionLoading === task.task_id}
                                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                              >
                                <Pause size={13} />
                                <span>Pause</span>
                              </button>
                              <button
                                onClick={() => handleStopWork(task)}
                                disabled={actionLoading === task.task_id}
                                className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                              >
                                <Square size={13} />
                                <span>Stop</span>
                              </button>
                            </>
                          ) : isPaused ? (
                            <>
                              <button
                                onClick={() => handleStartWork(task)}
                                disabled={actionLoading === task.task_id}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                              >
                                <Play size={13} />
                                <span>Resume</span>
                              </button>
                              <button
                                onClick={() => handleStopWork(task)}
                                disabled={actionLoading === task.task_id}
                                className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                              >
                                <Square size={13} />
                                <span>Stop</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleStartWork(task)}
                              disabled={actionLoading === task.task_id}
                              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                            >
                              <Play size={13} />
                              <span>{task.status === 'NOT_STARTED' ? 'Start Work' : 'Resume Work'}</span>
                            </button>
                          )}

                          {/* Progress Note Button */}
                          <button
                            onClick={() => {
                              setNoteTargetTaskId(task.task_id);
                              setNoteContent('');
                              setShowNoteModal(true);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition"
                          >
                            <MessageSquare size={13} />
                            <span>Add Note</span>
                          </button>

                          {/* Explicit Mark Completed Button */}
                          <button
                            onClick={() => {
                              setCompleteTargetTaskId(task.task_id);
                              setShowCompleteConfirmModal(true);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs flex items-center gap-1.5 transition"
                          >
                            <CheckCircle2 size={13} className="text-emerald-600" />
                            <span>Mark Completed</span>
                          </button>
                        </>
                      )}

                      {/* Expand History / Notes */}
                      <button
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.task_id)}
                        className={`p-1.5 rounded-xl border transition ${
                          isExpanded ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-slate-200 hover:bg-slate-50 text-slate-500'
                        }`}
                        title={isExpanded ? 'Hide History' : 'View History & Notes'}
                      >
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Drawer: Work Sessions & Notes */}
                {isExpanded && (
                  <div className="border-t border-slate-200/90 bg-slate-50/70 p-4 sm:p-5 space-y-4 rounded-b-2xl">
                    <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                      <button
                        onClick={() => setTaskDetailTab('sessions')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          taskDetailTab === 'sessions'
                            ? 'bg-white text-indigo-700 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <History size={13} />
                        <span>Today's Work Sessions ({task.work_sessions?.length || 0})</span>
                      </button>
                      <button
                        onClick={() => setTaskDetailTab('notes')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          taskDetailTab === 'notes'
                            ? 'bg-white text-indigo-700 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <MessageSquare size={13} />
                        <span>Progress Notes ({task.progress_notes?.length || 0})</span>
                      </button>
                    </div>

                    {taskDetailTab === 'sessions' ? (
                      <div className="space-y-2">
                        {task.work_sessions?.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">No work sessions logged today.</p>
                        ) : (
                          task.work_sessions?.map((session) => (
                            <div
                              key={session.session_id}
                              className="p-2.5 rounded-lg bg-white border border-slate-200/80 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                            >
                              <div>
                                <span className="font-bold text-slate-800 mr-2">{formatDisplayDate(session.date || session.start_time)}</span>
                                <span className="text-slate-500">
                                  {session.start_time ? new Date(session.start_time).toLocaleTimeString() : '--'}
                                  {' → '}
                                  {session.end_time ? new Date(session.end_time).toLocaleTimeString() : 'Current Session'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 font-mono text-slate-700">
                                <span className="font-bold">{formatDigitalDuration(session.duration_seconds)}</span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] uppercase font-bold text-slate-500">
                                  {session.status}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {task.progress_notes?.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">No progress notes recorded yet.</p>
                        ) : (
                          task.progress_notes?.map((n) => (
                            <div key={n.note_id} className="p-3 rounded-lg bg-white border border-slate-200/80 text-xs space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span className="font-bold text-slate-800">{n.author_name}</span>
                                <span>{new Date(n.created_at).toLocaleString()}</span>
                              </div>
                              <p className="text-slate-700 font-medium whitespace-pre-wrap">{n.content}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* MODAL 1: ADD PROGRESS NOTE */}
      {showNoteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <MessageSquare size={16} className="text-indigo-600" />
                Add Progress Note
              </h3>
              <button onClick={() => setShowNoteModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddNoteSubmit} className="space-y-4">
              <p className="text-xs text-slate-600">
                Explain work done, key achievements, or remaining items for transparency.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Progress Description *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="e.g. Completed initial API integration; remaining tasks include end-to-end testing and edge case verification..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-sm hover:bg-indigo-700 transition"
                >
                  Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CONFIRM TASK COMPLETION */}
      {showCompleteConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-600" />
                Confirm Task Completion
              </h3>
              <button onClick={() => setShowCompleteConfirmModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to mark this task as <strong>Completed</strong>?
              <br /><br />
              Any active work session will be closed automatically, and your explicit completion timestamp will be recorded.
              Additional time tracking will be locked unless reopened with a valid reason.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCompleteConfirmModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmComplete}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm hover:bg-emerald-700 transition"
              >
                Yes, Mark Completed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: REOPEN TASK (REASON REQUIRED) */}
      {showReopenTaskModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <RotateCcw size={16} className="text-amber-600" />
                Reopen Task
              </h3>
              <button onClick={() => setShowReopenTaskModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleReopenTaskSubmit} className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Reopening this task will reset its status to <strong>In Progress</strong> and allow you to resume logging work.
                A mandatory reason is required to retain status-change history.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Reason for Reopening *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Additional revisions or bug fixes required..."
                  value={reopenTaskReason}
                  onChange={(e) => setReopenTaskReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReopenTaskModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold shadow-sm hover:bg-amber-700 transition"
                >
                  Confirm Reopen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
