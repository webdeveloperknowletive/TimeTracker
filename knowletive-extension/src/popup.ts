const API_URL = 'http://localhost:8000/api';

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const { token } = await chrome.storage.local.get('token');
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Token ${token}`);
  }
  
  try {
    const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'Server error occurred');
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
  const authView = document.getElementById('auth-view')!;
  const trackerView = document.getElementById('tracker-view')!;
  const loginForm = document.getElementById('login-form') as HTMLFormElement;
  const loginError = document.getElementById('login-error')!;
  const actionError = document.getElementById('action-error')!;
  
  const userName = document.getElementById('user-name')!;
  const currentStatus = document.getElementById('current-status')!;
  const timeElapsed = document.getElementById('time-elapsed')!;
  const syncStatus = document.getElementById('sync-status')!;
  
  const btnStartWork = document.getElementById('start-work-btn')!;
  const btnStartBreak = document.getElementById('start-break-btn')!;
  const btnResumeWork = document.getElementById('resume-work-btn')!;
  const btnEndWork = document.getElementById('end-work-btn')!;
  const btnLogout = document.getElementById('logout-btn')!;

  async function checkAuth() {
    const { token, user } = await chrome.storage.local.get(['token', 'user']);
    if (token && user) {
      authView.classList.add('hidden');
      trackerView.classList.remove('hidden');
      const u = user as any;
      userName.textContent = u.name || u.email;
      await fetchStatus();
    } else {
      authView.classList.remove('hidden');
      trackerView.classList.add('hidden');
    }
  }

  let timerInterval: any = null;
  let pollInterval: any = null;
  let currentWorkBase = 0;
  let currentBreakBase = 0;
  let currentStatusVal = 'Not Started';
  let sessionStartTime: number | null = null;

  async function fetchStatus() {
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
      syncStatus.textContent = `Last synced: ${new Date().toLocaleTimeString()}`;
      actionError.classList.add('hidden');
    } catch (err: any) {
      if (err.message && (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized'))) {
        await handleLogout();
      } else {
        showError(actionError, err.message || 'Offline or server unreachable. Actions cannot be recorded while offline.');
        syncStatus.textContent = 'Offline (Sync Failed)';
      }
    }
  }

  function renderTimerAndUI() {
    btnStartWork.classList.add('hidden');
    btnStartBreak.classList.add('hidden');
    btnResumeWork.classList.add('hidden');
    btnEndWork.classList.add('hidden');

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

  // Ticking interval - only displays elapsed time based on timestamps
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (sessionStartTime && (currentStatusVal === 'Working' || currentStatusVal === 'On Break')) {
      renderTimerAndUI();
    }
  }, 1000);

  // Background auto-sync interval for web app & extension alignment
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    fetchStatus();
  }, 5000);

  function showError(el: HTMLElement, msg: string) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const email = (document.getElementById('email') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value;
    
    try {
      const data = await fetchAPI('/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      await chrome.storage.local.set({ token: data.token, user: data.user });
      await checkAuth();
    } catch (err: any) {
      showError(loginError, err.message || 'Invalid credentials.');
    }
  });

  async function handleLogout() {
    try {
      await fetchAPI('/auth/logout/', { method: 'POST' });
    } catch {}
    await chrome.storage.local.remove(['token', 'user']);
    await checkAuth();
  }

  btnLogout.addEventListener('click', handleLogout);

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

  checkAuth();
});
