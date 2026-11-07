import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')

from datetime import datetime, date, time, timedelta, timezone
from zoneinfo import ZoneInfo
from django.test import Client, TestCase
from tracker.models import User, Project, ProjectTask, WorkSession, TaskLog, TimeEvent
from rest_framework.authtoken.models import Token
from tracker.storage_adapter import storage
from tracker.auto_closure_service import (
    IST_TZ,
    CUTOFF_TIME,
    set_mock_ist_time,
    get_workday_cutoff_ist,
    get_workday_cutoff_utc,
    close_single_user_at_cutoff,
    close_all_active_sessions_at_cutoff,
    enforce_user_workday_cutoff,
    is_tracking_action_allowed
)

class WorkdayAutoClosureTests(TestCase):
    def setUp(self):
        set_mock_ist_time(None)
        self.today = date(2026, 11, 7)
        self.user = User.objects.create_user(
            username="emp_closure",
            email="emp_closure@knowletive.com",
            password="TestPassword123!",
            employee_id="EMP_CLOSE_01",
            first_name="Employee",
            last_name="Closure",
            role="EMPLOYEE",
            designation="Developer",
            department="Engineering"
        )
        self.token = Token.objects.create(user=self.user)
        self.client = Client()
        self.client.defaults['HTTP_AUTHORIZATION'] = f'Token {self.token.key}'

        self.project = Project.objects.create(name="Core Project", status="IN_PROGRESS")
        self.task = ProjectTask.objects.create(
            project=self.project,
            title="Core Feature Development",
            assigned_to=self.user,
            status="IN_PROGRESS"
        )

    def tearDown(self):
        set_mock_ist_time(None)

    def test_72959_pm_before_cutoff_stays_active(self):
        """At 7:29:59 PM IST, sessions remain active and are NOT closed."""
        t_start_ist = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        t_check_ist = datetime(2026, 11, 7, 19, 29, 59, tzinfo=IST_TZ)
        set_mock_ist_time(t_check_ist)

        # Clock in at 10:30 AM IST
        storage.record_event(self.user.id, "START_WORK", timestamp=t_start_ist)

        res = self.client.get('/api/tracker/status/')
        data = res.json()
        self.assertEqual(data['status'], 'Working')
        # Tracking action is still allowed at 7:29:59 PM
        allowed, reason, code = is_tracking_action_allowed(self.user, now_ist=t_check_ist)
        self.assertTrue(allowed)

    def test_exactly_730_pm_cutoff_closes_attendance_and_task(self):
        """At exactly 7:30:00 PM IST, active attendance and task work sessions are closed at 7:30 PM timestamp."""
        t_start_ist = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        t_cutoff_ist = datetime(2026, 11, 7, 19, 30, 0, tzinfo=IST_TZ)
        cutoff_utc = t_cutoff_ist.astimezone(timezone.utc)
        set_mock_ist_time(t_cutoff_ist)

        # Start workday and task at 10:30 AM IST
        storage.record_event(self.user.id, "START_WORK", timestamp=t_start_ist)
        t_start_utc_str = t_start_ist.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

        ws = WorkSession.objects.create(
            user=self.user,
            task=self.task,
            date="2026-11-07",
            status="IN_PROGRESS",
            start_time=t_start_utc_str,
            current_segment_start=t_start_utc_str,
            duration_seconds=0,
            work_segments=[]
        )
        tl = TaskLog.objects.create(
            task_id="tl_test_01",
            user_id=self.user.id,
            employee_id="EMP_CLOSE_01",
            employee_name="Employee Closure",
            project_name="Core Project",
            task_name="Core Feature Development",
            project_task_id=self.task.task_id,
            start_time=t_start_utc_str,
            current_segment_start=t_start_utc_str,
            status="IN_PROGRESS",
            duration_seconds=0,
            work_segments=[]
        )

        # Query status at 7:30:00 PM IST
        res = self.client.get('/api/tracker/status/')
        data = res.json()
        self.assertEqual(data['status'], 'Ended')
        self.assertEqual(data['end_time'], cutoff_utc.isoformat().replace("+00:00", "Z"))
        # 10:30 AM to 7:30 PM is exactly 9 hours = 32,400 seconds
        self.assertEqual(data['total_work_seconds'], 32400)

        # Task and Project must NOT be marked COMPLETED; unfinished task stays IN_PROGRESS
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'IN_PROGRESS')
        self.assertEqual(self.project.status, 'IN_PROGRESS')
        self.assertEqual(self.task.total_duration_seconds, 32400)

        ws.refresh_from_db()
        self.assertEqual(ws.status, 'ENDED')
        self.assertEqual(ws.duration_seconds, 32400)
        self.assertEqual(ws.end_time, cutoff_utc.isoformat().replace("+00:00", "Z"))

        tl.refresh_from_db()
        self.assertEqual(tl.status, 'ENDED')
        self.assertEqual(tl.duration_seconds, 32400)

    def test_delayed_scheduler_at_731_pm_closes_at_730_pm_not_execution_time(self):
        """If scheduler runs late at 7:31 PM or 8:15 PM IST, sessions close at 7:30 PM timestamp, zero duration added after cutoff."""
        t_start_ist = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        t_late_exec_ist = datetime(2026, 11, 7, 20, 15, 0, tzinfo=IST_TZ) # 8:15 PM (45 mins late)
        cutoff_utc = datetime(2026, 11, 7, 19, 30, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        set_mock_ist_time(t_late_exec_ist)

        storage.record_event(self.user.id, "START_WORK", timestamp=t_start_ist)

        # Execute scheduled job late
        result = close_all_active_sessions_at_cutoff(now_ist=t_late_exec_ist)
        self.assertEqual(result['closed_count'], 1)
        self.assertIn(self.user.id, result['closed_users'])

        # Verified stored END_WORK event timestamp is 14:00:00 UTC (7:30 PM IST), NOT 20:15:00
        end_event = TimeEvent.objects.filter(user_id=self.user.id, event_type='END_WORK').first()
        self.assertIsNotNone(end_event)
        self.assertEqual(end_event.timestamp, cutoff_utc.isoformat().replace("+00:00", "Z"))

        # Verify status endpoint reflects 9 hours, not 9 hours + 45 mins
        res = self.client.get('/api/tracker/status/')
        data = res.json()
        self.assertEqual(data['status'], 'Ended')
        self.assertEqual(data['total_work_seconds'], 32400)

    def test_active_break_at_cutoff_closes_break_and_attendance(self):
        """If on break at 7:30 PM IST, break duration is capped at 7:30 PM and workday is ended."""
        t_start_ist = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        t_break_ist = datetime(2026, 11, 7, 19, 0, 0, tzinfo=IST_TZ)  # Break started at 7:00 PM
        t_check_ist = datetime(2026, 11, 7, 19, 35, 0, tzinfo=IST_TZ) # 7:35 PM
        cutoff_utc = datetime(2026, 11, 7, 19, 30, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        set_mock_ist_time(t_check_ist)

        storage.record_event(self.user.id, "START_WORK", timestamp=t_start_ist)
        storage.record_event(self.user.id, "START_BREAK", timestamp=t_break_ist)

        res = self.client.get('/api/tracker/status/')
        data = res.json()
        self.assertEqual(data['status'], 'Ended')
        # Work: 10:30 AM to 7:00 PM = 8.5 hours = 30,600s
        self.assertEqual(data['total_work_seconds'], 30600)
        # Break: 7:00 PM to 7:30 PM = 30 mins = 1,800s (NOT 35 mins)
        self.assertEqual(data['total_break_seconds'], 1800)
        # Sum of work + break is 9 hours = 32,400s
        self.assertEqual(data['total_work_seconds'] + data['total_break_seconds'], 32400)

    def test_pre_cutoff_manual_end_workday_preserved(self):
        """Manual End Workday before 7:30 PM is preserved with its actual timestamp."""
        t_start_ist = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        t_manual_end_ist = datetime(2026, 11, 7, 17, 0, 0, tzinfo=IST_TZ) # 5:00 PM manual end
        t_late_ist = datetime(2026, 11, 7, 20, 0, 0, tzinfo=IST_TZ)
        manual_end_utc = t_manual_end_ist.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

        storage.record_event(self.user.id, "START_WORK", timestamp=t_start_ist)
        storage.record_event(self.user.id, "END_WORK", timestamp=t_manual_end_ist, source="manual")

        # Scheduler runs at 8:00 PM
        set_mock_ist_time(t_late_ist)
        result = close_all_active_sessions_at_cutoff(now_ist=t_late_ist)
        self.assertEqual(result['closed_count'], 0) # User was already ended

        res = self.client.get('/api/tracker/status/')
        data = res.json()
        self.assertEqual(data['status'], 'Ended')
        self.assertEqual(data['end_time'], manual_end_utc)
        # Work time is 10:30 to 17:00 = 6.5 hours = 23,400s (NOT changed to 9h)
        self.assertEqual(data['total_work_seconds'], 23400)

    def test_reject_tracking_actions_after_cutoff(self):
        """Tracking writes after 7:30 PM IST are blocked until the next workday."""
        t_night_ist = datetime(2026, 11, 7, 21, 0, 0, tzinfo=IST_TZ) # 9:00 PM IST
        set_mock_ist_time(t_night_ist)

        # 1. Action endpoint rejects START_WORK
        res = self.client.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get('code'), 'WORKDAY_CUTOFF')

        # 2. Start task rejected
        res_task = self.client.post('/api/tasks/start/', {
            'project_name': 'Core Project',
            'task_name': 'Late Night Task'
        }, content_type='application/json')
        self.assertEqual(res_task.status_code, 400)
        self.assertEqual(res_task.json().get('code'), 'WORKDAY_CUTOFF')

    def test_next_workday_tracking_works_normally(self):
        """On the next workday morning (e.g. 10:30 AM IST), tracking works normally."""
        # 1. Day 1 closes at 7:30 PM
        t_day1_start = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        storage.record_event(self.user.id, "START_WORK", timestamp=t_day1_start)
        t_day1_cutoff = datetime(2026, 11, 7, 19, 30, 0, tzinfo=IST_TZ)
        set_mock_ist_time(t_day1_cutoff)
        self.client.get('/api/tracker/status/')

        # 2. Day 2 arrives: 10:30 AM IST
        t_day2_morning = datetime(2026, 11, 8, 10, 30, 0, tzinfo=IST_TZ)
        set_mock_ist_time(t_day2_morning)

        # Allowed to clock in for Day 2
        allowed, reason, code = is_tracking_action_allowed(self.user, now_ist=t_day2_morning)
        self.assertTrue(allowed)

        res = self.client.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)

        res_status = self.client.get('/api/tracker/status/')
        self.assertEqual(res_status.json()['status'], 'Working')

    def test_nine_hours_completed_excludes_breaks_at_cutoff(self):
        """
        10:30 AM to 7:30 PM is 9 elapsed hours.
        - Without breaks: 9 hours work -> Completed 9 Hours = True.
        - With 30m break: 8.5 hours work -> Completed 9 Hours = False.
        """
        # User 1: worked 10:30 to 19:30 without breaks
        t_start = datetime(2026, 11, 7, 10, 30, 0, tzinfo=IST_TZ)
        t_cutoff = datetime(2026, 11, 7, 19, 30, 0, tzinfo=IST_TZ)
        storage.record_event(self.user.id, "START_WORK", timestamp=t_start)
        storage.record_event(self.user.id, "END_WORK", timestamp=t_cutoff)

        # User 2: took a 30 min break from 13:00 to 13:30
        user2 = User.objects.create_user(
            username="emp_with_break",
            email="emp_with_break@knowletive.com",
            password="TestPassword123!",
            role="EMPLOYEE",
            employee_id="EMP_CLOSE_02"
        )
        storage.record_event(user2.id, "START_WORK", timestamp=t_start)
        storage.record_event(user2.id, "START_BREAK", timestamp=datetime(2026, 11, 7, 13, 0, 0, tzinfo=IST_TZ))
        storage.record_event(user2.id, "RESUME_WORK", timestamp=datetime(2026, 11, 7, 13, 30, 0, tzinfo=IST_TZ))
        storage.record_event(user2.id, "END_WORK", timestamp=t_cutoff)

        set_mock_ist_time(t_cutoff)

        # Check User 1 monthly summary
        res1 = self.client.get('/api/attendance/monthly-summary/')
        d1 = res1.json()
        today_row1 = next(d for d in d1['days'] if d['date'] == '2026-11-07')
        self.assertTrue(today_row1['completed_9_hours'])
        self.assertEqual(d1['completed_9_hours_count'], 1)

        # Check User 2 monthly summary (using admin client to query user2)
        admin_user = User.objects.create_user(
            username="admin_qa",
            email="admin_qa@knowletive.com",
            password="AdminPassword123!",
            role="ADMIN"
        )
        admin_token = Token.objects.create(user=admin_user)
        admin_client = Client()
        admin_client.defaults['HTTP_AUTHORIZATION'] = f'Token {admin_token.key}'

        res2 = admin_client.get(f'/api/attendance/monthly-summary/?user_id={user2.id}')
        d2 = res2.json()
        today_row2 = next(d for d in d2['days'] if d['date'] == '2026-11-07')
        self.assertFalse(today_row2['completed_9_hours']) # 8.5h work < 9h work
        self.assertEqual(d2['completed_9_hours_count'], 0)
