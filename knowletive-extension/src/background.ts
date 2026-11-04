// background.ts handles alarms for reminders
const BG_DEFAULT_API_URL = 'https://timetracker-api.knowletive.in/api';
const BG_DEFAULT_WEB_URL = 'https://timetracker.knowletive.in';

async function getBgApiUrl(): Promise<string> {
  const result = (await chrome.storage.local.get('api_url')) as { api_url?: string };
  return (result.api_url || BG_DEFAULT_API_URL).trim().replace(/\/+$/, '');
}

async function getBgWebUrl(): Promise<string> {
  const result = (await chrome.storage.local.get('web_url')) as { web_url?: string };
  return (result.web_url || BG_DEFAULT_WEB_URL).trim().replace(/\/+$/, '');
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('start-reminder', {
    when: getBgNextTime(10, 0), // 10:00 AM
    periodInMinutes: 24 * 60
  });

  chrome.alarms.create('end-reminder', {
    when: getBgNextTime(18, 50), // 6:50 PM (10 mins before 7 PM)
    periodInMinutes: 24 * 60
  });
});

function getBgNextTime(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (now.getTime() > target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { token } = (await chrome.storage.local.get('token')) as { token?: string };
  if (!token) return; // Not logged in

  try {
    const apiUrl = await getBgApiUrl();
    const res = await fetch(`${apiUrl}/tracker/status/`, {
      headers: {
        'Authorization': `Token ${token}`
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    const status = data.status;

    if (alarm.name === 'start-reminder' && status === 'Not Started') {
      chrome.notifications.create('start-work-noti', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Time to Start Work!',
        message: 'You haven\'t started tracking your time today.',
        buttons: [{ title: 'Open Tracker' }]
      });
    }

    if (alarm.name === 'end-reminder' && (status === 'Working' || status === 'On Break')) {
      chrome.notifications.create('end-work-noti', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Workday is ending soon',
        message: 'Don\'t forget to end your work tracking for the day.',
        buttons: [{ title: 'Open Tracker' }]
      });
    }
  } catch (e) {
    console.error('Reminder check failed', e);
  }
});

chrome.notifications.onButtonClicked.addListener(async () => {
  const webUrl = await getBgWebUrl();
  chrome.tabs.create({ url: webUrl });
});
