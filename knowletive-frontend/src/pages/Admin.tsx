import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, Download, LogOut, Clock, Shield, Search, 
  Plus, Edit2, AlertTriangle, FileSpreadsheet,
  Settings as SettingsIcon, Calendar,
  FolderKanban, ListTodo, RefreshCw, KeyRound, Copy,
  CheckCircle2, UserCheck, UserX, Bell, Link2, TrendingUp,
  X, Filter, CheckCircle
} from 'lucide-react';
import api from '../lib/api';
import DailyTaskAnalyticsDashboard from '../components/DailyTaskAnalyticsDashboard';
import RechartsAnalyticsDashboard from '../components/RechartsAnalyticsDashboard';
import { formatHumanReadableDuration } from '../utils/formatters';

function getTodayIsoDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function Admin() {
  const [activeTab, setActiveTab] = useState<'attendance' | 'tasks' | 'analytics' | 'reports' | 'users' | 'invitations' | 'settings'>('attendance');
  
  // Overview data
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Attendance local search & filter
  const [attendanceSearch, setAttendanceSearch] = useState<string>('');
  const [attendanceDeptFilter, setAttendanceDeptFilter] = useState<string>('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<string>('ALL');

  // Invitations & Onboarding state
  const [invitationsList, setInvitationsList] = useState<any[]>([]);
  const [showCreateInviteModal, setShowCreateInviteModal] = useState<boolean>(false);
  const [inviteFormData, setInviteFormData] = useState({
    recipient_email: '',
    days_valid: 7,
    notes: '',
    code: ''
  });
  const [createdInviteResult, setCreatedInviteResult] = useState<any>(null);
  const [copyFeedback, setCopyFeedback] = useState<string>('');

  // Admin Notifications
  const [notificationsList, setNotificationsList] = useState<any[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState<boolean>(false);

  // Daily Tasks Report state & filters
  const [taskReportDate, setTaskReportDate] = useState<string>(getTodayIsoDate());
  const [taskFilterEmpId, setTaskFilterEmpId] = useState<string>('');
  const [taskFilterProject, setTaskFilterProject] = useState<string>('');
  const [taskReportData, setTaskReportData] = useState<any>({
    date: getTodayIsoDate(),
    tasks: [],
    by_employee: [],
    by_project_and_employee: [],
    summary: { total_tasks: 0, active_in_progress: 0, completed: 0, total_seconds: 0, total_hours: 0 }
  });
  const [loadingTaskReport, setLoadingTaskReport] = useState<boolean>(false);
  
  // Reports filter & data
  const [reports, setReports] = useState<any[]>([]);
  const [reportsSummary, setReportsSummary] = useState<any>(null);
  const [reportDateMode, setReportDateMode] = useState<'range' | 'month'>('range');
  const [reportYear, setReportYear] = useState<string>('2026');
  const [reportMonth, setReportMonth] = useState<string>('10');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [filterDept, setFilterDept] = useState<string>('');
  const [filterEmpId, setFilterEmpId] = useState<string>('');
  const [reportFilterProject, setReportFilterProject] = useState<string>('');
  const [reportFilterTask, setReportFilterTask] = useState<string>('');

  // User management data & modal
  const [usersList, setUsersList] = useState<any[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);
  const [editUserData, setEditUserData] = useState<any>(null);
  const [userFormData, setUserFormData] = useState({
    username: '',
    first_name: '',
    last_name: '',
    email: '',
    department: '',
    role: 'EMPLOYEE',
    password: ''
  });

  // Correction modal
  const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
  const [correctionForm, setCorrectionForm] = useState({
    event_id: '',
    new_event_type: 'START_WORK',
    new_timestamp: '',
    reason: ''
  });

  // Settings form
  const [settingsForm, setSettingsForm] = useState({
    work_start_time: '10:00',
    work_end_time: '19:00',
    timezone: 'Asia/Kolkata'
  });

  const navigate = useNavigate();
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  useEffect(() => {
    if (currentUser.role !== 'ADMIN') {
      navigate('/');
      return;
    }
    loadAllAdminData();
  }, [currentUser, navigate]);

  const loadAllAdminData = async () => {
    setLoading(true);
    try {
      const [dashRes, usersRes, settingsRes, invRes, notifRes] = await Promise.all([
        api.get('/admin/dashboard/'),
        api.get('/admin/users/'),
        api.get('/settings/'),
        api.get('/admin/invitations/').catch(() => ({ data: { invitations: [] } })),
        api.get('/admin/notifications/').catch(() => ({ data: { notifications: [], unread_count: 0 } }))
      ]);
      setDashboardData(dashRes.data);
      setUsersList(usersRes.data.users || []);
      if (settingsRes.data) {
        setSettingsForm(settingsRes.data);
      }
      setInvitationsList(invRes.data?.invitations || []);
      setNotificationsList(notifRes.data?.notifications || []);
      setUnreadNotifCount(notifRes.data?.unread_count || 0);
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to load administrator data.');
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    try {
      const params = new URLSearchParams();
      if (reportDateMode === 'month') {
        params.append('year', reportYear);
        params.append('month', reportMonth);
      } else {
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
      }
      if (filterDept) params.append('department', filterDept);
      if (filterEmpId) params.append('employee_id', filterEmpId);
      if (reportFilterProject) params.append('project', reportFilterProject);
      if (reportFilterTask) params.append('task', reportFilterTask);
      
      const res = await api.get(`/admin/reports/?${params.toString()}`);
      setReports(res.data.reports || []);
      setReportsSummary(res.data.summary || null);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to fetch reports.');
    }
  };

  useEffect(() => {
    if (activeTab === 'reports') {
      loadReports();
    }
  }, [activeTab, reportDateMode, reportYear, reportMonth, startDate, endDate, filterDept, filterEmpId, reportFilterProject, reportFilterTask]);

  const loadTaskReport = async () => {
    setLoadingTaskReport(true);
    try {
      const params = new URLSearchParams();
      if (taskReportDate) params.append('date', taskReportDate);
      if (taskFilterEmpId) params.append('employee_id', taskFilterEmpId);
      if (taskFilterProject) params.append('project', taskFilterProject);

      const res = await api.get(`/admin/tasks/report/?${params.toString()}`);
      setTaskReportData(res.data);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to fetch daily task report.');
    } finally {
      setLoadingTaskReport(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'tasks') {
      loadTaskReport();
    }
  }, [activeTab, taskReportDate, taskFilterEmpId, taskFilterProject]);

  const handleExportTasks = (format: 'csv' | 'xlsx') => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    params.append('format', format);
    if (taskReportDate) params.append('date', taskReportDate);
    if (taskFilterEmpId) params.append('employee_id', taskFilterEmpId);
    if (taskFilterProject) params.append('project', taskFilterProject);

    const url = `http://localhost:8000/api/admin/tasks/export/?${params.toString()}`;
    fetch(url, {
      headers: { Authorization: `Token ${token}` }
    })
      .then(res => res.blob())
      .then(blob => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `daily_tasks_report_${taskReportDate || 'all'}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(() => setErrorMsg('Failed to download daily task export.'));
  };

  const handleExport = (format: 'csv' | 'xlsx') => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    params.append('format', format);
    if (reportDateMode === 'month') {
      params.append('year', reportYear);
      params.append('month', reportMonth);
    } else {
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
    }
    if (filterDept) params.append('department', filterDept);
    if (filterEmpId) params.append('employee_id', filterEmpId);
    if (reportFilterProject) params.append('project', reportFilterProject);
    if (reportFilterTask) params.append('task', reportFilterTask);

    let empNamePrefix = 'All_Employees';
    if (filterEmpId) {
      const selectedEmp = usersList.find(u => String(u.id) === String(filterEmpId) || String(u.employee_id) === String(filterEmpId));
      if (selectedEmp) {
        const cleanName = (selectedEmp.name || selectedEmp.username || 'Employee')
          .trim()
          .replace(/[^A-Za-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        if (cleanName) empNamePrefix = cleanName;
      }
    } else if (employeeOnlyList.length === 1) {
      const singleEmp = employeeOnlyList[0];
      const cleanName = (singleEmp.name || singleEmp.username || 'Employee')
        .trim()
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (cleanName) empNamePrefix = cleanName;
    }

    let dateRangeStr = '';
    if (reportDateMode === 'month') {
      const y = parseInt(reportYear, 10) || new Date().getFullYear();
      const m = parseInt(reportMonth, 10) || (new Date().getMonth() + 1);
      const lastDay = new Date(y, m, 0).getDate();
      const mPad = String(m).padStart(2, '0');
      dateRangeStr = `${y}-${mPad}-01_to_${y}-${mPad}-${String(lastDay).padStart(2, '0')}`;
    } else if (startDate && endDate) {
      dateRangeStr = `${startDate}_to_${endDate}`;
    } else if (startDate) {
      dateRangeStr = `${startDate}_to_${startDate}`;
    } else {
      const today = new Date();
      const past7 = new Date();
      past7.setDate(today.getDate() - 6);
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      dateRangeStr = `${fmt(past7)}_to_${fmt(today)}`;
    }

    const defaultFilename = `${empNamePrefix}_Time_Report_${dateRangeStr}.${format}`;
    const url = `http://localhost:8000/api/admin/reports/export/?${params.toString()}`;
    
    fetch(url, {
      headers: { Authorization: `Token ${token}` }
    })
      .then(res => {
        let filename = defaultFilename;
        const disposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
        if (disposition && disposition.indexOf('filename=') !== -1) {
          const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
          if (matches != null && matches[1]) {
            filename = matches[1].replace(/['"]/g, '').trim();
          }
        }
        return res.blob().then(blob => ({ blob, filename }));
      })
      .then(({ blob, filename }) => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
      })
      .catch(() => setErrorMsg('Failed to download export.'));
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editUserData) {
        await api.patch(`/admin/users/${editUserData.id}/`, userFormData);
      } else {
        const payload = {
          ...userFormData,
          username: (userFormData.username || userFormData.email || `${userFormData.first_name.toLowerCase()}`).trim()
        };
        await api.post('/admin/users/', payload);
      }
      setShowAddUserModal(false);
      setEditUserData(null);
      setUserFormData({ username: '', first_name: '', last_name: '', email: '', department: '', role: 'EMPLOYEE', password: '' });
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to save user details.');
    }
  };

  const handleToggleUserActive = async (user: any) => {
    try {
      await api.patch(`/admin/users/${user.id}/`, { is_active: !user.is_active });
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg('Failed to change user status.');
    }
  };

  const handleApproveUser = async (userId: number) => {
    try {
      await api.post(`/admin/users/${userId}/approve/`);
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to approve user.');
    }
  };

  const handleRejectUser = async (userId: number) => {
    if (!window.confirm('Are you sure you want to reject this employee registration request?')) return;
    try {
      await api.post(`/admin/users/${userId}/reject/`);
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to reject user.');
    }
  };

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/admin/invitations/', inviteFormData);
      setCreatedInviteResult(res.data.invitation);
      setShowCreateInviteModal(false);
      setInviteFormData({ recipient_email: '', days_valid: 7, notes: '', code: '' });
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to create invitation.');
    }
  };

  const handleRevokeInvitation = async (invId: number) => {
    if (!window.confirm('Are you sure you want to revoke this invitation code? It will no longer allow any signups.')) return;
    try {
      await api.post(`/admin/invitations/${invId}/revoke/`);
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to revoke invitation.');
    }
  };

  const handleMarkNotificationsRead = async () => {
    try {
      await api.post('/admin/notifications/read/');
      loadAllAdminData();
    } catch {
      // ignore
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`${label} copied!`);
    setTimeout(() => setCopyFeedback(''), 2500);
  };

  const pendingUsers = useMemo(() => {
    return usersList.filter((u) => u.approval_status === 'PENDING');
  }, [usersList]);

  // Only users with Employee role for tracking dropdowns
  const employeeOnlyList = useMemo(() => {
    return usersList.filter((u) => u.role === 'EMPLOYEE');
  }, [usersList]);

  // Department options from users list
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    usersList.forEach(u => {
      if (u.department && u.department.trim()) set.add(u.department.trim());
    });
    return Array.from(set).sort();
  }, [usersList]);

  // Filtered live attendance
  const filteredAttendanceUsers = useMemo(() => {
    const employees = dashboardData?.users?.filter((u: any) => u.role === 'EMPLOYEE') || [];
    return employees.filter((u: any) => {
      const matchesSearch = !attendanceSearch || 
        (u.name && u.name.toLowerCase().includes(attendanceSearch.toLowerCase())) ||
        (u.email && u.email.toLowerCase().includes(attendanceSearch.toLowerCase())) ||
        (u.employee_id && u.employee_id.toLowerCase().includes(attendanceSearch.toLowerCase()));
      
      const matchesDept = !attendanceDeptFilter || u.department === attendanceDeptFilter;

      const matchesStatus = attendanceStatusFilter === 'ALL' ||
        (attendanceStatusFilter === 'WORKING' && u.status === 'Working') ||
        (attendanceStatusFilter === 'BREAK' && u.status === 'On Break') ||
        (attendanceStatusFilter === 'ENDED' && u.status === 'Ended') ||
        (attendanceStatusFilter === 'NOT_STARTED' && (!u.status || u.status === 'Not Started'));

      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [dashboardData, attendanceSearch, attendanceDeptFilter, attendanceStatusFilter]);

  // Filtered user roster
  const filteredUsersList = useMemo(() => {
    if (!userSearchQuery.trim()) return usersList;
    const q = userSearchQuery.toLowerCase();
    return usersList.filter(u => 
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q)) ||
      (u.employee_id && u.employee_id.toLowerCase().includes(q)) ||
      (u.username && u.username.toLowerCase().includes(q))
    );
  }, [usersList, userSearchQuery]);

  const handleApplyCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionForm.reason.trim()) {
      setErrorMsg('A detailed reason is strictly mandatory for admin corrections.');
      return;
    }
    try {
      await api.post('/admin/corrections/', correctionForm);
      setShowCorrectionModal(false);
      setCorrectionForm({ event_id: '', new_event_type: 'START_WORK', new_timestamp: '', reason: '' });
      loadAllAdminData();
      alert('Correction successfully applied.');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Correction failed.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/settings/', settingsForm);
      alert('Office schedule settings updated successfully.');
      loadAllAdminData();
    } catch (err: any) {
      setErrorMsg('Failed to update settings.');
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout/');
    } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const overview = dashboardData?.overview || {};

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans">
      {/* Admin Navbar */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40 px-4 sm:px-8 py-3 transition-all shadow-2xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Brand & Badge */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-teal-500 flex items-center justify-center text-white shadow-xs ring-4 ring-blue-50">
              <Shield size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base text-slate-900 tracking-tight">Knowletive</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/70 font-bold uppercase tracking-wider">
                  Admin Console
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">Enterprise Time & Attendance Hub</p>
            </div>
          </div>

          {/* Quick Actions & Profile */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* User Profile Chip */}
            <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/70">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : 'A'}
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-800 leading-tight">{currentUser.name || 'Admin'}</p>
                <p className="text-[11px] text-slate-500 leading-tight font-mono">{currentUser.email || 'admin@knowletive.com'}</p>
              </div>
            </div>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifDropdown(!showNotifDropdown);
                  if (unreadNotifCount > 0) handleMarkNotificationsRead();
                }}
                className="relative p-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 shadow-2xs transition"
                title="Admin Notifications"
                aria-label="Admin Notifications"
              >
                <Bell size={17} />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white animate-pulse">
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-50 text-xs">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Bell size={14} className="text-blue-600" />
                      Notifications
                    </span>
                    {notificationsList.length > 0 && (
                      <button
                        onClick={handleMarkNotificationsRead}
                        className="text-[11px] text-blue-600 hover:underline font-semibold"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {notificationsList.length === 0 ? (
                      <p className="text-slate-400 py-6 text-center italic">No new notifications</p>
                    ) : (
                      notificationsList.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3 rounded-xl border transition ${
                            n.is_read
                              ? 'bg-slate-50/70 border-slate-200/60 text-slate-600'
                              : 'bg-blue-50/60 border-blue-200/80 text-slate-800'
                          }`}
                        >
                          <p className="font-bold text-slate-900 text-xs">{n.title}</p>
                          <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                          <p className="text-[10px] text-slate-400 mt-1.5 font-mono">{n.created_at?.slice(0, 16).replace('T', ' ')}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Timesheet Quick Link */}
            <button
              onClick={() => navigate('/timesheet')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-teal-50/80 hover:bg-teal-100 text-teal-800 border border-teal-200/80 transition shadow-2xs"
            >
              <Calendar size={15} className="text-teal-600" />
              <span className="hidden md:inline">Timesheets</span>
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-700 border border-slate-200 hover:border-rose-200 transition shadow-2xs"
              title="Sign Out"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Copy Feedback Toast */}
        {copyFeedback && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-emerald-800 text-xs shadow-xs animate-in fade-in slide-in-from-top-2">
            <CheckCircle size={16} className="text-emerald-600 shrink-0" />
            <span className="font-semibold">{copyFeedback}</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between gap-3 text-rose-800 text-sm shadow-xs animate-in fade-in">
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="shrink-0 text-rose-600" />
              <span className="font-medium text-xs sm:text-sm">{errorMsg}</span>
            </div>
            <button 
              onClick={() => setErrorMsg('')} 
              className="text-xs text-rose-700 hover:text-rose-900 font-bold underline shrink-0 px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Top KPI Cards - Modern Stat Badges */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Total Employees */}
          <div className="bg-white border border-slate-200/80 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs hover:border-blue-200 transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase font-bold text-slate-500 tracking-wider">Total Staff</span>
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Users size={16} />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{overview.total_employees ?? '--'}</p>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Registered workforce</p>
          </div>

          {/* Active / Working Now */}
          <div className="bg-white border border-emerald-200/70 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs hover:border-emerald-300 transition">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] uppercase font-bold text-emerald-700 tracking-wider">Working Now</span>
              </div>
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Clock size={16} />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-700 tracking-tight">{overview.active_now ?? '--'}</p>
            <p className="text-[11px] text-emerald-600 mt-1 font-medium">Currently clocked-in</p>
          </div>

          {/* Late Starts Today */}
          <div className="bg-white border border-amber-200/70 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs hover:border-amber-300 transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase font-bold text-amber-700 tracking-wider">Late Today</span>
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle size={16} />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight">{overview.late_today ?? '0'}</p>
            <p className="text-[11px] text-amber-600/90 mt-1 font-medium">Started past schedule</p>
          </div>

          {/* Missing Clock-Outs */}
          <div className="bg-white border border-rose-200/70 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs hover:border-rose-300 transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase font-bold text-rose-700 tracking-wider">Missing Clock-Out</span>
              <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <Clock size={16} />
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-rose-600 tracking-tight">{overview.missing_clockouts ?? '0'}</p>
            <p className="text-[11px] text-rose-600/90 mt-1 font-medium">Requires correction</p>
          </div>
        </div>

        {/* Clean Segmented Navigation Tabs */}
        <div className="bg-white p-1.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              onClick={() => setActiveTab('attendance')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'attendance'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Clock size={16} />
              <span>Live Attendance</span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'analytics'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <TrendingUp size={16} />
              <span>Analytics Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'tasks'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FolderKanban size={16} />
              <span>Daily Task Reports</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'reports'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FileSpreadsheet size={16} />
              <span>Reports & Exports</span>
            </button>

            <button
              onClick={() => setActiveTab('users')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'users'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Users size={16} />
              <span>User Management</span>
              {pendingUsers.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black">
                  {pendingUsers.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('invitations')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'invitations'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <KeyRound size={16} />
              <span>Invitations</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition shrink-0 ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <SettingsIcon size={16} />
              <span>Schedule Settings</span>
            </button>
          </div>
        </div>

        {/* TAB 1: LIVE ATTENDANCE (EMPLOYEES ONLY) */}
        {activeTab === 'attendance' && (
          <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
            {/* Tab Header with Title & Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Today's Employee Attendance</h3>
                <p className="text-xs text-slate-500 font-medium">Real-time work sessions, shift progress, and clock events for staff</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  onClick={() => setShowCorrectionModal(true)}
                  className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-2xs"
                >
                  <Edit2 size={14} />
                  <span>Time Correction</span>
                </button>
                <button
                  onClick={loadAllAdminData}
                  disabled={loading}
                  className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition"
                  title="Refresh attendance"
                >
                  <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Attendance Filter Strip */}
            <div className="flex flex-col sm:flex-row gap-3 pt-1 pb-1">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, email, or employee ID..."
                  value={attendanceSearch}
                  onChange={(e) => setAttendanceSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={attendanceDeptFilter}
                  onChange={(e) => setAttendanceDeptFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                >
                  <option value="">All Departments</option>
                  {departmentOptions.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>

                <select
                  value={attendanceStatusFilter}
                  onChange={(e) => setAttendanceStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="WORKING">Working</option>
                  <option value="BREAK">On Break</option>
                  <option value="ENDED">Ended</option>
                  <option value="NOT_STARTED">Not Started</option>
                </select>

                {(attendanceSearch || attendanceDeptFilter || attendanceStatusFilter !== 'ALL') && (
                  <button
                    onClick={() => {
                      setAttendanceSearch('');
                      setAttendanceDeptFilter('');
                      setAttendanceStatusFilter('ALL');
                    }}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
                    title="Clear filters"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Attendance Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-50/80 font-bold">
                    <th className="py-3 px-3.5">Emp ID</th>
                    <th className="py-3 px-3.5">Employee</th>
                    <th className="py-3 px-3.5">Department</th>
                    <th className="py-3 px-3.5">Status</th>
                    <th className="py-3 px-3.5">Clock-In (IST)</th>
                    <th className="py-3 px-3.5">Clock-Out (IST)</th>
                    <th className="py-3 px-3.5 text-right">Work Time</th>
                    <th className="py-3 px-3.5 text-right">Break Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAttendanceUsers.map((u: any) => (
                    <tr key={u.id} className="hover:bg-slate-50/80 transition text-xs">
                      <td className="py-3 px-3.5">
                        <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/80">
                          {u.employee_id || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-3.5">
                        <p className="font-bold text-slate-900 text-xs sm:text-sm">{u.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{u.email}</p>
                      </td>
                      <td className="py-3 px-3.5 text-slate-600 font-medium">
                        {u.department || 'General'}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 ${
                            u.status === 'Working' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            u.status === 'On Break' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                            u.status === 'Ended' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {u.status === 'Working' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                            {u.status === 'On Break' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                            {u.status || 'Not Started'}
                          </span>
                          {u.is_late_start && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              Late Start
                            </span>
                          )}
                          {u.is_missing_clockout && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              Missing Out
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-slate-700 font-medium">
                        {u.start_time ? new Date(u.start_time).toLocaleTimeString() : '--:--'}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-slate-700 font-medium">
                        {u.end_time ? new Date(u.end_time).toLocaleTimeString() : '--:--'}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-emerald-700 text-right font-bold">
                        {formatHumanReadableDuration(u.total_work_seconds || 0)}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-amber-700 text-right font-bold">
                        {formatHumanReadableDuration(u.total_break_seconds || 0)}
                      </td>
                    </tr>
                  ))}
                  {filteredAttendanceUsers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400">
                        <Users size={28} className="mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold text-slate-600">No employee attendance matches your search.</p>
                        <p className="text-xs text-slate-400 mt-0.5">Try clearing your filters or check back later.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: DAILY TIME-WISE TASK REPORTS (EMPLOYEES ONLY) */}
        {activeTab === 'tasks' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
              {/* Header with Title & Export Actions */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Daily Employee Task Reports</h3>
                  <p className="text-xs text-slate-500 font-medium">Track recorded work sessions, project activities, and duration logs</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExportTasks('csv')}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 transition shadow-2xs"
                  >
                    <Download size={14} />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={() => handleExportTasks('xlsx')}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition"
                  >
                    <Download size={14} />
                    <span>Export Excel (.xlsx)</span>
                  </button>
                </div>
              </div>

              {/* Filters Bar: Date, Employee, Project */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Date (IST)</label>
                  <input
                    type="date"
                    value={taskReportDate}
                    onChange={(e) => setTaskReportDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Filter Employee</label>
                  <select
                    value={taskFilterEmpId}
                    onChange={(e) => setTaskFilterEmpId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  >
                    <option value="">All Employees</option>
                    {employeeOnlyList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} {u.employee_id ? `[${u.employee_id}]` : `(${u.email})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Filter Project</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Website Redesign"
                      value={taskFilterProject}
                      onChange={(e) => setTaskFilterProject(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                    />
                    <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                  </div>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={() => loadTaskReport()}
                    disabled={loadingTaskReport}
                    className="w-full py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-2 transition shadow-2xs"
                  >
                    <RefreshCw size={14} className={loadingTaskReport ? 'animate-spin' : ''} />
                    <span>{loadingTaskReport ? 'Loading...' : 'Refresh Report'}</span>
                  </button>
                </div>
              </div>

              {/* Attractive Analytics Dashboard with Charts & Real-Time Analysis */}
              <DailyTaskAnalyticsDashboard
                data={taskReportData}
                filterDate={taskReportDate}
                filterEmpId={taskFilterEmpId}
                filterProject={taskFilterProject}
                onClearFilters={() => {
                  setTaskFilterEmpId('');
                  setTaskFilterProject('');
                }}
                onSetToday={() => {
                  setTaskReportDate(getTodayIsoDate());
                }}
                isLoading={loadingTaskReport}
              />

              {/* Detailed Tables & Aggregates (rendered when records exist) */}
              {taskReportData.tasks?.length > 0 && (
                <>
                  {/* Grouped Aggregates */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* 1. Time per Employee */}
                    <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Users size={15} className="text-blue-600" />
                        <span>Total Time per Employee</span>
                      </h4>
                      {taskReportData.by_employee?.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-2">No employee task activity found.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold">
                                <th className="pb-2">Emp ID</th>
                                <th className="pb-2">Employee</th>
                                <th className="pb-2">Dept</th>
                                <th className="pb-2 text-center">Tasks</th>
                                <th className="pb-2 text-right">Total Duration</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60">
                              {taskReportData.by_employee?.map((be: any, idx: number) => (
                                <tr key={idx}>
                                  <td className="py-2 font-mono text-xs font-bold text-blue-700">{be.employee_id || '-'}</td>
                                  <td className="py-2 font-semibold text-slate-800">{be.employee_name}</td>
                                  <td className="py-2 text-slate-500">{be.department || '-'}</td>
                                  <td className="py-2 text-center text-slate-700 font-mono">{be.tasks_count}</td>
                                  <td className="py-2 text-right font-mono font-bold text-blue-600">
                                    {formatHumanReadableDuration(be.total_seconds || Math.round(be.total_hours * 3600))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* 2. Grouped by Project & Employee */}
                    <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <FolderKanban size={15} className="text-teal-600" />
                        <span>Total Time Grouped by Project & Employee</span>
                      </h4>
                      {taskReportData.by_project_and_employee?.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-2">No project task activity found.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold">
                                <th className="pb-2">Project</th>
                                <th className="pb-2">Employee</th>
                                <th className="pb-2 text-center">Tasks</th>
                                <th className="pb-2 text-right">Total Duration</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60">
                              {taskReportData.by_project_and_employee?.map((pe: any, idx: number) => (
                                <tr key={idx}>
                                  <td className="py-2 font-semibold text-slate-800">
                                    <span className="px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200/70">
                                      {pe.project_name}
                                    </span>
                                  </td>
                                  <td className="py-2 text-slate-700">{pe.employee_name}</td>
                                  <td className="py-2 text-center text-slate-700 font-mono">{pe.tasks_count}</td>
                                  <td className="py-2 text-right font-mono font-bold text-emerald-600">
                                    {pe.duration_formatted}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detailed Employee Task Log Table */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <ListTodo size={15} className="text-blue-600" />
                      <span>Detailed Employee Task Log</span>
                    </h4>
                    <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-50/80 font-bold">
                            <th className="py-3 px-3">Sr.</th>
                            <th className="py-3 px-3">Emp ID</th>
                            <th className="py-3 px-3">Employee</th>
                            <th className="py-3 px-3">Project</th>
                            <th className="py-3 px-3">Task Name</th>
                            <th className="py-3 px-3">Description</th>
                            <th className="py-3 px-3">Start (IST)</th>
                            <th className="py-3 px-3">End (IST)</th>
                            <th className="py-3 px-3 text-right">Duration</th>
                            <th className="py-3 px-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {taskReportData.tasks?.map((t: any) => (
                            <tr key={t.task_log_id} className="hover:bg-slate-50/80 transition text-xs">
                              <td className="py-3 px-3 text-slate-400 font-mono">{t.sr_no}</td>
                              <td className="py-3 px-3 font-mono font-bold text-blue-700">
                                {t.employee_id || '-'}
                              </td>
                              <td className="py-3 px-3">
                                <p className="font-bold text-slate-900">{t.employee_name}</p>
                                <span className="text-[10px] text-slate-400">{t.department}</span>
                              </td>
                              <td className="py-3 px-3">
                                <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200/70 text-blue-700 font-semibold">
                                  {t.project_name}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-bold text-slate-900">{t.task_name}</td>
                              <td className="py-3 px-3 text-slate-500 max-w-xs truncate" title={t.description}>
                                {t.description || '-'}
                              </td>
                              <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">{t.start_time}</td>
                              <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                                {t.end_time === 'In progress' ? (
                                  <span className="text-amber-700 font-bold italic">In Progress</span>
                                ) : (
                                  t.end_time
                                )}
                              </td>
                              <td className="py-3 px-3 font-mono text-blue-600 font-bold text-right whitespace-nowrap">
                                {t.duration_formatted}
                              </td>
                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                  t.status === 'IN_PROGRESS'
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                }`}>
                                  {t.status === 'IN_PROGRESS' ? 'In Progress' : 'Completed'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SEPARATE DEDICATED ANALYTICS DASHBOARD MODULE */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <RechartsAnalyticsDashboard
              onNavigateToTimesheet={() => navigate('/timesheet')}
              showTitle={true}
            />
          </div>
        )}

        {/* TAB 4: REPORTS & EXPORTS (EMPLOYEES ONLY) */}
        {activeTab === 'reports' && (
          <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Attendance & Task Reports</h3>
                <p className="text-xs text-slate-500 font-medium">Generate verified payroll and attendance records for all staff (IST)</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport('csv')}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 transition shadow-2xs"
                >
                  <Download size={14} />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={() => handleExport('xlsx')}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition"
                >
                  <FileSpreadsheet size={14} />
                  <span>Export Excel (.xlsx)</span>
                </button>
              </div>
            </div>

            {/* Summary KPI Cards matching screen and export */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="bg-blue-50/70 border border-blue-100 p-4 rounded-2xl">
                <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">Filtered Records</p>
                <p className="text-2xl font-black text-blue-950 mt-1">{reportsSummary?.total_records ?? reports.length}</p>
                <p className="text-[11px] text-blue-600/80 mt-0.5">Workdays in current report view</p>
              </div>
              <div className="bg-emerald-50/70 border border-emerald-100 p-4 rounded-2xl">
                <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Total Work Duration</p>
                <p className="text-2xl font-black text-emerald-950 mt-1">
                  {formatHumanReadableDuration(reportsSummary?.total_work_seconds || 0)}
                </p>
                <p className="text-[11px] text-emerald-600/80 mt-0.5">Sum of all tracked active work</p>
              </div>
              <div className="bg-amber-50/70 border border-amber-100 p-4 rounded-2xl">
                <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Total Break Duration</p>
                <p className="text-2xl font-black text-amber-950 mt-1">
                  {formatHumanReadableDuration(reportsSummary?.total_break_seconds || 0)}
                </p>
                <p className="text-[11px] text-amber-600/80 mt-0.5">Sum of all logged pause intervals</p>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200/80">
                <div className="flex items-center gap-2">
                  <Filter size={14} className="text-blue-600" />
                  <span className="text-xs font-bold text-slate-700">Filter Period:</span>
                  <div className="inline-flex rounded-xl bg-slate-200/70 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setReportDateMode('range')}
                      className={`px-3 py-1 rounded-lg font-bold transition ${reportDateMode === 'range' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Date Range
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportDateMode('month')}
                      className={`px-3 py-1 rounded-lg font-bold transition ${reportDateMode === 'month' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Specific Month
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setFilterDept('');
                    setFilterEmpId('');
                    setReportFilterProject('');
                    setReportFilterTask('');
                    setReportDateMode('range');
                  }}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 underline"
                >
                  Clear All Filters
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {reportDateMode === 'range' ? (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Month</label>
                      <select
                        value={reportMonth}
                        onChange={(e) => setReportMonth(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      >
                        <option value="1">January</option>
                        <option value="2">February</option>
                        <option value="3">March</option>
                        <option value="4">April</option>
                        <option value="5">May</option>
                        <option value="6">June</option>
                        <option value="7">July</option>
                        <option value="8">August</option>
                        <option value="9">September</option>
                        <option value="10">October</option>
                        <option value="11">November</option>
                        <option value="12">December</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Year</label>
                      <input
                        type="number"
                        value={reportYear}
                        onChange={(e) => setReportYear(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Employee</label>
                  <select
                    value={filterEmpId}
                    onChange={(e) => setFilterEmpId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  >
                    <option value="">All Employees</option>
                    {employeeOnlyList.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.employee_id || u.email})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Department</label>
                  <input
                    type="text"
                    placeholder="e.g. Engineering"
                    value={filterDept}
                    onChange={(e) => setFilterDept(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Project</label>
                  <input
                    type="text"
                    placeholder="Filter project..."
                    value={reportFilterProject}
                    onChange={(e) => setReportFilterProject(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Task</label>
                  <input
                    type="text"
                    placeholder="Filter task..."
                    value={reportFilterTask}
                    onChange={(e) => setReportFilterTask(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
              </div>
            </div>

            {/* Reports Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-50/80 font-bold">
                    <th className="py-3 px-3">Date (IST)</th>
                    <th className="py-3 px-3">Emp ID</th>
                    <th className="py-3 px-3">Employee</th>
                    <th className="py-3 px-3">Project</th>
                    <th className="py-3 px-3">Task Name</th>
                    <th className="py-3 px-3">Description</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Start Time</th>
                    <th className="py-3 px-3">End Time</th>
                    <th className="py-3 px-3 text-right">Work Time</th>
                    <th className="py-3 px-3 text-right">Break Time</th>
                    <th className="py-3 px-3 text-right">Total Daily Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-slate-400">
                        <FileSpreadsheet size={28} className="mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold text-slate-600">No report entries found for the selected period.</p>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {reports.map((r, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition text-xs">
                          <td className="py-3 px-3 text-slate-700 font-medium whitespace-nowrap">{r.date}</td>
                          <td className="py-3 px-3 font-mono font-bold text-blue-700 whitespace-nowrap">
                            {r.employee_id || '-'}
                          </td>
                          <td className="py-3 px-3">
                            <p className="text-slate-900 font-bold">{r.employee_name}</p>
                            <span className="text-[10px] text-slate-400">{r.department}</span>
                          </td>
                          <td className="py-3 px-3">
                            {r.project && r.project !== '-' ? (
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200/70 text-blue-700 font-semibold">
                                {r.project}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-800 font-medium">{r.task || '-'}</td>
                          <td className="py-3 px-3 text-slate-500 max-w-xs truncate" title={r.description}>
                            {r.description || '-'}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              r.status === 'Working' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                              r.status === 'On Break' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                              r.status === 'Ended' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">{r.start_time}</td>
                          <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">{r.end_time}</td>
                          <td className="py-3 px-3 font-mono text-emerald-700 text-right font-bold whitespace-nowrap">
                            {formatHumanReadableDuration(r.total_work_seconds || Math.round(r.work_hours * 3600))}
                          </td>
                          <td className="py-3 px-3 font-mono text-amber-700 text-right font-bold whitespace-nowrap">
                            {formatHumanReadableDuration(r.total_break_seconds || Math.round(r.break_hours * 3600))}
                          </td>
                          <td className="py-3 px-3 font-mono text-blue-700 text-right font-bold whitespace-nowrap">
                            {r.total_daily_duration || '-'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50/90 font-bold border-t-2 border-slate-200 text-xs">
                        <td colSpan={9} className="py-3.5 px-3 text-slate-800 uppercase tracking-wider text-right">
                          Report Totals:
                        </td>
                        <td className="py-3.5 px-3 font-mono text-emerald-700 text-right font-black whitespace-nowrap">
                          {formatHumanReadableDuration(reportsSummary?.total_work_seconds || 0)}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-amber-700 text-right font-black whitespace-nowrap">
                          {formatHumanReadableDuration(reportsSummary?.total_break_seconds || 0)}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-blue-700 text-right font-black whitespace-nowrap">
                          {reportsSummary?.total_daily_duration || '-'}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: USER MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Pending Approvals Section */}
            {pendingUsers.length > 0 && (
              <div className="bg-amber-50/80 border border-amber-200 rounded-3xl p-5 sm:p-7 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-amber-100 rounded-xl text-amber-800">
                      <UserCheck size={18} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-amber-950">
                        Pending Registrations ({pendingUsers.length})
                      </h3>
                      <p className="text-xs text-amber-700 font-medium">Review and verify new employee accounts</p>
                    </div>
                  </div>
                  <span className="text-xs text-amber-800 bg-amber-100 px-3 py-1 rounded-full font-bold border border-amber-200">
                    Awaiting Approval
                  </span>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-amber-200/70 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-amber-100 text-amber-900 text-[11px] uppercase tracking-wider bg-amber-50/60 font-bold">
                        <th className="py-3 px-3.5">Employee</th>
                        <th className="py-3 px-3.5">Email</th>
                        <th className="py-3 px-3.5">Registered</th>
                        <th className="py-3 px-3.5 text-right">Decision</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {pendingUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-amber-50/40 transition text-xs">
                          <td className="py-3 px-3.5 font-bold text-slate-900">{u.name}</td>
                          <td className="py-3 px-3.5 font-mono text-slate-600">{u.email}</td>
                          <td className="py-3 px-3.5 text-slate-500 font-mono">
                            {u.date_joined ? u.date_joined.slice(0, 16).replace('T', ' ') : '-'}
                          </td>
                          <td className="py-3 px-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleApproveUser(u.id)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition"
                              >
                                <UserCheck size={14} />
                                <span>Approve</span>
                              </button>
                              <button
                                onClick={() => handleRejectUser(u.id)}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition"
                              >
                                <UserX size={14} />
                                <span>Reject</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Main User Roster */}
            <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">User Management</h3>
                  <p className="text-xs text-slate-500 font-medium">Manage all employee and administrator credentials and permissions</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditUserData(null);
                      setUserFormData({ username: '', first_name: '', last_name: '', email: '', department: '', role: 'EMPLOYEE', password: '' });
                      setShowAddUserModal(true);
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-2xs transition"
                  >
                    <Plus size={16} />
                    <span>Add User</span>
                  </button>
                </div>
              </div>

              {/* User Search Bar */}
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search users by name, email, department, or employee ID..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-50/80 font-bold">
                      <th className="py-3 px-3.5">Emp ID</th>
                      <th className="py-3 px-3.5">Name & Email</th>
                      <th className="py-3 px-3.5">Department</th>
                      <th className="py-3 px-3.5">Role</th>
                      <th className="py-3 px-3.5">Approval</th>
                      <th className="py-3 px-3.5">Status</th>
                      <th className="py-3 px-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsersList.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/80 transition text-xs">
                        <td className="py-3.5 px-3.5">
                          {u.employee_id ? (
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/70">
                              {u.employee_id}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3.5">
                          <p className="font-bold text-slate-900 text-xs sm:text-sm">{u.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{u.email}</p>
                        </td>
                        <td className="py-3.5 px-3.5 text-slate-600 font-medium">{u.department || 'Unassigned'}</td>
                        <td className="py-3.5 px-3.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            u.role === 'ADMIN' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3.5 px-3.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            u.approval_status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : u.approval_status === 'PENDING'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-50 text-rose-700'
                          }`}>
                            {u.approval_status || 'APPROVED'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                          }`}>
                            {u.is_active ? 'Active' : 'Deactivated'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {u.approval_status === 'PENDING' && (
                              <>
                                <button
                                  onClick={() => handleApproveUser(u.id)}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition"
                                  title="Approve registration"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleRejectUser(u.id)}
                                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition"
                                  title="Reject registration"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => {
                                setEditUserData(u);
                                setUserFormData({
                                  username: u.username || '',
                                  first_name: u.first_name || '',
                                  last_name: u.last_name || '',
                                  email: u.email || '',
                                  department: u.department || '',
                                  role: u.role || 'EMPLOYEE',
                                  password: ''
                                });
                                setShowAddUserModal(true);
                              }}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                              title="Edit user"
                            >
                              <Edit2 size={13} />
                            </button>
                            {u.role !== 'ADMIN' && (
                              <button
                                onClick={() => handleToggleUserActive(u)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                                  u.is_active
                                    ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {u.is_active ? 'Deactivate' : 'Reactivate'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: INVITATIONS */}
        {activeTab === 'invitations' && (
          <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <KeyRound size={20} className="text-blue-600" />
                  <span>Company Invitations & Onboarding</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Generate secure single-use codes and invite links for private employee registration
                </p>
              </div>
              <button
                onClick={() => {
                  setCreatedInviteResult(null);
                  setShowCreateInviteModal(true);
                }}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-2xs transition self-start sm:self-auto"
              >
                <Plus size={16} />
                <span>Generate Invitation</span>
              </button>
            </div>

            {/* Newly Created Invitation Banner */}
            {createdInviteResult && (
              <div className="p-5 bg-blue-50/80 border border-blue-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    Invitation Code Generated Successfully
                  </span>
                  <button onClick={() => setCreatedInviteResult(null)} className="text-slate-500 hover:text-slate-800 text-xs font-bold">
                    Dismiss
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-white p-3.5 rounded-xl border border-blue-100 flex items-center justify-between shadow-2xs">
                    <div>
                      <p className="text-[11px] text-slate-500 uppercase font-bold">Invitation Code</p>
                      <p className="font-mono text-sm font-black text-slate-900 mt-0.5">{createdInviteResult.code}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(createdInviteResult.code, 'Invitation Code')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1 transition"
                    >
                      <Copy size={13} />
                      <span>Copy Code</span>
                    </button>
                  </div>
                  <div className="bg-white p-3.5 rounded-xl border border-blue-100 flex items-center justify-between shadow-2xs">
                    <div className="truncate mr-2">
                      <p className="text-[11px] text-slate-500 uppercase font-bold">Registration Link</p>
                      <p className="font-mono text-xs text-slate-600 mt-0.5 truncate">
                        {`${window.location.origin}/signup?code=${createdInviteResult.code}`}
                      </p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(`${window.location.origin}/signup?code=${createdInviteResult.code}`, 'Invitation Link')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1 shrink-0 transition"
                    >
                      <Link2 size={13} />
                      <span>Copy Link</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Invitations Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-50/80 font-bold">
                    <th className="py-3 px-3.5">Code</th>
                    <th className="py-3 px-3.5">Recipient Restriction</th>
                    <th className="py-3 px-3.5">Status</th>
                    <th className="py-3 px-3.5">Created / Expires</th>
                    <th className="py-3 px-3.5">Used By</th>
                    <th className="py-3 px-3.5">Notes</th>
                    <th className="py-3 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invitationsList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400 text-xs">
                        <KeyRound size={28} className="mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold text-slate-600">No invitations generated yet.</p>
                        <p className="text-slate-400 mt-0.5">Click "Generate Invitation" to invite new staff members.</p>
                      </td>
                    </tr>
                  ) : (
                    invitationsList.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 transition text-xs">
                        <td className="py-3.5 px-3.5 font-mono font-bold text-slate-900">
                          <span className="px-2 py-1 bg-slate-100 rounded-md border border-slate-200">
                            {inv.code}
                          </span>
                        </td>
                        <td className="py-3.5 px-3.5">
                          {inv.recipient_email ? (
                            <span className="text-slate-800 font-mono font-medium">{inv.recipient_email}</span>
                          ) : (
                            <span className="text-slate-400 italic">Anyone with code</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            inv.status === 'Active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : inv.status === 'Used'
                              ? 'bg-blue-50 text-blue-700'
                              : inv.status === 'Expired'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-3.5 text-slate-600 font-mono">
                          <div>Created: {inv.created_at ? inv.created_at.slice(0, 10) : '-'}</div>
                          {inv.expires_at && (
                            <div className="text-[11px] text-slate-400">Expires: {inv.expires_at.slice(0, 10)}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-3.5 text-slate-700 font-medium">
                          {inv.used_by || <span className="text-slate-400">-</span>}
                        </td>
                        <td className="py-3.5 px-3.5 text-slate-500 italic max-w-xs truncate">
                          {inv.notes || '-'}
                        </td>
                        <td className="py-3.5 px-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => copyToClipboard(inv.code, 'Invitation Code')}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                              title="Copy Code"
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              onClick={() => copyToClipboard(`${window.location.origin}/signup?code=${inv.code}`, 'Invitation Link')}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                              title="Copy Link"
                            >
                              <Link2 size={13} />
                            </button>
                            {inv.status === 'Active' && (
                              <button
                                onClick={() => handleRevokeInvitation(inv.id)}
                                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition"
                                title="Revoke Invitation"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 7: SCHEDULE SETTINGS */}
        {activeTab === 'settings' && (
          <div className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-xs max-w-xl">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-2xl bg-blue-50 text-blue-700 border border-blue-100">
                <SettingsIcon size={20} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Workday Schedule Settings</h3>
            </div>
            <p className="text-xs text-slate-500 font-medium mb-6">
              Configure daily business hours to compute employee late starts and punctuality metrics.
            </p>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Office Start Time (IST)
                </label>
                <input
                  type="time"
                  value={settingsForm.work_start_time}
                  onChange={(e) => setSettingsForm({ ...settingsForm, work_start_time: e.target.value })}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Office End Time (IST)
                </label>
                <input
                  type="time"
                  value={settingsForm.work_end_time}
                  onChange={(e) => setSettingsForm({ ...settingsForm, work_end_time: e.target.value })}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  System Timezone
                </label>
                <input
                  type="text"
                  disabled
                  value={settingsForm.timezone}
                  className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-sm cursor-not-allowed font-mono"
                />
              </div>

              <button
                type="submit"
                className="mt-4 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white font-bold rounded-xl text-sm transition shadow-2xs"
              >
                Save Schedule Settings
              </button>
            </form>
          </div>
        )}
      </main>

      {/* ADD / EDIT USER MODAL */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {editUserData ? 'Edit User Details' : 'Add New User'}
              </h3>
              <button
                onClick={() => setShowAddUserModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {editUserData && editUserData.employee_id && (
              <div className="mb-3.5 p-3 bg-blue-50/70 border border-blue-100 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-700 font-bold">Permanent Employee ID</span>
                  <p className="text-[11px] text-slate-500">Immutable across attendance logs</p>
                </div>
                <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-white text-blue-700 border border-blue-200 shadow-2xs">
                  {editUserData.employee_id}
                </span>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-3.5">
              {!editUserData && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Username / Sign-in ID</label>
                  <input
                    type="text"
                    placeholder="e.g. ayush or ayush@knowletive.com"
                    value={userFormData.username || ''}
                    onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">First Name</label>
                  <input
                    type="text"
                    value={userFormData.first_name}
                    onChange={(e) => setUserFormData({ ...userFormData, first_name: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={userFormData.last_name}
                    onChange={(e) => setUserFormData({ ...userFormData, last_name: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Work Email</label>
                <input
                  type="email"
                  placeholder="name@knowletive.com"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Department</label>
                <input
                  type="text"
                  placeholder="e.g. Design, Engineering"
                  value={userFormData.department}
                  onChange={(e) => setUserFormData({ ...userFormData, department: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Role</label>
                  <select
                    value={userFormData.role}
                    onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  >
                    <option value="EMPLOYEE">Employee</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {editUserData ? 'New Password (opt)' : 'Password'}
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={userFormData.password}
                    onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                    required={!editUserData}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition shadow-2xs"
                >
                  Save User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN TIME CORRECTION MODAL */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-slate-900">Employee Time Correction</h3>
              <button
                onClick={() => setShowCorrectionModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-500 font-medium mb-4">
              Authorized supervisor override for employee clock timestamps.
            </p>

            <form onSubmit={handleApplyCorrection} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Event ID</label>
                <input
                  type="text"
                  placeholder="Event UUID"
                  value={correctionForm.event_id}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, event_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Corrected Event</label>
                  <select
                    value={correctionForm.new_event_type}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, new_event_type: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  >
                    <option value="START_WORK">START_WORK</option>
                    <option value="START_BREAK">START_BREAK</option>
                    <option value="RESUME_WORK">RESUME_WORK</option>
                    <option value="END_WORK">END_WORK</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Corrected Timestamp</label>
                  <input
                    type="datetime-local"
                    value={correctionForm.new_timestamp}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, new_timestamp: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-rose-700 mb-1">
                  Reason for Correction * (Mandatory for audit trail)
                </label>
                <textarea
                  placeholder="Describe why this correction is necessary (e.g. employee forgot to clock out)..."
                  value={correctionForm.reason}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                  required
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCorrectionModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-2xs transition"
                >
                  Apply Correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GENERATE INVITATION MODAL */}
      {showCreateInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-100">
                  <KeyRound size={20} />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Generate Invitation</h3>
              </div>
              <button
                onClick={() => setShowCreateInviteModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-500 font-medium mb-5">
              Create a single-use onboarding invitation code or link for private employee registration.
            </p>

            <form onSubmit={handleCreateInvitation} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Recipient Work Email <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="employee@knowletive.com"
                  value={inviteFormData.recipient_email}
                  onChange={(e) => setInviteFormData({ ...inviteFormData, recipient_email: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
                <p className="text-[11px] text-slate-500 mt-1">If specified, only this email address can redeem the code.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Expiration
                  </label>
                  <select
                    value={inviteFormData.days_valid}
                    onChange={(e) => setInviteFormData({ ...inviteFormData, days_valid: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  >
                    <option value={1}>1 Day</option>
                    <option value={3}>3 Days</option>
                    <option value={7}>7 Days (Default)</option>
                    <option value={14}>14 Days</option>
                    <option value={30}>30 Days</option>
                    <option value={0}>No Expiry</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Custom Code <span className="text-slate-400 font-normal">(opt)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-generate"
                    value={inviteFormData.code}
                    onChange={(e) => setInviteFormData({ ...inviteFormData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 font-mono uppercase focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Notes / Department <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. For Q4 engineering hires"
                  value={inviteFormData.notes}
                  onChange={(e) => setInviteFormData({ ...inviteFormData, notes: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateInviteModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition shadow-2xs"
                >
                  Generate Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
