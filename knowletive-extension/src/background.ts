// background.ts handles alarms for reminders
chrome.runtime.onInstalled.addListener(() => {
  // Setup daily alarms (simplified for demo, usually would check settings from backend)
  chrome.alarms.create('start-reminder', {
    when: getNextTime(10, 0), // 10:00 AM
    periodInMinutes: 24 * 60
  });

  chrome.alarms.create('end-reminder', {
    when: getNextTime(18, 50), // 6:50 PM (10 mins before 7 PM)
    periodInMinutes: 24 * 60
  });
});

function getNextTime(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (now.getTime() > target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { token } = await chrome.storage.local.get('token');
  if (!token) return; // Not logged in

  try {
    // Check status first
    const res = await fetch('http://localhost:8000/api/tracker/status/', {
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

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  // Open dashboard when button clicked
  chrome.tabs.create({ url: 'http://localhost:5173' });
});
