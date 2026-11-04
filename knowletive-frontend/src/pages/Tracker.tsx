import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Play, Pause, LogOut, CheckCircle, Bell,
  Calendar, Info, AlertTriangle, ShieldCheck,
  Plus, Edit2, Check, ArrowRight,
  Clock, Shield, X, TrendingUp, Coffee,
  CheckCircle2, Briefcase, ListTodo,
  RotateCcw, MessageSquare, Download, Puzzle
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import DailyTaskAnalyticsDashboard from '../components/DailyTaskAnalyticsDashboard';
import EmployeeProjectTasks from '../components/EmployeeProjectTasks';

import { formatDigitalDuration, formatDisplayDate } from '../utils/formatters';

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
  const [showExtensionModal, setShowExtensionModal] = useState<boolean>(false);
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
  const [workViewMode, setWorkViewMode] = useState<'projects' | 'tasks' | 'analytics'>('projects');
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

  // Reopen Task Modal
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [reopenTargetTaskId, setReopenTargetTaskId] = useState<string>('');
  const [reopenReason, setReopenReason] = useState<string>('');

  // Progress Note Modal
  const [showNoteModal, setShowNoteModal] = useState<boolean>(false);
  const [noteTargetTaskId, setNoteTargetTaskId] = useState<string>('');
  const [noteContent, setNoteContent] = useState<string>('');

  // Project & Task Suggestions
  const [existingProjects, setExistingProjects] = useState<any[]>([]);
  const [unfinishedTasks, setUnfinishedTasks] = useState<any[]>([]);

  // Form states
  interface TaskFormData {
    project_name: string;
    task_name: string;
    description: string;
    project_task_id?: string;
  }

  const [taskForm, setTaskForm] = useState<TaskFormData>({
    project_name: '',
    task_name: '',
    description: '',
    project_task_id: ''
  });

  const [nextTaskForm, setNextTaskForm] = useState<TaskFormData>({
    project_name: '',
    task_name: '',
    description: '',
    project_task_id: ''
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

  useEffect(() => {
    if (isAdmin) {
      navigate('/admin', { replace: true });
    }
  }, [isAdmin, navigate]);

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

  const fetchProjectSuggestions = async () => {
    try {
      const res = await api.get('/projects/');
      setExistingProjects(res.data.projects || []);
      const tasksRes = await api.get('/tasks/my-tasks/?status=IN_PROGRESS&all_history=true');
      setUnfinishedTasks(tasksRes.data.tasks || []);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchDailyTasks(selectedTaskDate, taskFilterProject);
    fetchProjectSuggestions();
    const syncInterval = setInterval(() => {
      if (document.hidden) return; // Pause sync polling when tab is hidden
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
      description: '',
      project_task_id: ''
    });
    fetchProjectSuggestions();
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
        description: taskForm.description.trim(),
        project_task_id: taskForm.project_task_id || undefined
      });

      setShowStartWorkdayPrompt(false);
      setSuccessMsg('Workday and initial task started successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
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
        description: taskForm.description.trim(),
        project_task_id: taskForm.project_task_id || undefined
      });
      setShowNewTaskModal(false);
      setTaskForm({ project_name: '', task_name: '', description: '', project_task_id: '' });
      setSuccessMsg('Task started successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to start task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Stop active task timer (Leaves task In Progress)
  const handleStopActiveTask = async () => {
    if (!activeTask) return;
    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tasks/end/', { 
        task_log_id: activeTask.task_log_id,
        is_completed: false 
      });
      setSuccessMsg(`Task "${activeTask.task_name}" stopped. Status remains In Progress.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to stop task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Explicitly mark active task Completed
  const handleCompleteActiveTask = async () => {
    if (!activeTask) return;
    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/tasks/end/', { 
        task_log_id: activeTask.task_log_id,
        is_completed: true 
      });
      setSuccessMsg(`Task "${activeTask.task_name}" marked as Completed!`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to complete task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Resume an unfinished task
  const handleResumeTask = async (task: any) => {
    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await api.post('/tasks/start/', {
        project_name: task.project_name,
        task_name: task.task_name || task.title,
        description: task.description || '',
        project_task_id: task.project_task_id || task.task_id
      });
      setSuccessMsg(`Resumed work on "${task.task_name || task.title}".`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to resume task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Explicitly complete a task from the list
  const handleCompleteTaskFromList = async (task: any) => {
    const pTaskId = task.project_task_id || task.task_id;
    setLoadingAction(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (pTaskId) {
        await api.post(`/project-tasks/${pTaskId}/complete/`);
      } else {
        await api.post('/tasks/end/', { task_log_id: task.task_log_id, is_completed: true });
      }
      setSuccessMsg(`Task "${task.task_name || task.title}" marked Completed.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to complete task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Reopen completed task (requires mandatory reason)
  const handleReopenTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason.trim() || !reopenTargetTaskId) {
      setErrorMsg('A mandatory reason is required to reopen this task.');
      return;
    }
    setLoadingAction(true);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${reopenTargetTaskId}/reopen/`, {
        reason: reopenReason.trim()
      });
      setSuccessMsg('Task reopened successfully. Status returned to In Progress.');
      setShowReopenModal(false);
      setReopenReason('');
      setReopenTargetTaskId('');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchStatus();
      await fetchDailyTasks();
      await fetchProjectSuggestions();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to reopen task.');
    } finally {
      setLoadingAction(false);
    }
  };

  // Add progress note
  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim() || !noteTargetTaskId) {
      setErrorMsg('Progress note content is required.');
      return;
    }
    setLoadingAction(true);
    setErrorMsg('');
    try {
      await api.post(`/project-tasks/${noteTargetTaskId}/note/`, {
        content: noteContent.trim()
      });
      setSuccessMsg('Progress note added successfully.');
      setShowNoteModal(false);
      setNoteContent('');
      setNoteTargetTaskId('');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchDailyTasks();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to add progress note.');
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
    <div className="min-h-screen text-slate-800 flex flex-col font-sans">
      {/* 1. TOP NAVBAR (Glassmorphic) */}
      <header className="glass-nav sticky top-0 z-40 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-[0_8px_16px_-4px_rgba(79,70,229,0.35),inset_1px_1px_2px_rgba(255,255,255,0.4)] border border-indigo-400/30">
            <Clock size={20} className="text-white drop-shadow-xs" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base text-slate-900 tracking-tight">Knowletive</span>
              <span className="clay-pill clay-pill-indigo text-[10px]">
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
                <span className="clay-pill clay-pill-indigo text-[10px] font-mono py-0 px-1.5">
                  {user.employee_id || employeeInfo?.employee_id}
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500 font-medium">{user.department || 'Employee'}</span>
          </div>

          <button
            onClick={() => navigate('/timesheet')}
            className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl"
            title="Monthly Timesheet"
          >
            <Calendar size={14} className="text-indigo-600" />
            <span className="hidden sm:inline">Monthly Timesheet</span>
          </button>

          <button
            onClick={() => navigate('/analytics')}
            className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl"
            title="View Analytics"
          >
            <TrendingUp size={14} className="text-indigo-600" />
            <span className="hidden sm:inline">Analytics</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl"
              title="Admin Console"
            >
              <Shield size={14} className="text-indigo-600" />
              <span className="hidden lg:inline">Admin Console</span>
            </button>
          )}

          <button
            onClick={() => setShowExtensionModal(true)}
            className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl"
            title="Download Chrome Extension for desktop tracking"
          >
            <Puzzle size={14} className="text-indigo-600" />
            <span className="hidden sm:inline">Extension</span>
          </button>

          <button
            onClick={requestNotificationPermission}
            title={notificationEnabled ? 'Notifications enabled' : 'Enable notifications'}
            className={`clay-btn p-2 rounded-xl transition ${
              notificationEnabled 
                ? 'clay-btn-primary !p-2' 
                : 'clay-btn-secondary !p-2'
            }`}
          >
            <Bell size={15} />
          </button>

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl hover:!text-rose-600"
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
          <div className="p-4 bg-rose-50/90 border border-rose-200/90 rounded-2xl flex items-center justify-between gap-3 text-rose-900 text-xs shadow-xs animate-fadeIn">
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
          <div className="p-4 bg-emerald-50/90 border border-emerald-200/90 rounded-2xl flex items-center justify-between gap-3 text-emerald-900 text-xs shadow-xs animate-fadeIn">
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
              className="clay-btn clay-btn-secondary text-xs px-2.5 py-1 rounded-lg"
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
              className="clay-btn clay-btn-secondary text-xs px-2.5 py-1 rounded-lg"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Quick Chrome Extension Download Banner */}
        <div className="clay-card-flat px-4 py-3 bg-gradient-to-r from-indigo-50/80 via-white to-sky-50/80 border border-indigo-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Puzzle size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold text-slate-800">Knowletive Chrome Extension</p>
                <span className="clay-pill clay-pill-indigo text-[10px] py-0 px-1.5 font-bold">v1.0.0</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Track attendance and work sessions from any browser tab with centralized sync.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={() => setShowExtensionModal(true)}
              className="clay-btn clay-btn-secondary text-xs px-3 py-1.5 rounded-xl font-medium"
            >
              How to Install
            </button>
            <a
              href="/knowletive-extension.zip"
              download="knowletive-extension.zip"
              className="clay-btn clay-btn-primary text-xs px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1.5 shadow-xs"
            >
              <Download size={13} />
              <span>Download Extension</span>
            </a>
          </div>
        </div>

        {/* 3. HERO WORKDAY STATUS CARD (Claymorphic) */}
        <div className="clay-card p-6 sm:p-8 relative">
          {/* Header Status & Verification Label */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-200/60">
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

            <div className="clay-pill clay-pill-neutral self-start sm:self-auto">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>Server-Verified Time (IST)</span>
            </div>
          </div>

          {/* Central Digital Stopwatch */}
          <div className="text-center py-6 sm:py-7">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {status === 'Ended' ? 'Workday Completed' : status === 'Not Started' ? 'Tracker Not Started' : 'Total Hours Today'}
            </p>
            <div className="font-mono text-5xl sm:text-6xl font-black tracking-tight text-slate-900 drop-shadow-xs">
              {formatDigitalDuration(elapsedTotalDay)}
            </div>
            
            {/* 9 Hour Completion Progress with Clay Inset Well */}
            {status !== 'Not Started' && (
              <div className="mt-6 flex flex-col items-center">
                <div className="w-full max-w-md clay-inset-well h-3 mb-2.5 p-0.5 overflow-hidden flex items-center">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 shadow-xs ${is9HoursCompleted ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-indigo-500 to-indigo-600'}`}
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
                    <span className="text-indigo-700 font-semibold">Remaining: {formatDigitalDuration(remainingSeconds)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 4 Metric Tiles Strip with Claymorphic Depth */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-2">
            <div className="clay-card-flat p-4 text-center">
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1">Clock-In</p>
              <p className="text-sm sm:text-base font-bold text-slate-800">
                {formatReadableTime(startTime)}
              </p>
            </div>

            <div className={`clay-card-flat p-4 text-center transition ${status === 'Working' ? '!bg-emerald-50/70 !border-emerald-300/80 ring-2 ring-emerald-200/50' : ''}`}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {status === 'Working' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />}
                <p className={`text-[11px] font-bold uppercase tracking-wider ${status === 'Working' ? 'text-emerald-800' : 'text-slate-500'}`}>
                  Work Time {status === 'On Break' ? '(Frozen)' : ''}
                </p>
              </div>
              <p className={`text-sm sm:text-base font-bold font-mono ${status === 'Working' ? 'text-emerald-700' : 'text-slate-700'}`}>
                {formatDigitalDuration(elapsedWork)}
              </p>
            </div>

            <div className={`clay-card-flat p-4 text-center transition ${status === 'On Break' ? '!bg-amber-50/70 !border-amber-300/80 ring-2 ring-amber-200/50' : ''}`}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                {status === 'On Break' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />}
                <p className={`text-[11px] font-bold uppercase tracking-wider ${status === 'On Break' ? 'text-amber-800' : 'text-slate-500'}`}>
                  Break Time {status === 'Working' ? '(Frozen)' : ''}
                </p>
              </div>
              <p className={`text-sm sm:text-base font-bold font-mono ${status === 'On Break' ? 'text-amber-700' : 'text-slate-700'}`}>
                {formatDigitalDuration(elapsedBreak)}
              </p>
            </div>

            <div className="clay-card-flat p-4 text-center">
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mb-1">Clock-Out</p>
              <p className="text-sm sm:text-base font-bold text-slate-800">
                {formatReadableTime(endTime)}
              </p>
            </div>
          </div>

          {/* Primary Action Buttons (Tactile Clay) */}
          <div className="pt-5 border-t border-slate-200/60">
            {status === 'Not Started' && (
              <button
                onClick={handleStartWorkdayClick}
                disabled={loadingAction}
                className="clay-btn clay-btn-success w-full py-4 text-base sm:text-lg font-bold rounded-2xl"
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
                  className="clay-btn clay-btn-warning py-3.5 px-6 font-bold text-sm sm:text-base rounded-2xl"
                >
                  <Coffee size={18} />
                  <span>{loadingAction ? 'Updating...' : 'Start Break'}</span>
                </button>
                <button
                  onClick={() => handleAction('END_WORK')}
                  disabled={loadingAction}
                  className="clay-btn clay-btn-danger py-3.5 px-6 font-bold text-sm sm:text-base rounded-2xl"
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
                  className="clay-btn clay-btn-primary py-3.5 px-6 font-bold text-sm sm:text-base rounded-2xl"
                >
                  <Play size={18} className="fill-white" />
                  <span>{loadingAction ? 'Updating...' : 'Resume Work (End Break)'}</span>
                </button>
                <button
                  onClick={() => handleAction('END_WORK')}
                  disabled={loadingAction}
                  className="clay-btn clay-btn-danger py-3.5 px-6 font-bold text-sm sm:text-base rounded-2xl"
                >
                  <CheckCircle size={18} />
                  <span>End Workday</span>
                </button>
              </div>
            )}

            {status === 'Ended' && (
              <div className="p-4 clay-card-flat text-center">
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
          <div className={`clay-card p-6 sm:p-7 relative space-y-4 border transition-all ${
            status === 'On Break'
              ? '!border-amber-300/80 !bg-amber-50/40 ring-2 ring-amber-200/50'
              : '!border-indigo-300/80 !bg-indigo-50/30 ring-2 ring-indigo-200/40'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200/60">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {status === 'On Break' ? (
                    <span className="clay-pill clay-pill-warning">
                      <Pause size={12} className="text-amber-700" />
                      Paused during Break
                    </span>
                  ) : (
                    <span className="clay-pill clay-pill-success">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                      Working on Task
                    </span>
                  )}
                  <span className="clay-pill clay-pill-indigo">
                    {activeTask.project_name}
                  </span>
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  {activeTask.task_name}
                </h3>
              </div>

              {/* Task Running Timer (FROZEN if on break) */}
              <div className={`clay-card-flat px-5 py-3 text-right self-start sm:self-auto ${
                status === 'On Break' ? '!bg-amber-50/90 !border-amber-300/80' : '!bg-white/95 !border-indigo-200/80'
              }`}>
                <p className={`text-[10px] font-bold uppercase tracking-wider ${status === 'On Break' ? 'text-amber-700' : 'text-slate-500'}`}>
                  {status === 'On Break' ? 'Task Timer (FROZEN)' : 'Task Running Time'}
                </p>
                <p className={`font-mono text-2xl font-black tracking-tight ${status === 'On Break' ? 'text-amber-700' : 'text-indigo-600'}`}>
                  {formatDigitalDuration(activeTaskElapsed)}
                </p>
              </div>
            </div>

            {/* Description & Start Timestamp */}
            <div className="text-xs sm:text-sm text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-slate-600 leading-relaxed font-medium">
                {activeTask.description || <span className="italic text-slate-400">No task description entered</span>}
              </p>
              <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                <Clock size={13} className="text-indigo-600" />
                <span>Started at <strong className="text-slate-800">{activeTask.start_time_formatted || '-'}</strong></span>
              </div>
            </div>

            {/* Action Buttons (Tactile Clay) */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200/60">
              {status === 'On Break' ? (
                <>
                  <button
                    onClick={() => handleAction('RESUME_WORK')}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-primary py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                  >
                    <Play size={14} className="fill-white" />
                    <span>Resume This Task</span>
                  </button>

                  <button
                    onClick={() => setShowEndAndNextModal(true)}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-secondary py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                  >
                    <ArrowRight size={14} />
                    <span>Switch to Another Task</span>
                  </button>

                  <button
                    onClick={handleStopActiveTask}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-secondary py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                    title="Stop task timer (Leaves task In Progress)"
                  >
                    <Pause size={14} />
                    <span>Stop Task</span>
                  </button>

                  <button
                    onClick={handleCompleteActiveTask}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-success py-2.5 px-4 text-xs sm:text-sm rounded-xl font-bold"
                    title="Explicitly complete task and close work session"
                  >
                    <CheckCircle2 size={14} />
                    <span>Mark Completed</span>
                  </button>

                  <button
                    onClick={() => {
                      setNoteTargetTaskId(activeTask.project_task_id || activeTask.task_id);
                      setNoteContent('');
                      setShowNoteModal(true);
                    }}
                    className="clay-btn clay-btn-secondary py-2.5 px-3 text-xs sm:text-sm rounded-xl"
                    title="Add progress note"
                  >
                    <MessageSquare size={13} />
                    <span>Note</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleAction('START_BREAK')}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-warning py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                  >
                    <Coffee size={14} />
                    <span>Start Break</span>
                  </button>

                  <button
                    onClick={() => setShowEndAndNextModal(true)}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-primary py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                  >
                    <span>Switch Task</span>
                    <ArrowRight size={14} />
                  </button>

                  <button
                    onClick={handleStopActiveTask}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-secondary py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                    title="Stop task timer (Leaves task In Progress)"
                  >
                    <Pause size={14} />
                    <span>Stop Task</span>
                  </button>

                  <button
                    onClick={handleCompleteActiveTask}
                    disabled={loadingAction}
                    className="clay-btn clay-btn-success py-2.5 px-4 text-xs sm:text-sm rounded-xl font-bold"
                    title="Explicitly complete task and close work session"
                  >
                    <CheckCircle2 size={14} />
                    <span>Mark Completed</span>
                  </button>

                  <button
                    onClick={() => {
                      setNoteTargetTaskId(activeTask.project_task_id || activeTask.task_id);
                      setNoteContent('');
                      setShowNoteModal(true);
                    }}
                    className="clay-btn clay-btn-secondary py-2.5 px-3 text-xs sm:text-sm rounded-xl"
                    title="Add progress note"
                  >
                    <MessageSquare size={13} />
                    <span>Note</span>
                  </button>
                </>
              )}

              <button
                onClick={() => openEditModal(activeTask)}
                className="clay-btn clay-btn-secondary py-2 px-3 text-xs rounded-xl ml-auto"
              >
                <Edit2 size={13} />
                <span>Edit Details</span>
              </button>
            </div>
          </div>
        ) : (
          /* When NO task is active */
          <div className="clay-card p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 shadow-inner">
                <Briefcase size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                  {status === 'On Break' ? 'On Break (No Active Task)' : 'No Task in Progress'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">
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
                    className="clay-btn clay-btn-secondary py-2.5 px-4 text-xs sm:text-sm rounded-xl"
                  >
                    <Play size={14} className="fill-indigo-700 text-indigo-700" />
                    <span>Resume Work</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setTaskForm({ project_name: '', task_name: '', description: '' });
                    setShowNewTaskModal(true);
                  }}
                  disabled={loadingAction}
                  className="clay-btn clay-btn-primary py-2.5 px-5 text-xs sm:text-sm rounded-xl"
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
          <div className="clay-card-flat p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-200/50 p-1 flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setWorkViewMode('projects')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  workViewMode === 'projects'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Briefcase size={15} />
                <span>My Projects & Tasks</span>
              </button>
              <button
                type="button"
                onClick={() => setWorkViewMode('tasks')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  workViewMode === 'tasks'
                    ? 'bg-white text-indigo-700 shadow-xs'
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
                    ? 'bg-white text-indigo-700 shadow-xs'
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
                className="clay-input text-sm font-mono font-medium min-h-[44px]"
              />
              {selectedTaskDate !== getTodayIsoDate() && (
                <button
                  type="button"
                  onClick={() => setSelectedTaskDate(getTodayIsoDate())}
                  className="clay-btn clay-btn-secondary px-3 min-h-[44px] text-xs font-bold rounded-xl"
                  title="Switch to Today"
                >
                  Today
                </button>
              )}
            </div>
          </div>

          {/* View Mode A: My Projects & Tasks */}
          {workViewMode === 'projects' ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              <EmployeeProjectTasks onTimerSync={fetchStatus} />
            </div>
          ) : workViewMode === 'analytics' ? (
            <div className="clay-card p-5 sm:p-7 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-slate-900 flex items-center gap-2">
                    <TrendingUp size={18} className="text-indigo-600" />
                    <span>Personal Real-Time Task Analytics</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Live charts and performance breakdown for your tracked workday ({formatDisplayDate(selectedTaskDate)})
                  </p>
                </div>
                {projectBreakdown.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-600">Filter Project:</label>
                    <select
                      value={taskFilterProject}
                      onChange={(e) => setTaskFilterProject(e.target.value)}
                      className="clay-input text-sm font-medium min-h-[44px] min-w-[160px]"
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
            <div className="clay-card p-6 sm:p-7 space-y-5">
              {/* Header & Date Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/60">
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-slate-900">Recorded Tasks</h3>
                  <p className="text-xs text-slate-500 font-medium">Daily time entries and completed work sessions</p>
                </div>

                {projectBreakdown.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-600">Filter Project:</label>
                    <select
                      value={taskFilterProject}
                      onChange={(e) => setTaskFilterProject(e.target.value)}
                      className="clay-input text-sm font-medium min-h-[44px] min-w-[160px]"
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
              <div className="clay-inset-well p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Tracked Time:</span>
                  <span className="ml-2 font-mono text-base font-bold text-slate-900">{totalTaskFormatted}</span>
                </div>

                {projectBreakdown.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {projectBreakdown.map((pb, idx) => (
                      <span 
                        key={idx}
                        className="clay-card-flat inline-flex items-center gap-1.5 px-3 py-1 text-xs text-slate-700"
                      >
                        <span className="font-semibold text-slate-900">{pb.project_name}:</span>
                        <span className="font-mono text-indigo-600 font-bold">{pb.duration_formatted}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Tasks List */}
              {loadingTasks ? (
                <div className="text-center py-8 text-slate-500 text-xs sm:text-sm font-medium">Loading task entries...</div>
              ) : dailyTasks.length === 0 ? (
                <div className="text-center py-10 clay-inset-well rounded-2xl border-dashed text-slate-500 text-xs sm:text-sm font-medium">
                  No tasks recorded for {formatDisplayDate(selectedTaskDate)}.
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
                            <span className="clay-pill clay-pill-indigo text-[11px] py-0 px-2">
                              {t.project_name}
                            </span>
                            <h4 className="text-sm font-bold text-slate-900">{t.task_name}</h4>
                            <span className={`clay-pill text-[10px] py-0 px-2 ${
                              t.status === 'IN_PROGRESS' 
                                ? 'clay-pill-warning' 
                                : 'clay-pill-success'
                            }`}>
                              {t.status === 'IN_PROGRESS' ? 'In Progress' : 'Completed'}
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-xs text-slate-600 mt-1 font-medium">{t.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2 pl-9 sm:pl-0 shrink-0 flex-wrap">
                        <div className="text-right mr-2">
                          <p className="font-mono text-xs font-bold text-slate-900">{t.duration_formatted}</p>
                          <p className="text-[11px] text-slate-500 font-medium">
                            {t.start_time_formatted} — {t.end_time_formatted}
                          </p>
                        </div>

                        {/* Resume button if unfinished and not active */}
                        {t.status !== 'COMPLETED' && (!activeTask || activeTask.task_log_id !== t.task_log_id) && (
                          <button
                            onClick={() => handleResumeTask(t)}
                            disabled={loadingAction}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1 transition"
                            title="Resume this task"
                          >
                            <Play size={11} />
                            <span>Resume</span>
                          </button>
                        )}

                        {/* Mark completed if unfinished */}
                        {t.status !== 'COMPLETED' && (
                          <button
                            onClick={() => handleCompleteTaskFromList(t)}
                            disabled={loadingAction}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 flex items-center gap-1 transition"
                            title="Mark as Completed"
                          >
                            <Check size={11} />
                            <span>Complete</span>
                          </button>
                        )}

                        {/* Reopen task if completed */}
                        {t.status === 'COMPLETED' && (
                          <button
                            onClick={() => {
                              setReopenTargetTaskId(t.project_task_id || t.task_id);
                              setReopenReason('');
                              setShowReopenModal(true);
                            }}
                            disabled={loadingAction}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 flex items-center gap-1 transition"
                            title="Reopen task (requires reason)"
                          >
                            <RotateCcw size={11} />
                            <span>Reopen</span>
                          </button>
                        )}

                        {/* Add Progress Note */}
                        <button
                          onClick={() => {
                            setNoteTargetTaskId(t.project_task_id || t.task_id);
                            setNoteContent('');
                            setShowNoteModal(true);
                          }}
                          className="px-2 py-1 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1 transition"
                          title="Add Progress Note"
                        >
                          <MessageSquare size={11} />
                          <span>Note</span>
                        </button>

                        <button
                          onClick={() => openEditModal(t)}
                          className="clay-btn clay-btn-secondary px-2.5 py-1 text-xs font-semibold rounded-lg"
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
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Start Workday</h3>
            <p className="text-xs text-slate-500 mt-1 mb-5 font-medium">
              Enter your initial project and task details to clock in.
            </p>

            <form onSubmit={submitStartWorkdayWithTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  list="start-project-suggestions"
                  placeholder="Select existing project or enter new name..."
                  value={taskForm.project_name}
                  onChange={(e) => setTaskForm({ ...taskForm, project_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm placeholder-slate-400 font-medium"
                />
                <datalist id="start-project-suggestions">
                  {existingProjects.map((p) => (
                    <option key={p.project_id} value={p.name} />
                  ))}
                </datalist>

                {taskForm.project_name.trim() && (() => {
                  const matching = unfinishedTasks.filter(
                    (ut) => ut.project_name.toLowerCase() === taskForm.project_name.trim().toLowerCase()
                  );
                  if (matching.length === 0) return null;
                  return (
                    <div className="p-3 rounded-xl bg-indigo-50/90 border border-indigo-100 text-xs space-y-2 mt-2">
                      <span className="font-bold text-indigo-900 block">
                        Unfinished task(s) in "{taskForm.project_name.trim()}":
                      </span>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {matching.map((ut) => (
                          <div
                            key={ut.task_id}
                            className="flex items-center justify-between bg-white p-2 rounded-lg border border-indigo-100/80 gap-2 shadow-2xs"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">{ut.title}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{ut.task_id}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                handleResumeTask(ut);
                                setShowStartWorkdayPrompt(false);
                              }}
                              className="px-2.5 py-1 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 shrink-0 shadow-2xs transition"
                            >
                              Resume Task
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500 italic">
                        Click Resume above to continue without duplicate tasks, or enter a new task name below.
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Preparing client requirements"
                  value={taskForm.task_name}
                  onChange={(e) => setTaskForm({ ...taskForm, task_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Description <span className="text-slate-400 font-normal lowercase">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief details about the task..."
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  className="clay-input w-full p-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/60">
                <button
                  type="button"
                  onClick={() => setShowStartWorkdayPrompt(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="clay-btn clay-btn-success px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
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
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Start New Task</h3>
            <p className="text-xs text-slate-500 mt-1 mb-5 font-medium">
              Enter your project and task details to start tracking time.
            </p>

            <form onSubmit={handleStartNewTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  list="new-project-suggestions"
                  placeholder="Select existing project or enter new name..."
                  value={taskForm.project_name}
                  onChange={(e) => setTaskForm({ ...taskForm, project_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm placeholder-slate-400 font-medium"
                />
                <datalist id="new-project-suggestions">
                  {existingProjects.map((p) => (
                    <option key={p.project_id} value={p.name} />
                  ))}
                </datalist>

                {taskForm.project_name.trim() && (() => {
                  const matching = unfinishedTasks.filter(
                    (ut) => ut.project_name.toLowerCase() === taskForm.project_name.trim().toLowerCase()
                  );
                  if (matching.length === 0) return null;
                  return (
                    <div className="p-3 rounded-xl bg-indigo-50/90 border border-indigo-100 text-xs space-y-2 mt-2">
                      <span className="font-bold text-indigo-900 block">
                        Unfinished task(s) in "{taskForm.project_name.trim()}":
                      </span>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {matching.map((ut) => (
                          <div
                            key={ut.task_id}
                            className="flex items-center justify-between bg-white p-2 rounded-lg border border-indigo-100/80 gap-2 shadow-2xs"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">{ut.title}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{ut.task_id}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                handleResumeTask(ut);
                                setShowNewTaskModal(false);
                              }}
                              className="px-2.5 py-1 rounded bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 shrink-0 shadow-2xs transition"
                            >
                              Resume Task
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500 italic">
                        Click Resume above to continue without duplicate tasks, or enter a new task name below.
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Building analytics page"
                  value={taskForm.task_name}
                  onChange={(e) => setTaskForm({ ...taskForm, task_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Description <span className="text-slate-400 font-normal lowercase">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief details about what you are working on..."
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  className="clay-input w-full p-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/60">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="clay-btn clay-btn-primary px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
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
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Switch to Next Task</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4 font-medium">
              Completes the active task and immediately begins your next one.
            </p>

            <div className="clay-card-flat p-3.5 mb-4 text-xs font-medium">
              <span className="text-slate-500">Currently Ending: </span>
              <span className="font-bold text-slate-900">{activeTask.task_name}</span> ({activeTask.project_name})
            </div>

            <form onSubmit={handleEndAndStartNext} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Next Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Project Beta"
                  value={nextTaskForm.project_name}
                  onChange={(e) => setNextTaskForm({ ...nextTaskForm, project_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Next Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Drafting presentation"
                  value={nextTaskForm.task_name}
                  onChange={(e) => setNextTaskForm({ ...nextTaskForm, task_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Description <span className="text-slate-400 font-normal lowercase">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Description for the next task..."
                  value={nextTaskForm.description}
                  onChange={(e) => setNextTaskForm({ ...nextTaskForm, description: e.target.value })}
                  className="clay-input w-full p-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/60">
                <button
                  type="button"
                  onClick={() => setShowEndAndNextModal(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="clay-btn clay-btn-primary px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
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
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Edit Task Details</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4 font-medium">
              Update project name, task title, or notes.
            </p>

            <div className="clay-card-flat p-4 mb-4 text-xs space-y-1.5 font-medium">
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
                <span className="font-bold text-indigo-700 font-mono">{editingTask.duration_formatted}</span>
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                Note: Server-recorded timestamps cannot be manually altered.
              </p>
            </div>

            <form onSubmit={submitEditTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Project Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  value={editTaskForm.project_name}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, project_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Task Name <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <input
                  type="text"
                  required
                  value={editTaskForm.task_name}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, task_name: e.target.value })}
                  className="clay-input w-full px-3.5 py-2.5 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={editTaskForm.description}
                  onChange={(e) => setEditTaskForm({ ...editTaskForm, description: e.target.value })}
                  className="clay-input w-full p-3 text-sm font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/60">
                <button
                  type="button"
                  onClick={() => setShowEditTaskModal(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="clay-btn clay-btn-primary px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
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
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-7 max-w-sm w-full">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">End Workday?</h3>
            <p className="text-xs text-slate-600 mt-2 mb-6 leading-relaxed font-medium">
              Are you sure you want to clock out? Once ended, your workday is recorded and locked for the day.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowEndModal(false)}
                className="clay-btn clay-btn-secondary px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction('END_WORK')}
                disabled={loadingAction}
                className="clay-btn clay-btn-danger px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl"
              >
                {loadingAction ? 'Ending...' : 'Yes, End Workday'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 6: REOPEN TASK (REASON REQUIRED) */}
      {/* ======================================================== */}
      {showReopenModal && (
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-7 max-w-md w-full">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <RotateCcw size={16} className="text-amber-600" />
                <span>Reopen Completed Task</span>
              </h3>
              <button onClick={() => setShowReopenModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleReopenTaskSubmit} className="space-y-4 pt-3">
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Reopening this task will reset its status to <strong>In Progress</strong> and allow you to log further time.
                A mandatory reason is required to maintain audit history.
              </p>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Reason for Reopening <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Additional client feedback received; bug fixes required..."
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  className="clay-input w-full p-3 text-sm font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReopenModal(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="clay-btn bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 text-xs sm:text-sm font-bold rounded-xl shadow-xs"
                >
                  {loadingAction ? 'Reopening...' : 'Confirm Reopen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 7: ADD PROGRESS NOTE */}
      {/* ======================================================== */}
      {/* ======================================================== */}
      {/* MODAL: CHROME EXTENSION DOWNLOAD & INSTRUCTIONS */}
      {/* ======================================================== */}
      {showExtensionModal && (
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-7 max-w-lg w-full">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                  <Puzzle size={18} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Knowletive Chrome Extension</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Centralized Time Tracking for Google Chrome & Brave</p>
                </div>
              </div>
              <button
                onClick={() => setShowExtensionModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="my-5 space-y-4">
              <div className="p-3.5 bg-indigo-50/80 border border-indigo-100 rounded-xl space-y-1 text-xs">
                <div className="flex items-center justify-between font-bold text-indigo-950">
                  <span>Backend Connection</span>
                  <span className="clay-pill clay-pill-emerald text-[10px] py-0 px-1.5">Production Centralized</span>
                </div>
                <p className="text-[11px] text-indigo-700 font-mono break-all">
                  https://timetracker-api.knowletive.in
                </p>
                <p className="text-[11px] text-slate-600 pt-1">
                  Pre-configured to sync all work sessions, breaks, and daily progress to the central database.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Step-by-Step Installation</h4>
                <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                  <li>
                    <strong>Download</strong> the extension package using the button below and extract the ZIP file on your computer.
                  </li>
                  <li>
                    Open Google Chrome and navigate to <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-indigo-600 text-[11px]">chrome://extensions</span> in your address bar.
                  </li>
                  <li>
                    Toggle <strong>Developer mode</strong> ON in the top right corner.
                  </li>
                  <li>
                    Click the <strong>Load unpacked</strong> button in the top left and select the extracted folder.
                  </li>
                  <li>
                    Click the Knowletive puzzle icon on your Chrome toolbar, sign in with your employee email/username, and begin tracking!
                  </li>
                </ol>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-400 font-medium">Package: knowletive-extension.zip (v1.0.0)</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowExtensionModal(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2 text-xs font-semibold rounded-xl"
                >
                  Close
                </button>
                <a
                  href="/knowletive-extension.zip"
                  download="knowletive-extension.zip"
                  className="clay-btn clay-btn-primary px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5"
                >
                  <Download size={14} />
                  <span>Download Extension (.zip)</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNoteModal && (
        <div className="clay-modal-overlay">
          <div className="clay-modal-dialog p-6 sm:p-7 max-w-md w-full">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <MessageSquare size={16} className="text-indigo-600" />
                <span>Add Task Progress Note</span>
              </h3>
              <button onClick={() => setShowNoteModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddNoteSubmit} className="space-y-4 pt-3">
              <p className="text-xs text-slate-600 leading-relaxed font-medium">
                Record a progress note explaining work done, obstacles, or remaining steps on this task.
              </p>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Progress Note <span className="text-rose-500 font-bold">* Required</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Completed unit tests and API integration; pending UI review..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="clay-input w-full p-3 text-sm font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="clay-btn clay-btn-secondary px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="clay-btn clay-btn-primary px-5 py-2 text-xs sm:text-sm font-semibold rounded-xl"
                >
                  {loadingAction ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
