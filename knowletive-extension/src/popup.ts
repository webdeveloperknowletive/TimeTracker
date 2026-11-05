const POPUP_DEFAULT_API_URL = 'https://timetracker-api.knowletive.in/api';
const POPUP_DEFAULT_WEB_URL = 'https://timetracker.knowletive.in';

async function getPopupApiUrl(): Promise<string> {
  const result = (await chrome.storage.local.get('api_url')) as { api_url?: string };
  return (result.api_url || POPUP_DEFAULT_API_URL).trim().replace(/\/+$/, '');
}

async function getPopupWebUrl(): Promise<string> {
  const result = (await chrome.storage.local.get('web_url')) as { web_url?: string };
  return (result.web_url || POPUP_DEFAULT_WEB_URL).trim().replace(/\/+$/, '');
}

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const baseUrl = await getPopupApiUrl();
  const { token } = await chrome.storage.local.get('token');
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const isAuthEndpoint = endpoint.startsWith('/auth/login') ||
                         endpoint.startsWith('/auth/signup') ||
                         endpoint.startsWith('/auth/verify-invitation') ||
                         endpoint.startsWith('/auth/forgot-password');

  if (token) {
    headers.set('Authorization', `Token ${token}`);
  } else if (!isAuthEndpoint) {
    const err: any = new Error('Authentication credentials were not provided.');
    err.status = 401;
    throw err;
  }
  
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, { ...options, headers });
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      const errorMsg = data.detail || data.error || (res.status === 401 ? 'Unauthorized' : 'Server error occurred');
      const err: any = new Error(errorMsg);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (error: any) {
    throw error;
  }
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Sync web URLs dynamically
  try {
    const webBase = await getPopupWebUrl();
    document.querySelectorAll<HTMLAnchorElement>('a[data-path]').forEach((link) => {
      const path = link.getAttribute('data-path') || '';
      link.href = `${webBase}${path}`;
    });
  } catch {}
  // Views
  const authView = document.getElementById('auth-view')!;
  const trackerView = document.getElementById('tracker-view')!;
  const adminView = document.getElementById('admin-view')!;

  // Server Switcher
  const serverLabel = document.getElementById('server-env-label');
  const switchBtn = document.getElementById('switch-env-btn');

  async function updateServerUI() {
    const currentUrl = await getPopupApiUrl();
    const isLocal = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
    if (serverLabel) {
      serverLabel.textContent = isLocal ? 'Localhost (8000)' : 'Production (Cloud)';
      serverLabel.style.color = isLocal ? '#059669' : '#4f46e5';
    }
    if (switchBtn) {
      switchBtn.textContent = isLocal ? 'Switch to Production' : 'Switch to Localhost';
    }
  }

  if (switchBtn) {
    switchBtn.addEventListener('click', async () => {
      const currentUrl = await getPopupApiUrl();
      const isLocal = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
      if (isLocal) {
        await chrome.storage.local.set({
          api_url: POPUP_DEFAULT_API_URL,
          web_url: POPUP_DEFAULT_WEB_URL
        });
      } else {
        await chrome.storage.local.set({
          api_url: 'http://localhost:8000/api',
          web_url: 'http://localhost:5173'
        });
      }
      await updateServerUI();
      try {
        const webBase = await getPopupWebUrl();
        document.querySelectorAll<HTMLAnchorElement>('a[data-path]').forEach((link) => {
          const path = link.getAttribute('data-path') || '';
          link.href = `${webBase}${path}`;
        });
      } catch {}
    });
  }

  await updateServerUI();

  // Auth elements
  const loginForm = document.getElementById('login-form') as HTMLFormElement;
  const loginError = document.getElementById('login-error')!;
  const emailInput = document.getElementById('email') as HTMLInputElement;
  const passwordInput = document.getElementById('password') as HTMLInputElement;

  // Employee Tracker elements
  const empAvatar = document.getElementById('emp-avatar');
  const userName = document.getElementById('user-name')!;
  const currentStatus = document.getElementById('current-status')!;
  const timeElapsed = document.getElementById('time-elapsed')!;
  const syncStatus = document.getElementById('sync-status')!;
  const actionError = document.getElementById('action-error')!;
  const btnStartWork = document.getElementById('start-work-btn')!;
  const btnStartBreak = document.getElementById('start-break-btn')!;
  const btnResumeWork = document.getElementById('resume-work-btn')!;
  const btnEndWork = document.getElementById('end-work-btn')!;
  const btnLogout = document.getElementById('logout-btn')!;

  // Admin Console elements
  const adminAvatar = document.getElementById('admin-avatar');
  const adminUserName = document.getElementById('admin-user-name')!;
  const adminActiveCount = document.getElementById('admin-active-count')!;
  const adminTotalCount = document.getElementById('admin-total-count')!;
  const adminLateCount = document.getElementById('admin-late-count')!;
  const adminMissingCount = document.getElementById('admin-missing-count')!;
  const adminSyncStatus = document.getElementById('admin-sync-status')!;
  const adminLogoutBtn = document.getElementById('admin-logout-btn')!;

  // Timer & Polling intervals
  let empTimerInterval: any = null;
  let empPollInterval: any = null;
  let adminPollInterval: any = null;

  // Employee state
  let currentWorkBase = 0;
  let currentBreakBase = 0;
  let currentStatusVal = 'Not Started';
  let sessionStartTime: number | null = null;

  function stopAllTimers() {
    if (empTimerInterval) {
      clearInterval(empTimerInterval);
      empTimerInterval = null;
    }
    if (empPollInterval) {
      clearInterval(empPollInterval);
      empPollInterval = null;
    }
    if (adminPollInterval) {
      clearInterval(adminPollInterval);
      adminPollInterval = null;
    }
  }

  function showAuthView() {
    stopAllTimers();
    authView.classList.remove('hidden');
    trackerView.classList.add('hidden');
    adminView.classList.add('hidden');
    if (loginError) loginError.classList.add('hidden');
    if (actionError) actionError.classList.add('hidden');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
  }

  function showAdminView(user: any) {
    stopAllTimers();
    authView.classList.add('hidden');
    trackerView.classList.add('hidden');
    adminView.classList.remove('hidden');

    const displayName = user.name || user.username || user.email || 'Administrator';
    if (adminUserName) adminUserName.textContent = displayName;
    if (adminAvatar) adminAvatar.textContent = (displayName[0] || 'A').toUpperCase();

    fetchAdminDashboard();
    adminPollInterval = setInterval(fetchAdminDashboard, 15000);
  }

  function showEmployeeView(user: any) {
    stopAllTimers();
    authView.classList.add('hidden');
    adminView.classList.add('hidden');
    trackerView.classList.remove('hidden');

    const displayName = user.name || user.username || user.email || 'Employee';
    if (userName) userName.textContent = displayName;
    if (empAvatar) empAvatar.textContent = (displayName[0] || 'E').toUpperCase();

    fetchStatus();

    // 1-second display ticker
    empTimerInterval = setInterval(() => {
      if (sessionStartTime && (currentStatusVal === 'Working' || currentStatusVal === 'On Break')) {
        renderTimerAndUI();
      }
    }, 1000);

    // 5-second status polling
    empPollInterval = setInterval(fetchStatus, 5000);
  }

  async function checkAuth() {
    const { token, user } = await chrome.storage.local.get(['token', 'user']);
    if (!token) {
      showAuthView();
      return;
    }

    let activeUser: any = user;

    // Validate and refresh current user from backend /api/auth/me/
    try {
      const meData = await fetchAPI('/auth/me/');
      if (meData && meData.user) {
        activeUser = meData.user;
        await chrome.storage.local.set({ user: activeUser });
      }
    } catch (err: any) {
      if (err.status === 401 || (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized') || err.message.includes('credentials')))) {
        stopAllTimers();
        await chrome.storage.local.clear();
        showAuthView();
        return;
      }
      // If server unreachable, continue with cached user if present
    }

    if (!activeUser || !activeUser.role) {
      // Do not default unknown users to admin - require sign in again
      await handleLogout();
      return;
    }

    // Role-based routing (Backend is the single source of truth)
    if (activeUser.role === 'ADMIN') {
      showAdminView(activeUser);
    } else if (activeUser.role === 'EMPLOYEE') {
      showEmployeeView(activeUser);
    } else {
      // Unknown or unsupported role
      await handleLogout();
    }
  }

  // --- Admin Dashboard Fetcher ---
  async function fetchAdminDashboard() {
    try {
      const data = await fetchAPI('/admin/dashboard/');
      if (data && data.overview) {
        if (adminActiveCount) adminActiveCount.textContent = String(data.overview.active_now ?? 0);
        if (adminTotalCount) adminTotalCount.textContent = String(data.overview.total_employees ?? 0);
        if (adminLateCount) adminLateCount.textContent = String(data.overview.late_today ?? 0);
        if (adminMissingCount) adminMissingCount.textContent = String(data.overview.missing_clockouts ?? 0);
      }
      if (adminSyncStatus) {
        adminSyncStatus.textContent = `Last synced: ${new Date().toLocaleTimeString()}`;
      }
    } catch (err: any) {
      if (err.status === 401 || (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')))) {
        await handleLogout();
      } else if (adminSyncStatus) {
        adminSyncStatus.textContent = 'Sync paused (Offline)';
      }
    }
  }

  // --- Employee Status Fetcher ---
  async function fetchStatus() {
    const { token } = await chrome.storage.local.get('token');
    if (!token) {
      showAuthView();
      return;
    }

    try {
      const data = await fetchAPI('/tracker/status/');
      currentStatusVal = data.status;
      currentWorkBase = data.completed_work_seconds !== undefined ? data.completed_work_seconds : (data.total_work_seconds || 0);
      currentBreakBase = data.completed_break_seconds !== undefined ? data.completed_break_seconds : (data.total_break_seconds || 0);
      
      if (data.current_session_start) {
        sessionStartTime = new Date(data.current_session_start).getTime();
      } else {
        sessionStartTime = null;
      }

      renderTimerAndUI();
      if (syncStatus) syncStatus.textContent = `Last synced: ${new Date().toLocaleTimeString()}`;
      if (actionError) actionError.classList.add('hidden');
    } catch (err: any) {
      if (err.status === 401 || (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized') || err.message.includes('credentials') || err.message.includes('authenticated')))) {
        await handleLogout();
      } else if (actionError && syncStatus) {
        showError(actionError, err.message || 'Offline or server unreachable.');
        syncStatus.textContent = 'Offline (Sync Failed)';
      }
    }
  }

  function renderTimerAndUI() {
    btnStartWork.classList.add('hidden');
    btnStartBreak.classList.add('hidden');
    btnResumeWork.classList.remove('hidden');
    btnEndWork.classList.add('hidden');
    btnResumeWork.classList.add('hidden');

    currentStatus.textContent = currentStatusVal;

    let displayWork = currentWorkBase;
    let displayBreak = currentBreakBase;

    if (currentStatusVal === 'Working' && sessionStartTime) {
      const liveAdded = Math.max(0, Math.floor((Date.now() - sessionStartTime) / 1000));
      displayWork = currentWorkBase + liveAdded;
      timeElapsed.textContent = `Work: ${formatDuration(displayWork)}`;
    } else if (currentStatusVal === 'On Break' && sessionStartTime) {
      const liveAdded = Math.max(0, Math.floor((Date.now() - sessionStartTime) / 1000));
      displayBreak = currentBreakBase + liveAdded;
      timeElapsed.textContent = `Break: ${formatDuration(displayBreak)}`;
    } else if (currentStatusVal === 'Ended') {
      timeElapsed.textContent = `Day Completed: ${formatDuration(displayWork)}`;
    } else {
      timeElapsed.textContent = `Work: ${formatDuration(displayWork)}`;
    }

    switch (currentStatusVal) {
      case 'Not Started':
        btnStartWork.classList.remove('hidden');
        break;
      case 'Working':
        btnStartBreak.classList.remove('hidden');
        btnEndWork.classList.remove('hidden');
        break;
      case 'On Break':
        btnResumeWork.classList.remove('hidden');
        btnEndWork.classList.remove('hidden');
        break;
      case 'Ended':
        break;
    }
  }

  function showError(el: HTMLElement, msg: string) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const cleanUsername = emailInput.value.trim();
    const cleanPassword = passwordInput.value;
    
    try {
      const data = await fetchAPI('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({
          username: cleanUsername,
          email: cleanUsername,
          password: cleanPassword
        })
      });

      // Clear any prior role state before setting the fresh authenticated session
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ token: data.token, user: data.user });
      await checkAuth();
    } catch (err: any) {
      showError(loginError, err.message || 'Invalid credentials.');
    }
  });

  async function handleLogout() {
    stopAllTimers();
    try {
      const { token } = await chrome.storage.local.get('token');
      if (token) {
        await fetchAPI('/auth/logout/', { method: 'POST' });
      }
    } catch {}
    // Clear all cached role data and session tokens completely
    await chrome.storage.local.clear();
    showAuthView();
  }

  btnLogout.addEventListener('click', handleLogout);
  adminLogoutBtn.addEventListener('click', handleLogout);

  async function sendAction(action: string) {
    actionError.classList.add('hidden');
    if (action === 'END_WORK') {
      if (!confirm('Are you sure you want to end your workday?')) {
        return;
      }
    }

    try {
      await fetchAPI('/tracker/action/', {
        method: 'POST',
        body: JSON.stringify({ action, source: 'extension' })
      });
      await fetchStatus();
    } catch (err: any) {
      showError(actionError, err.message || 'Action failed. Please retry when connected.');
    }
  }

  btnStartWork.addEventListener('click', () => sendAction('START_WORK'));
  btnStartBreak.addEventListener('click', () => sendAction('START_BREAK'));
  btnResumeWork.addEventListener('click', () => sendAction('RESUME_WORK'));
  btnEndWork.addEventListener('click', () => sendAction('END_WORK'));

  // Initialize
  checkAuth();
});
