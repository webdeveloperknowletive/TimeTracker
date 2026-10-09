import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Play, Pause, LogOut, CheckCircle, Bell,
  Calendar, Info, AlertTriangle, ShieldCheck,
  Plus, Edit2, Check, ArrowRight,
  Clock, Shield, X, TrendingUp, Coffee,
  CheckCircle2, Briefcase, ListTodo
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import DailyTaskAnalyticsDashboard from '../components/DailyTaskAnalyticsDashboard';

import { formatDigitalDuration } from '../utils/formatters';

function formatReadableTime(isoStr: string | null): string {
  if (!isoStr) return '--:--';
  try {
    return format(parseISO(isoStr), 'hh:mm a');
  } catch {
    return isoStr;
  }
}

function getTodayIsoDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function Tracker() {
  const [status, setStatus] = useState<string>('Not Started');
  const [, setEvents] = useState<any[]>([]);
  const [serverTotalWork, setServerTotalWork] = useState<number>(0);
  const [serverTotalBreak, setServerTotalBreak] = useState<number>(0);
  const [serverTotalWorkBase, setServerTotalWorkBase] = useState<number>(0);
  const [serverTotalBreakBase, setServerTotalBreakBase] = useState<number>(0);
  const [currentSegmentStart, setCurrentSegmentStart] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [officeSettings, setOfficeSettings] = useState<any>({ work_start_time: '10:00', work_end_time: '19:00' });
  
  // Real-time mutually exclusive timers (calculated from timestamps)
  const [elapsedWork, setElapsedWork] = useState<number>(0);
  const [elapsedBreak, setElapsedBreak] = useState<number>(0);
  const [elapsedTotalDay, setElapsedTotalDay] = useState<number>(0);
  const [loadingAction, setLoadingAction] = useState<boolean>(false);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [reminderDismissed, setReminderDismissed] = useState<boolean>(false);
  const [notificationEnabled, setNotificationEnabled] = useState<boolean>(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );

  // Time-wise Task Logging State
  const [selectedTaskDate, setSelectedTaskDate] = useState<string>(getTodayIsoDate());
  const [dailyTasks, setDailyTasks] = useState<any[]>([]);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [activeTaskElapsed, setActiveTaskElapsed] = useState<number>(0);
  const [totalTaskFormatted, setTotalTaskFormatted] = useState<string>('0 sec');
  const [projectBreakdown, setProjectBreakdown] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState<boolean>(false);
  const [workViewMode, setWorkViewMode] = useState<'tasks' | 'analytics'>('tasks');
  const [taskFilterProject, setTaskFilterProject] = useState<string>('');
  const [taskReportData, setTaskReportData] = useState<any>({
    date: getTodayIsoDate(),
    tasks: [],
    by_employee: [],
    by_project_and_employee: [],
    summary: { total_tasks: 0, active_in_progress: 0, completed: 0, total_seconds: 0, total_hours: 0 }
  });

  // Modals for Task Management
  const [showStartWorkdayPrompt, setShowStartWorkdayPrompt] = useState<boolean>(false);
  const [showNewTaskModal, setShowNewTaskModal] = useState<boolean>(false);
  const [showEndAndNextModal, setShowEndAndNextModal] = useState<boolean>(false);
  const [showEditTaskModal, setShowEditTaskModal] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);

  // Form states
  const [taskForm, setTaskForm] = useState({
    project_name: '',
    task_name: '',
    description: ''
  });

  const [nextTaskForm, setNextTaskForm] = useState({
    project_name: '',
    task_name: '',
    description: ''
  });

  const [editTaskForm, setEditTaskForm] = useState({
    project_name: '',
    task_name: '',
    description: ''
  });

  const navigate = useNavigate();
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const isAdmin = user.role === 'ADMIN';

  const fetchStatus = async () => {
    try {
      const res = await api.get('/tracker/status/');
      const data = res.data;
      setStatus(data.status);
      setEvents(data.today_events || []);
      setServerTotalWork(data.total_work_seconds || 0);
      setServerTotalBreak(data.total_break_seconds || 0);
      setServerTotalWorkBase(data.completed_work_seconds ?? data.total_work_seconds ?? 0);
      setServerTotalBreakBase(data.completed_break_seconds ?? data.total_break_seconds ?? 0);
      setCurrentSegmentStart(data.current_segment_start);
      setStartTime(data.start_time);
      setEndTime(data.end_time);
      if (data.active_task) {
        setActiveTask(data.active_task);
      } else if (data.status === 'Ended') {
        setActiveTask(null);
      }
      if (data.settings) setOfficeSettings(data.settings);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Unable to sync with server.');
    }
  };

  const [employeeInfo, setEmployeeInfo] = useState<any>(null);

  const fetchDailyTasks = async (dateStr?: string, projectFilter?: string) => {
    const targetDate = dateStr || selectedTaskDate;
    const proj = projectFilter !== undefined ? projectFilter : taskFilterProject;
    setLoadingTasks(true);
    try {
      const params = new URLSearchParams();
      params.append('date', targetDate);
      if (proj && proj.trim()) {
        params.append('project', proj.trim());
      }
      const res = await api.get(`/tasks/daily/?${params.toString()}`);
      const data = res.data;
      if (data.employee) {
        setEmployeeInfo(data.employee);
        if (data.employee.employee_id && !user.employee_id) {
          const updatedUser = { ...user, employee_id: data.employee.employee_id };
          localStorage.setItem('user', JSON.stringify(updatedUser));
        }
      }
      setDailyTasks(data.tasks || []);
      setActiveTask(data.active_task || null);
      setTotalTaskFormatted(data.total_task_formatted || '0 sec');
      setProjectBreakdown(data.project_breakdown || []);

      const empCode = data.employee?.employee_id || user.employee_id || `EMP${user.id || 1}`;
      const empName = data.employee?.name || user.name || user.username || 'You';
      const empEmail = data.employee?.email || user.email || '';
      const empDept = data.employee?.department || user.department || 'General';

      setTaskReportData({
        date: data.date || targetDate,
        tasks: data.tasks || [],
        by_employee: data.by_employee || (user.id ? [{
          user_id: user.id,
          employee_id: empCode,
          employee_name: empName,
          email: empEmail,
          department: empDept,
          total_seconds: data.total_task_seconds || 0,
          total_hours: data.total_task_hours || 0,
          duration_formatted: data.total_task_formatted || '0 sec',
          tasks_count: (data.tasks || []).length
        }] : []),
        by_project_and_employee: data.by_project_and_employee || (data.project_breakdown || []).map((p: any) => ({
          project_name: p.project_name,
          employee_name: empName,
          total_seconds: p.total_seconds,
          total_hours: p.total_hours,
          duration_formatted: p.duration_formatted,
          tasks_count: p.count
        })),
        summary: data.summary || {
          total_tasks: (data.tasks || []).length,
          active_in_progress: (data.tasks || []).filter((t: any) => t.status === 'IN_PROGRESS').length,
          completed: (data.tasks || []).filter((t: any) => t.status !== 'IN_PROGRESS').length,
          total_seconds: data.total_task_seconds || 0,
          total_hours: data.total_task_hours || 0
        }
      });
    } catch (err: any) {
      console.error('Failed to load tasks', err);
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchDailyTasks(selectedTaskDate, taskFilterProject);
    const syncInterval = setInterval(() => {
      fetchStatus();
      fetchDailyTasks(selectedTaskDate, taskFilterProject);
    }, 30000);
    return () => clearInterval(syncInterval);
  }, [selectedTaskDate, taskFilterProject]);

  // Single Unified Central Tracker Timer (MUTUALLY EXCLUSIVE)
  // At any moment, ONLY ONE timer runs: Work/Task timer OR Break timer. NEVER BOTH.
  useEffect(() => {
    const tick = () => {
      const nowMs = Date.now();

      // Calculate TOTAL DAY TIME (includes breaks)
      if (startTime && status !== 'Not Started') {
        const startMs = new Date(startTime).getTime();
        if (status === 'Ended' && endTime) {
          const endMs = new Date(endTime).getTime();
          setElapsedTotalDay(Math.max(0, Math.floor((endMs - startMs) / 1000)));
        } else {
          setElapsedTotalDay(Math.max(0, Math.floor((nowMs - startMs) / 1000)));
        }
      } else {
        setElapsedTotalDay(0);
      }

      if (status === 'Working') {
        // CASE 1 & 3: WORKING
        // 1. Working time actively increases from anchor
        let activeWorkSec = serverTotalWork;
        if (currentSegmentStart) {
          const segStartMs = new Date(currentSegmentStart).getTime();
          const extraSec = Math.max(0, Math.floor((nowMs - segStartMs) / 1000));
          activeWorkSec = serverTotalWorkBase + extraSec;
        }
        setElapsedWork(activeWorkSec);

        // 2. Break time is STRICTLY FROZEN
        setElapsedBreak(serverTotalBreak);

        // 3. Active task timer increases (if active and not paused)
        if (activeTask && activeTask.status === 'IN_PROGRESS') {
          const segStartStr = activeTask.current_segment_start || activeTask.start_time;
          const taskSegMs = segStartStr ? new Date(segStartStr).getTime() : nowMs;
          const extraTaskSec = Math.max(0, Math.floor((nowMs - taskSegMs) / 1000));
          const baseSec = activeTask.duration_seconds_base ?? activeTask.duration_seconds ?? 0;
          setActiveTaskElapsed(baseSec + extraTaskSec);
        } else if (activeTask) {
          setActiveTaskElapsed(activeTask.duration_seconds_base ?? activeTask.duration_seconds ?? 0);
        } else {
          setActiveTaskElapsed(0);
        }
      } else if (status === 'On Break') {
        // CASE 2: ON BREAK
        // 1. Break time actively increases from anchor
        let activeBreakSec = serverTotalBreak;
        if (currentSegmentStart) {
          const segStartMs = new Date(currentSegmentStart).getTime();
          const extraSec = Math.max(0, Math.floor((nowMs - segStartMs) / 1000));
          activeBreakSec = serverTotalBreakBase + extraSec;
        }
        setElapsedBreak(activeBreakSec);

        // 2. Work time is STRICTLY FROZEN
        setElapsedWork(serverTotalWork);

        // 3. Active task timer is STRICTLY FROZEN at its accumulated work duration
        if (activeTask) {
          const baseSec = activeTask.duration_seconds_base ?? activeTask.duration_seconds ?? 0;
          setActiveTaskElapsed(baseSec);
        } else {
          setActiveTaskElapsed(0);
        }
      } else {
        // IDLE ('Not Started' or 'Ended')
        setElapsedWork(status === 'Ended' ? serverTotalWork : 0);
        setElapsedBreak(serverTotalBreak);
        setActiveTaskElapsed(0);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status, currentSegmentStart, serverTotalWorkBase, serverTotalBreakBase, serverTotalWork, serverTotalBreak, activeTask, startTime, endTime]);

  const handleAction = async (action: string) => {
    if (action === 'END_WORK' && !showEndModal) {
      setShowEndModal(true);
      return;
    }

    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tracker/action/', { action, source: 'web' });
      setShowEndModal(false);
      await fetchStatus();
      await fetchDailyTasks();
      
      if (action === 'START_WORK') setSuccessMsg('Workday started successfully.');
      else if (action === 'START_BREAK') setSuccessMsg('Break started. Enjoy your break!');
      else if (action === 'RESUME_WORK') setSuccessMsg('Work resumed.');
      else if (action === 'END_WORK') setSuccessMsg('Workday ended. Have a great evening!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Action failed. Please retry.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Start Workday with first task prompt
  const handleStartWorkdayClick = () => {
    setTaskForm({
      project_name: '',
      task_name: '',
      description: ''
    });
    setShowStartWorkdayPrompt(true);
  };

  const submitStartWorkdayWithTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.project_name.trim() || !taskForm.task_name.trim()) {
      setErrorMsg('Please enter both Project Name and Task Name to start.');
      return;
    }

    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tracker/action/', { action: 'START_WORK', source: 'web' });
      await api.post('/tasks/start/', {
        project_name: taskForm.project_name.trim(),
        task_name: taskForm.task_name.trim(),
        description: taskForm.description.trim()
      });

      setShowStartWorkdayPrompt(false);
      setSuccessMsg('Workday and initial task started successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to start workday. Please retry.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Start new task standalone
  const handleStartNewTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.project_name.trim() || !taskForm.task_name.trim()) {
      setErrorMsg('Project Name and Task Name are required.');
      return;
    }

    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tasks/start/', {
        project_name: taskForm.project_name.trim(),
        task_name: taskForm.task_name.trim(),
        description: taskForm.description.trim()
      });
      setShowNewTaskModal(false);
      setTaskForm({ project_name: '', task_name: '', description: '' });
      setSuccessMsg('Task started successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to start task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // End active task
  const handleEndActiveTask = async () => {
    if (!activeTask) return;
    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tasks/end/', { task_log_id: activeTask.task_log_id });
      setSuccessMsg(`Task "${activeTask.task_name}" completed.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to end task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // End active task and start next task in one step
  const handleEndAndStartNext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;
    if (!nextTaskForm.project_name.trim() || !nextTaskForm.task_name.trim()) {
      setErrorMsg('Next Project Name and Task Name are required.');
      return;
    }

    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tasks/start/', {
        project_name: nextTaskForm.project_name.trim(),
        task_name: nextTaskForm.task_name.trim(),
        description: nextTaskForm.description.trim()
      });

      setShowEndAndNextModal(false);
      setNextTaskForm({ project_name: '', task_name: '', description: '' });
      setSuccessMsg('Previous task completed and next task started.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to transition to next task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Open Edit Task Modal
  const openEditModal = (task: any) => {
    setEditingTask(task);
    setEditTaskForm({
      project_name: task.project_name,
      task_name: task.task_name,
      description: task.description || ''
    });
    setShowEditTaskModal(true);
  };

  // Submit Edit Task details
  const submitEditTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    if (!editTaskForm.project_name.trim() || !editTaskForm.task_name.trim()) {
      setErrorMsg('Project Name and Task Name cannot be blank.');
      return;
    }

    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.patch(`/tasks/${editingTask.task_log_id}/`, {
        project_name: editTaskForm.project_name.trim(),
        task_name: editTaskForm.task_name.trim(),
        description: editTaskForm.description.trim()
      });
      setShowEditTaskModal(false);
      setEditingTask(null);
      setSuccessMsg('Task details updated.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchDailyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to update task details.');
    } finally {
      setLoadingAction(false);
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      setNotificationEnabled(perm === 'granted');
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout/');
    } catch {
      // ignore
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      navigate('/login');
    }
  };

  const OFFICE_REQUIRED_SECONDS = 9 * 3600; // 9 hours
  const progressPercentage = Math.min(100, (elapsedTotalDay / OFFICE_REQUIRED_SECONDS) * 100);
  const remainingSeconds = Math.max(0, OFFICE_REQUIRED_SECONDS - elapsedTotalDay);
  const extraSeconds = Math.max(0, elapsedTotalDay - OFFICE_REQUIRED_SECONDS);
  const is9HoursCompleted = elapsedTotalDay >= OFFICE_REQUIRED_SECONDS;

  const isStartReminderActive = !reminderDismissed && status === 'Not Started';
  const isEndReminderActive = !reminderDismissed && (status === 'Working' || status === 'On Break');

  // Friendly theme colors based on workday status
  const statusTheme = useMemo(() => {
    switch (status) {
      case 'Working':
        return {
          pillBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          dotBg: 'bg-emerald-500 ring-4 ring-emerald-100',
          cardGlow: 'border-emerald-200/90 shadow-xs',
          label: 'Working Now'
        };
      case 'On Break':
        return {
          pillBg: 'bg-amber-50 text-amber-700 border-amber-200',
          dotBg: 'bg-amber-500 ring-4 ring-amber-100',
          cardGlow: 'border-amber-200/90 shadow-xs',
          label: 'On Break'
        };
      case 'Ended':
        return {
          pillBg: 'bg-slate-100 text-slate-700 border-slate-200',
          dotBg: 'bg-slate-400',
          cardGlow: 'border-slate-200/80',
          label: 'Workday Ended'
        };
      default:
        return {
          pillBg: 'bg-blue-50 text-blue-700 border-blue-200',
          dotBg: 'bg-blue-500 ring-4 ring-blue-100',
          cardGlow: 'border-slate-200/80',
          label: 'Ready to Start'
        };
    }
  }, [status]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans">
      {/* 1. TOP NAVBAR */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40 px-4 sm:px-8 py-3 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-teal-500 flex items-center justify-center text-white shadow-xs">
            <Clock size={19} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base text-slate-900 tracking-tight">Knowletive</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200/70 uppercase tracking-wider">
                Time Tracker
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium">Employee Workspace</p>
          </div>
        </div>

        {/* Right Navigation & Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden md:flex flex-col text-right pr-2 border-r border-slate-200/80">
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-xs font-bold text-slate-900 truncate max-w-[160px]">
                {user.name || user.username || user.email}
              </span>
              {(user.employee_id || employeeInfo?.employee_id) && (
                <span className="text-[10px] font-mono font-bold bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200">
                  {user.employee_id || employeeInfo?.employee_id}
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500 font-medium">{user.department || 'Employee'}</span>
          </div>

          <button
            onClick={() => navigate('/timesheet')}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/80 transition shadow-2xs"
            title="Monthly Timesheet"
          >
            <Calendar size={14} className="text-teal-600" />
            <span className="hidden sm:inline">Monthly Timesheet</span>
          </button>

          <button
            onClick={() => navigate('/analytics')}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-teal-50/80 hover:bg-teal-100 text-teal-800 border border-teal-200/80 transition shadow-2xs"
            title="View Analytics"
          >
            <TrendingUp size={14} className="text-teal-600" />
            <span className="hidden sm:inline">Analytics</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-blue-50/80 hover:bg-blue-100 text-blue-800 border border-blue-200/80 transition shadow-2xs"
              title="Admin Console"
            >
              <Shield size={14} className="text-blue-600" />
              <span className="hidden lg:inline">Admin Console</span>
            </button>
          )}

          <button
            onClick={requestNotificationPermission}
            title={notificationEnabled ? 'Notifications enabled' : 'Enable notifications'}
            className={`p-2 rounded-xl border transition shadow-2xs ${
              notificationEnabled 
                ? 'border-blue-200 text-blue-600 bg-blue-50' 
                : 'border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Bell size={15} />
          </button>

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 transition shadow-2xs"
          >
            <LogOut size={14} />
            <span className="hidden md:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN CONTAINER */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
        {/* Error Feedback Banner */}
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between gap-3 text-rose-800 text-xs shadow-xs">
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={16} className="shrink-0 text-rose-600" />
              <span className="font-medium">{errorMsg}</span>
            </div>
            <button 
              onClick={() => setErrorMsg('')}
              className="p-1 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-100 transition"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Success Feedback Banner */}
        {successMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-emerald-800 text-xs shadow-xs">
            <div className="flex items-center gap-2.5">
              <CheckCircle size={16} className="shrink-0 text-emerald-600" />
              <span className="font-medium">{successMsg}</span>
            </div>
            <button 
              onClick={() => setSuccessMsg('')}
              className="p-1 text-emerald-600 hover:text-emerald-800 rounded-lg hover:bg-emerald-100 transition"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Office Hours Reminders */}
        {isStartReminderActive && (
          <div className="p-3.5 bg-amber-50/90 border border-amber-200/90 rounded-2xl flex items-center justify-between gap-3 text-amber-900 text-xs shadow-xs">
            <div className="flex items-center gap-2.5">
              <Info size={16} className="text-amber-600 shrink-0" />
              <span>Standard office hours start at <strong>{officeSettings.work_start_time} AM IST</strong>. Start your workday when ready.</span>
            </div>
            <button 
              onClick={() => setReminderDismissed(true)} 
              className="text-xs text-amber-700 hover:text-amber-900 font-bold px-2 py-1 rounded-lg hover:bg-amber-100/70 transition"
            >
              Dismiss
            </button>
          </div>
        )}

        {isEndReminderActive && (
          <div className="p-3.5 bg-sky-50/90 border border-sky-200/90 rounded-2xl flex items-center justify-between gap-3 text-sky-900 text-xs shadow-xs">
            <div className="flex items-center gap-2.5">
              <Info size={16} className="text-sky-600 shrink-0" />
              <span>Scheduled workday finishes at <strong>{officeSettings.work_end_time} IST</strong>. Remember to clock out before leaving.</span>
            </div>
            <button 
              onClick={() => setReminderDismissed(true)} 
              className="text-xs text-sky-700 hover:text-sky-900 font-bold px-2 py-1 rounded-lg hover:bg-sky-100/70 transition"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 3. HERO WORKDAY STATUS CARD (Modern Light Centerpiece) */}
        <div className={`bg-white rounded-3xl p-6 sm:p-8 border transition-all duration-300 ${statusTheme.cardGlow}`}>
          {/* Header Status & Verification Label */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Workday Attendance</p>
              <div className="flex items-center gap-3">
                <span className={`w-3.5 h-3.5 rounded-full ${statusTheme.dotBg}`} />
                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                  {status === 'Working' ? 'Working' :
                   status === 'On Break' ? 'On Break' :
                   status === 'Ended' ? 'Workday Completed' : 'Not Clocked In'}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium self-start sm:self-auto shadow-2xs">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>Server-Verified Time (IST)</span>
            </div>
          </div>

          {/* Central Digital Stopwatch */}
          <div className="text-center py-6 sm:py-7">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {status === 'Ended' ? 'Workday Completed' : status === 'Not Started' ? 'Tracker Not Started' : 'Total Hours Today'}
            </p>
            <div className={`font-mono text-5xl sm:text-6xl font-black tracking-tight text-slate-900`}>
              {formatDigitalDuration(elapsedTotalDay)}
            </div>
            
            {/* 9 Hour Completion Progress */}
            {status !== 'Not Started' && (
              <div className="mt-6 flex flex-col items-center">
                <div className="w-full max-w-md bg-slate-100 rounded-full h-2.5 mb-2.5 overflow-hidden flex items-center justify-start border border-slate-200">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ${is9HoursCompleted ? 'bg-emerald-500' : 'bg-blue-600'}`}
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
                
                {is9HoursCompleted ? (
                  <p className="text-sm text-emerald-700 font-bold flex items-center gap-1.5">
                    <CheckCircle2 size={16} /> 9 Hours Completed (Extra: {formatDigitalDuration(extraSeconds)})
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 font-medium flex items-center gap-2">
                    <span>{progressPercentage.toFixed(1)}% of 9h completed</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-blue-700 font-semibold">Remaining: {formatDigitalDuration(remainingSeconds)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 4 Metric Tiles Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-2">
            <div className="p-3.5 bg-slate-50/80 border border-slate-200/80 rounded-2xl text-center">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Clock-In</p>
              <p className="text-sm sm:text-base font-bold text-slate-800">
                {formatReadableTime(startTime)}
              </p>
            </div>

            <div className={`p-3.5 border rounded-2xl text-center transition ${status === 'Working' ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-200' : 'bg-slate-50/60 border-slate-200/80'}`}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {status === 'Working' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />}
                <p className={`text-[11px] font-semibold uppercase tracking-wider ${status === 'Working' ? 'text-emerald-800' : 'text-slate-500'}`}>
                  Work Time {status === 'On Break' ? '(Frozen)' : ''}
                </p>
              </div>
              <p className={`text-sm sm:text-base font-bold font-mono ${status === 'Working' ? 'text-emerald-700' : 'text-slate-700'}`}>
                {formatDigitalDuration(elapsedWork)}
              </p>
            </div>

            <div className={`p-3.5 border rounded-2xl text-center transition ${status === 'On Break' ? 'bg-amber-50/80 border-amber-300 ring-1 ring-amber-200' : 'bg-slate-50/60 border-slate-200/80'}`}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {status === 'On Break' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />}
                <p className={`text-[11px] font-semibold uppercase tracking-wider ${status === 'On Break' ? 'text-amber-800' : 'text-slate-500'}`}>
                  Break Time {status === 'Working' ? '(Frozen)' : ''}
                </p>
              </div>
              <p className={`text-sm sm:text-base font-bold font-mono ${status === 'On Break' ? 'text-amber-700' : 'text-slate-700'}`}>
                {formatDigitalDuration(elapsedBreak)}
              </p>
            </div>

            <div className="p-3.5 bg-slate-50/80 border border-slate-200/80 rounded-2xl text-center">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Clock-Out</p>
              <p className="text-sm sm:text-base font-bold text-slate-800">
                {formatReadableTime(endTime)}
              </p>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="pt-5 border-t border-slate-100">
            {status === 'Not Started' && (
              <button
                onClick={handleStartWorkdayClick}
                disabled={loadingAction}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-base sm:text-lg rounded-2xl shadow-sm hover:shadow transition flex items-center justify-center gap-2.5 active:scale-[0.99]"
              >
                <Play size={20} className="fill-white" />
                <span>{loadingAction ? 'Starting Workday...' : 'Start Workday'}</span>
              </button>
            )}

            {status === 'Working' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  onClick={() => handleAction('START_BREAK')}
                  disabled={loadingAction}
                  className="py-3.5 px-6 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm sm:text-base rounded-2xl shadow-xs transition flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  <Coffee size={18} />
                  <span>{loadingAction ? 'Updating...' : 'Start Break'}</span>
                </button>
                <button
                  onClick={() => handleAction('END_WORK')}
                  disabled={loadingAction}
                  className="py-3.5 px-6 bg-white hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-rose-700 border-2 border-rose-200 hover:border-rose-300 font-bold text-sm sm:text-base rounded-2xl transition flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  <CheckCircle size={18} />
                  <span>End Workday</span>
                </button>
              </div>
            )}

            {status === 'On Break' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  onClick={() => handleAction('RESUME_WORK')}
                  disabled={loadingAction}
                  className="py-3.5 px-6 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm sm:text-base rounded-2xl shadow-xs transition flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  <Play size={18} className="fill-white" />
                  <span>{loadingAction ? 'Updating...' : 'Resume Work (End Break)'}</span>
                </button>
                <button
                  onClick={() => handleAction('END_WORK')}
                  disabled={loadingAction}
                  className="py-3.5 px-6 bg-white hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-rose-700 border-2 border-rose-200 hover:border-rose-300 font-bold text-sm sm:text-base rounded-2xl transition flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  <CheckCircle size={18} />
                  <span>End Workday</span>
                </button>
              </div>
            )}

            {status === 'Ended' && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                <p className="text-slate-900 font-bold text-sm flex items-center justify-center gap-1.5">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  Workday Completed
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Your work and break records have been securely saved. Reach out to your admin if any corrections are needed.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 4. ACTIVE TASK CARD */}
        {activeTask ? (
          <div className={`rounded-3xl p-6 shadow-xs space-y-4 border-2 transition ${
            status === 'On Break'
              ? 'bg-amber-50/40 border-amber-200/90'
              : 'bg-gradient-to-br from-blue-50/60 via-white to-teal-50/40 border-blue-200/90'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200/80">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {status === 'On Break' ? (
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1.5">
                      <Pause size={12} className="text-amber-700" />
                      Paused during Break
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                      Working on Task
                    </span>
                  )}
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-white text-blue-800 border border-blue-200/80">
                    {activeTask.project_name}
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-slate-900">
                  {activeTask.task_name}
                </h3>
              </div>

              {/* Task Running Timer (FROZEN if on break) */}
              <div className={`border rounded-2xl px-5 py-3 text-right self-start sm:self-auto shadow-2xs ${
                status === 'On Break' ? 'bg-amber-50 border-amber-200' : 'bg-white border-blue-200'
              }`}>
                <p className={`text-[10px] font-bold uppercase tracking-wider ${status === 'On Break' ? 'text-amber-700' : 'text-slate-500'}`}>
                  {status === 'On Break' ? 'Task Timer (FROZEN)' : 'Task Running Time'}
                </p>
                <p className={`font-mono text-2xl font-black tracking-tight ${status === 'On Break' ? 'text-amber-700' : 'text-blue-700'}`}>
                  {formatDigitalDuration(activeTaskElapsed)}
                </p>
              </div>
            </div>

            {/* Description & Start Timestamp */}
            <div className="text-xs sm:text-sm text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-slate-600 leading-relaxed">
                {activeTask.description || <span className="italic text-slate-400">No task description entered</span>}
              </p>
              <div className="text-xs text-slate-500 flex items-center gap-1.5 shrink-0">
                <Clock size={13} className="text-blue-600" />
                <span>Started at <strong className="text-slate-800">{activeTask.start_time_formatted || '-'}</strong></span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200/80">
              {status === 'On Break' ? (
                <>
                  <button
                    onClick={() => handleAction('RESUME_WORK')}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition flex items-center gap-1.5"
                  >
                    <Play size={14} className="fill-white" />
                    <span>Resume This Task</span>
                  </button>

                  <button
                    onClick={() => setShowEndAndNextModal(true)}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-white hover:bg-slate-50 text-blue-700 border border-blue-200 font-semibold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5"
                  >
                    <ArrowRight size={14} />
                    <span>Switch to Another Task</span>
                  </button>

                  <button
                    onClick={handleEndActiveTask}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-white hover:bg-rose-50 disabled:opacity-50 text-rose-700 border border-rose-200 font-semibold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5"
                  >
                    <Check size={14} className="text-rose-600" />
                    <span>Stop Task</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleAction('START_BREAK')}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition flex items-center gap-1.5"
                  >
                    <Coffee size={14} />
                    <span>Start Break</span>
                  </button>

                  <button
                    onClick={() => setShowEndAndNextModal(true)}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition flex items-center gap-1.5"
                  >
                    <span>Switch Task</span>
                    <ArrowRight size={14} />
                  </button>

                  <button
                    onClick={handleEndActiveTask}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-300 font-semibold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5"
                  >
                    <Check size={15} className="text-emerald-600" />
                    <span>Stop Task</span>
                  </button>
                </>
              )}

              <button
                onClick={() => openEditModal(activeTask)}
                className="py-2.5 px-3 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 text-xs font-semibold rounded-xl transition ml-auto flex items-center gap-1.5"
              >
                <Edit2 size={13} />
                <span>Edit Details</span>
              </button>
            </div>
          </div>
        ) : (
          /* When NO task is active */
          <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <Briefcase size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                  {status === 'On Break' ? 'On Break (No Active Task)' : 'No Task in Progress'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  {status === 'Working' 
                    ? 'Start tracking a specific task or project to log your hours accurately.' 
                    : status === 'On Break'
                    ? 'You are on break. Starting a new task will automatically end your break and start work.'
                    : 'Clock in to begin logging tasks and project durations.'}
                </p>
              </div>
            </div>

            {(status === 'Working' || status === 'On Break') && (
              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                {status === 'On Break' && (
                  <button
                    onClick={() => handleAction('RESUME_WORK')}
                    disabled={loadingAction}
                    className="py-2.5 px-4 bg-white hover:bg-slate-50 text-teal-700 border border-teal-200 font-semibold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5"
                  >
                    <Play size={14} className="fill-teal-700" />
                    <span>Resume Work</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setTaskForm({ project_name: '', task_name: '', description: '' });
                    setShowNewTaskModal(true);
                  }}
                  disabled={loadingAction}
                  className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition flex items-center gap-2"
                >
                  <Plus size={16} />
                  <span>Start New Task</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 5. TODAY'S TASKS LIST & REAL-TIME ANALYSIS DASHBOARD */}
        <div className="space-y-4">
          {/* Segmented View Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setWorkViewMode('tasks')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  workViewMode === 'tasks'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListTodo size={15} />
                <span>Task Log & Entries ({dailyTasks.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setWorkViewMode('analytics')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  workViewMode === 'analytics'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TrendingUp size={15} />
                <span>Real-Time Analysis Dashboard</span>
              </button>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <label className="text-xs font-bold text-slate-600">Date:</label>
              <input
                type="date"
                value={selectedTaskDate}
                onChange={(e) => setSelectedTaskDate(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {selectedTaskDate !== getTodayIsoDate() && (
                <button
                  type="button"
                  onClick={() => setSelectedTaskDate(getTodayIsoDate())}
                  className="px-2.5 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold border border-blue-200 transition"
                  title="Switch to Today"
                >
                  Today
                </button>
              )}
            </div>
          </div>

          {/* View Mode A: Real-Time Analysis Dashboard */}
          {workViewMode === 'analytics' ? (
            <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-slate-900 flex items-center gap-2">
                    <TrendingUp size={18} className="text-blue-600" />
                    <span>Personal Real-Time Task Analytics</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Live charts and performance breakdown for your tracked workday ({selectedTaskDate})
                  </p>
                </div>
                {projectBreakdown.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-600">Filter Project:</label>
                    <select
                      value={taskFilterProject}
                      onChange={(e) => setTaskFilterProject(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Projects</option>
                      {projectBreakdown.map((p) => (
                        <option key={p.project_name} value={p.project_name}>
                          {p.project_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <DailyTaskAnalyticsDashboard
                data={taskReportData}
                filterDate={selectedTaskDate}
                filterEmpId=""
                filterProject={taskFilterProject}
                onClearFilters={() => {
                  setTaskFilterProject('');
                }}
                onSetToday={() => {
                  setSelectedTaskDate(getTodayIsoDate());
                }}
                isLoading={loadingTasks}
              />
            </div>
          ) : (
            /* View Mode B: Detailed Tasks List & Project Summary */
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-5">
              {/* Header & Date Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-slate-900">Recorded Tasks</h3>
                  <p className="text-xs text-slate-500">Daily time entries and completed work sessions</p>
                </div>

                {projectBreakdown.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-600">Filter Project:</label>
                    <select
                      value={taskFilterProject}
                      onChange={(e) => setTaskFilterProject(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Projects</option>
                      {projectBreakdown.map((p) => (
                        <option key={p.project_name} value={p.project_name}>
                          {p.project_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Project Summary Strip */}
              <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Tracked Time:</span>
                  <span className="ml-2 font-mono text-base font-bold text-slate-900">{totalTaskFormatted}</span>
                </div>

                {projectBreakdown.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {projectBreakdown.map((pb, idx) => (
                      <span 
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700"
                      >
                        <span className="font-semibold text-slate-900">{pb.project_name}:</span>
                        <span className="font-mono text-blue-600 font-bold">{pb.duration_formatted}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Tasks List */}
              {loadingTasks ? (
                <div className="text-center py-8 text-slate-500 text-xs sm:text-sm">Loading task entries...</div>
              ) : dailyTasks.length === 0 ? (
                <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs sm:text-sm">
                  No tasks recorded for {selectedTaskDate}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {dailyTasks.map((t) => (
                    <div key={t.task_log_id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition px-2 rounded-xl">
                      <div className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[11px] font-bold text-slate-600 shrink-0 mt-0.5">
                          {t.sr_no}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/70">
                              {t.project_name}
                            </span>
                            <h4 className="text-sm font-bold text-slate-900">{t.task_name}</h4>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              t.status === 'IN_PROGRESS' 
                                ? 'bg-amber-50 text-amber-800 border border-amber-200' 
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}>
                              {t.status === 'IN_PROGRESS' ? 'In Progress' : 'Completed'}
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-xs text-slate-600 mt-1">{t.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 pl-9 sm:pl-0 shrink-0">
                        <div className="text-right">
                          <p className="font-mono text-xs font-bold text-slate-900">{t.duration_formatted}</p>
                          <p className="text-[11px] text-slate-500">
                            {t.start_time_formatted} — {t.end_time_formatted}
                          </p>
                        </div>

                        <button
                          onClick={() => openEditModal(t)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-white text-slate-600 hover:text-slate-900 text-xs font-semibold transition"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ======================================================== */}
      {/* MODAL 1: START WORKDAY WITH INITIAL TASK */}
      {/* ======================================================== */}
      {showStartWorkdayPrompt && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Start Workday</h3>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              Enter your initial project and task details to clock in.
            </p>

            <form onSubmit={submitStartWorkdayWithTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Project Alpha"
                  value={taskForm.project_name}
                  onChange={(e) => setTaskForm({ ...taskForm, project_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Preparing client requirements"
                  value={taskForm.task_name}
                  onChange={(e) => setTaskForm({ ...taskForm, task_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief details about the task..."
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowStartWorkdayPrompt(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-xs transition"
                >
                  {loadingAction ? 'Starting...' : 'Start Work & Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: START NEW TASK */}
      {/* ======================================================== */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Start New Task</h3>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              Enter your project and task details to start tracking time.
            </p>

            <form onSubmit={handleStartNewTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Website Redesign"
                  value={taskForm.project_name}
                  onChange={(e) => setTaskForm({ ...taskForm, project_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Building analytics page"
                  value={taskForm.task_name}
                  onChange={(e) => setTaskForm({ ...taskForm, task_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief details about what you are working on..."
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-xs transition"
                >
                  {loadingAction ? 'Starting...' : 'Start Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: END TASK / START NEXT TASK */}
      {/* ======================================================== */}
      {showEndAndNextModal && activeTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Switch to Next Task</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Completes the active task and immediately begins your next one.
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl mb-4 text-xs">
              <span className="text-slate-500 font-medium">Currently Ending: </span>
              <span className="font-bold text-slate-900">{activeTask.task_name}</span> ({activeTask.project_name})
            </div>

            <form onSubmit={handleEndAndStartNext} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Next Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Project Beta"
                  value={nextTaskForm.project_name}
                  onChange={(e) => setNextTaskForm({ ...nextTaskForm, project_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Next Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Drafting presentation"
                  value={nextTaskForm.task_name}
                  onChange={(e) => setNextTaskForm({ ...nextTaskForm, task_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Description for the next task..."
                  value={nextTaskForm.description}
                  onChange={(e) => setNextTaskForm({ ...nextTaskForm, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEndAndNextModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-xs transition"
                >
                  {loadingAction ? 'Switching...' : 'Switch to Next Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 4: EDIT TASK DETAILS */}
      {/* ======================================================== */}
      {showEditTaskModal && editingTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Edit Task Details</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Update project name, task title, or notes.
            </p>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl mb-4 text-xs space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Start Time:</span>
                <span className="font-semibold text-slate-800">{editingTask.start_time_formatted}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>End Time:</span>
                <span className="font-semibold text-slate-800">{editingTask.end_time_formatted}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Duration:</span>
                <span className="font-bold text-blue-700 font-mono">{editingTask.duration_formatted}</span>
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                Note: Server-recorded timestamps cannot be manually altered.
              </p>
            </div>

            <form onSubmit={submitEditTask} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  value={editTaskForm.project_name}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, project_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  value={editTaskForm.task_name}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, task_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={editTaskForm.description}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditTaskModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-xs transition"
                >
                  {loadingAction ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 5: CONFIRM END WORKDAY */}
      {/* ======================================================== */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">End Workday?</h3>
            <p className="text-xs text-slate-600 mt-2 mb-6 leading-relaxed">
              Are you sure you want to clock out? Once ended, your workday is recorded and locked for the day.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowEndModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction('END_WORK')}
                disabled={loadingAction}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-xs transition"
              >
                {loadingAction ? 'Ending...' : 'Yes, End Workday'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
