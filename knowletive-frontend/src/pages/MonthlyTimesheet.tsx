import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, ChevronLeft, ChevronRight, Save, Download, 
  FileSpreadsheet, ArrowLeft, Search, CheckCircle, 
  AlertCircle, ShieldCheck, UserCheck, Briefcase, TrendingUp
} from 'lucide-react';
import api from '../lib/api';
import { formatHumanReadableDuration } from '../utils/formatters';
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function MonthlyTimesheet() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const isAdmin = currentUser.role === 'ADMIN';

  // Navigation state (defaults to October 2026)
  const [currentYear, setCurrentYear] = useState<number>(2026);
  const [currentMonth, setCurrentMonth] = useState<number>(10);
  const [selectedUserId, setSelectedUserId] = useState<number | string>(currentUser.id || '');

  // Admin: list of employees for selector
  const [employeesList, setEmployeesList] = useState<any[]>([]);

  // Timesheet data
  const [timesheetData, setTimesheetData] = useState<any>(null);
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Search filters
  const [filterProject, setFilterProject] = useState<string>('');
  const [filterTask, setFilterTask] = useState<string>('');

  // Dirty state tracking for unsaved edits: { [dateStr]: { project_name, task_name, work_description } }
  const [dirtyRows, setDirtyRows] = useState<{ [date: string]: { project_name: string; task_name: string; work_description: string } }>({});
  const [savingDate, setSavingDate] = useState<string | null>(null);

  // Unsaved changes beforeunload handler
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(dirtyRows).length > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes on your timesheet. Are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirtyRows]);

  // Load employees for admin dropdown
  useEffect(() => {
    if (isAdmin) {
      api.get('/admin/users/')
        .then(res => {
          const onlyEmployees = (res.data.users || []).filter((u: any) => u.role === 'EMPLOYEE');
          setEmployeesList(onlyEmployees);
          if (onlyEmployees.length > 0 && (!selectedUserId || selectedUserId === currentUser.id)) {
            setSelectedUserId(onlyEmployees[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isAdmin, currentUser.id]);

  const fetchTimesheet = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = new URLSearchParams();
      params.append('year', currentYear.toString());
      params.append('month', currentMonth.toString());
      if (isAdmin && selectedUserId) {
        params.append('user_id', selectedUserId.toString());
      }
      if (filterProject) params.append('project', filterProject);
      if (filterTask) params.append('task', filterTask);

      const res = await api.get(`/timesheet/monthly/?${params.toString()}`);
      setTimesheetData(res.data);
      setDays(res.data.days || []);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to load timesheet records.');
    } finally {
      setLoading(false);
    }
  }, [currentYear, currentMonth, selectedUserId, isAdmin, filterProject, filterTask]);

  useEffect(() => {
    fetchTimesheet();
  }, [fetchTimesheet]);

  const handlePrevMonth = () => {
    if (Object.keys(dirtyRows).length > 0) {
      if (!confirm('You have unsaved changes. Discard and change month?')) return;
    }
    setDirtyRows({});
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (Object.keys(dirtyRows).length > 0) {
      if (!confirm('You have unsaved changes. Discard and change month?')) return;
    }
    setDirtyRows({});
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const handleFieldChange = (dateStr: string, field: 'project_name' | 'task_name' | 'work_description', value: string) => {
    // Find current day
    const dayItem = days.find(d => d.date === dateStr);
    const existingDirty = dirtyRows[dateStr] || {
      project_name: dayItem?.project_name || '',
      task_name: dayItem?.task_name || '',
      work_description: dayItem?.work_description || ''
    };

    const updatedDirty = {
      ...existingDirty,
      [field]: value
    };

    setDirtyRows(prev => ({
      ...prev,
      [dateStr]: updatedDirty
    }));

    // Optimistically update local day item for instant UI response
    setDays(prev => prev.map(d => {
      if (d.date === dateStr) {
        return { ...d, [field]: value };
      }
      return d;
    }));
  };

  const handleSaveRow = async (dateStr: string) => {
    const editData = dirtyRows[dateStr];
    if (!editData) return;

    setSavingDate(dateStr);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/timesheet/entry/', {
        date: dateStr,
        project_name: editData.project_name,
        task_name: editData.task_name,
        work_description: editData.work_description,
        user_id: isAdmin ? selectedUserId : undefined
      });

      // Clear dirty state for this row
      setDirtyRows(prev => {
        const nextState = { ...prev };
        delete nextState[dateStr];
        return nextState;
      });

      setSuccessMsg(`Timesheet entry for ${dateStr} saved successfully.`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to save timesheet entry.');
    } finally {
      setSavingDate(null);
    }
  };

  const handleSaveAll = async () => {
    const dateKeys = Object.keys(dirtyRows);
    if (dateKeys.length === 0) return;

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      for (const dStr of dateKeys) {
        const row = dirtyRows[dStr];
        await api.post('/timesheet/entry/', {
          date: dStr,
          project_name: row.project_name,
          task_name: row.task_name,
          work_description: row.work_description,
          user_id: isAdmin ? selectedUserId : undefined
        });
      }
      setDirtyRows({});
      setSuccessMsg(`All ${dateKeys.length} timesheet changes saved successfully.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchTimesheet();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to save some timesheet entries.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (format: 'csv' | 'xlsx') => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    params.append('format', format);
    params.append('year', currentYear.toString());
    params.append('month', currentMonth.toString());
    if (isAdmin && selectedUserId) {
      params.append('user_id', selectedUserId.toString());
    }
    if (filterProject) params.append('project', filterProject);
    if (filterTask) params.append('task', filterTask);

    const url = `http://localhost:8000/api/timesheet/export/?${params.toString()}`;
    fetch(url, {
      headers: { Authorization: `Token ${token}` }
    })
      .then(res => res.blob())
      .then(blob => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        const empName = timesheetData?.employee?.name?.replace(/\s+/g, '_') || 'Employee';
        a.download = `Timesheet_${empName}_${currentYear}_${currentMonth.toString().padStart(2, '0')}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(() => setErrorMsg('Export failed. Please check network.'));
  };

  const summary = timesheetData?.summary || {
    total_working_hours: 0,
    total_break_hours: 0,
    days_worked: 0,
    late_starts: 0,
    missing_clockouts: 0
  };

  const employee = timesheetData?.employee || currentUser;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              if (Object.keys(dirtyRows).length > 0) {
                if (!confirm('You have unsaved edits. Discard and go back?')) return;
              }
              navigate(isAdmin ? '/admin' : '/');
            }}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition flex items-center gap-2 text-xs font-semibold"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">{isAdmin ? 'Back to Admin Console' : 'Back to Time Tracker'}</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-slate-900">Monthly Timesheet</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-pink-50 text-pink-700 border border-pink-200 font-semibold font-mono">
                {MONTH_NAMES[currentMonth - 1]} {currentYear}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Workday logs, tasks, and verified server hours
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {Object.keys(dirtyRows).length > 0 && (
            <button
              onClick={handleSaveAll}
              disabled={loading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition"
            >
              <Save size={15} />
              <span>Save All ({Object.keys(dirtyRows).length})</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (Object.keys(dirtyRows).length > 0) {
                  if (!confirm('You have unsaved edits. Discard and go to Analytics?')) return;
                }
                navigate('/analytics');
              }}
              className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
              title="View Time Analytics"
            >
              <TrendingUp size={14} />
              <span className="hidden md:inline">Analytics</span>
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition"
              title="Download CSV"
            >
              <Download size={14} />
              <span className="hidden md:inline">CSV</span>
            </button>
            <button
              onClick={() => handleExport('xlsx')}
              className="px-3.5 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition"
              title="Download Excel (.xlsx)"
            >
              <FileSpreadsheet size={14} />
              <span className="hidden md:inline">Excel (.xlsx)</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Messages */}
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-sm">
            <AlertCircle size={20} className="shrink-0 text-rose-600" />
            <div className="flex-1">{errorMsg}</div>
            <button onClick={() => setErrorMsg('')} className="text-xs underline text-rose-700 font-semibold">Dismiss</button>
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-sm animate-fadeIn">
            <CheckCircle size={20} className="shrink-0 text-emerald-600" />
            <div className="flex-1">{successMsg}</div>
          </div>
        )}

        {/* TOP CONTROLS & NAVIGATION BAR */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
          {/* Month & Year Navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrevMonth}
              className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition"
              title="Previous Month"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-pink-600" />
              <select
                value={currentMonth}
                onChange={(e) => {
                  if (Object.keys(dirtyRows).length > 0 && !confirm('Discard unsaved changes?')) return;
                  setDirtyRows({});
                  setCurrentMonth(parseInt(e.target.value));
                }}
                className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>

              <select
                value={currentYear}
                onChange={(e) => {
                  if (Object.keys(dirtyRows).length > 0 && !confirm('Discard unsaved changes?')) return;
                  setDirtyRows({});
                  setCurrentYear(parseInt(e.target.value));
                }}
                className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>

            <button
              onClick={handleNextMonth}
              className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition"
              title="Next Month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Admin Employee Selector & Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <UserCheck size={16} className="text-indigo-600 shrink-0" />
                <select
                  value={selectedUserId}
                  onChange={(e) => {
                    if (Object.keys(dirtyRows).length > 0 && !confirm('Discard unsaved changes?')) return;
                    setDirtyRows({});
                    setSelectedUserId(e.target.value);
                  }}
                  className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {employeesList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} {emp.employee_id ? `[${emp.employee_id}]` : `(${emp.department || 'Employee'})`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Filter by project/task */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter Project..."
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 w-32 focus:w-44 transition-all focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Filter Task..."
                value={filterTask}
                onChange={(e) => setFilterTask(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 w-28 focus:w-36 transition-all focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
          </div>
        </div>

        {/* TOP SUMMARY INDICATORS (Clean light card theme) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
          <div className="bg-white border border-pink-200 rounded-2xl p-4 text-center shadow-xs relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-pink-500" />
            <p className="text-xs uppercase font-bold text-pink-700 tracking-wider mb-1">Total Break Time</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 font-mono">
              {formatHumanReadableDuration(summary.total_break_seconds || 0)}
            </p>
          </div>

          <div className="bg-white border border-emerald-200 rounded-2xl p-4 text-center shadow-xs relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-emerald-500" />
            <p className="text-xs uppercase font-bold text-emerald-700 tracking-wider mb-1">Total Working Time</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 font-mono">
              {formatHumanReadableDuration(summary.total_work_seconds || 0)}
            </p>
          </div>

          <div className="bg-white border border-indigo-200 rounded-2xl p-4 text-center shadow-xs relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-indigo-500" />
            <p className="text-xs uppercase font-bold text-indigo-700 tracking-wider mb-1">Productive Days</p>
            <p className="text-2xl font-black text-slate-900 font-mono">
              {summary.days_worked} days
            </p>
          </div>

          <div className="bg-white border border-amber-200 rounded-2xl p-4 text-center shadow-xs relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-amber-500" />
            <p className="text-xs uppercase font-bold text-amber-700 tracking-wider mb-1">Late Starts</p>
            <p className="text-2xl font-black text-slate-900 font-mono">
              {summary.late_starts}
            </p>
          </div>

          <div className="bg-white border border-rose-200 rounded-2xl p-4 text-center shadow-xs relative overflow-hidden col-span-2 sm:col-span-1">
            <div className="absolute top-0 inset-x-0 h-1 bg-rose-500" />
            <p className="text-xs uppercase font-bold text-rose-700 tracking-wider mb-1">Missing Clock-Outs</p>
            <p className="text-2xl font-black text-slate-900 font-mono">
              {summary.missing_clockouts}
            </p>
          </div>
        </div>

        {/* EMPLOYEE BADGE HEADER */}
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-700 border border-pink-200 flex items-center justify-center font-bold">
              <Briefcase size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-900">{employee.name}</p>
                {(employee.employee_id || currentUser.employee_id) && (
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-200">
                    {employee.employee_id || currentUser.employee_id}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{employee.email} • {employee.department}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck size={16} className="text-emerald-600" />
            <span className="hidden sm:inline">Timestamps and durations are server-verified and read-only.</span>
          </div>
        </div>

        {/* EXCEL-INSPIRED MONTHLY TIMESHEET GRID (Clean light theme) */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-pink-50/80 text-pink-900 border-b border-pink-200 text-xs font-bold uppercase tracking-wider">
                  <th className="py-3.5 px-3 text-center w-14">Sr. No.</th>
                  <th className="py-3.5 px-3 min-w-[140px]">Date & Day</th>
                  <th className="py-3.5 px-3 min-w-[150px]">Project</th>
                  <th className="py-3.5 px-3 min-w-[150px]">Task Name</th>
                  <th className="py-3.5 px-3 min-w-[220px]">Work Description</th>
                  <th className="py-3.5 px-3 min-w-[120px]">Clock In</th>
                  <th className="py-3.5 px-3 min-w-[120px]">Clock Out</th>
                  <th className="py-3.5 px-3 text-right min-w-[110px]">Total Day Time</th>
                  <th className="py-3.5 px-3 text-right min-w-[110px]">Work Time</th>
                  <th className="py-3.5 px-3 text-right min-w-[100px]">Break Time</th>
                  <th className="py-3.5 px-3 text-right min-w-[110px]">Req. Hours</th>
                  <th className="py-3.5 px-3 text-center min-w-[120px]">9H Status</th>
                  <th className="py-3.5 px-3 text-right min-w-[110px]">Shortfall/Extra</th>
                  <th className="py-3.5 px-3 text-center min-w-[110px]">Record Status</th>
                  <th className="py-3.5 px-3 text-center w-20">Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {days.map((row) => {
                  const isDirty = !!dirtyRows[row.date];
                  const isSavingThis = savingDate === row.date;

                  return (
                    <tr 
                      key={row.date} 
                      className={`transition ${
                        row.is_weekend ? 'bg-slate-50/80 text-slate-400' :
                        isDirty ? 'bg-pink-50/30' : 'hover:bg-slate-50/60'
                      }`}
                    >
                      {/* Sr. No. */}
                      <td className="py-3 px-3 text-center font-mono text-xs text-slate-500">
                        {row.sr_no}
                      </td>

                      {/* Date & Day */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 text-xs">{row.date_formatted}</div>
                        <div className="text-[11px] text-slate-500">{row.day_of_week}</div>
                      </td>

                      {/* Project (Editable) */}
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          placeholder="e.g. Knowletive"
                          value={row.project_name || ''}
                          onChange={(e) => handleFieldChange(row.date, 'project_name', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition"
                        />
                      </td>

                      {/* Task Name (Editable) */}
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          placeholder="e.g. Website"
                          value={row.task_name || ''}
                          onChange={(e) => handleFieldChange(row.date, 'task_name', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition"
                        />
                      </td>

                      {/* Work Description (Editable) */}
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          placeholder="What did you work on today?"
                          value={row.work_description || ''}
                          onChange={(e) => handleFieldChange(row.date, 'work_description', e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition"
                        />
                      </td>

                      {/* Start Time (Read-only, Server-recorded) */}
                      <td className="py-3 px-3 font-mono text-xs text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <span>{row.start_time}</span>
                          {row.is_late_start && (
                            <span className="text-[10px] text-amber-700 font-bold" title="Late start after 10:00 AM">
                              • Late
                            </span>
                          )}
                        </div>
                      </td>

                      {/* End Time (Read-only, Server-recorded) */}
                      <td className="py-3 px-3 font-mono text-xs text-slate-700">
                        {row.end_time}
                      </td>

                      {/* Total Day Time */}
                      <td className="py-3 px-3 font-mono text-xs text-right font-bold text-slate-800">
                        {row.total_day_duration_str && row.total_day_duration_str !== '00:00:00' ? row.total_day_duration_str : '-'}
                      </td>

                      {/* Work Time */}
                      <td className="py-3 px-3 font-mono text-xs text-right text-emerald-700">
                        {row.work_duration_str && row.work_duration_str !== '00:00:00' ? row.work_duration_str : '-'}
                      </td>

                      {/* Break Duration */}
                      <td className="py-3 px-3 font-mono text-xs text-right text-amber-700">
                        {row.break_duration_str && row.break_duration_str !== '00:00:00' ? row.break_duration_str : '-'}
                      </td>
                      
                      {/* Req. Hours */}
                      <td className="py-3 px-3 font-mono text-xs text-right text-slate-500">
                        {row.required_hours_str || '09:00:00'}
                      </td>
                      
                      {/* 9H Status */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          row.completion_status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : 
                          row.total_day_seconds > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400'
                        }`}>
                          {row.total_day_seconds > 0 ? row.completion_status : '-'}
                        </span>
                      </td>
                      
                      {/* Shortfall/Extra */}
                      <td className="py-3 px-3 font-mono text-xs text-right font-medium">
                        {row.total_day_seconds > 0 ? (
                          <span className={row.completion_status === 'Completed' ? 'text-emerald-600' : 'text-rose-600'}>
                             {row.completion_status === 'Completed' ? '+' : '-'}{row.diff_duration_str || '00:00:00'}
                          </span>
                        ) : '-'}
                      </td>

                      {/* Record Status */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          row.status === 'Completed' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                          row.status === 'In Progress' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                          row.status === 'Missing Clock-out' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                          row.status === 'Weekend' ? 'bg-slate-100 text-slate-500' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {row.status}
                        </span>
                      </td>

                      {/* Save Action */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => handleSaveRow(row.date)}
                          disabled={!isDirty || isSavingThis}
                          className={`p-1.5 rounded-lg text-xs font-semibold transition ${
                            isDirty 
                              ? 'bg-pink-600 hover:bg-pink-700 text-white shadow-xs cursor-pointer' 
                              : 'text-slate-300 bg-slate-100 border border-slate-200 cursor-not-allowed'
                          }`}
                          title={isDirty ? 'Save changes for this day' : 'No changes'}
                        >
                          <Save size={14} className={isSavingThis ? 'animate-spin' : ''} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
