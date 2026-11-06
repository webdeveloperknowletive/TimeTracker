import json
from datetime import datetime, timezone, timedelta
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from tracker.models import User, TaskLog, Project, ProjectTask, WorkSession, TimeEvent
from tracker.storage_adapter import storage
from tracker.views import IST_TZ, close_employee_active_workday_and_timers, extract_task_period_sessions_and_duration, calculate_day_metrics


class SessionClosureAndDurationsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='admin1',
            email='admin1@knowletive.com',
            password='Password123!',
            role='ADMIN',
            department='Administration'
        )
        self.employee = User.objects.create_user(
            username='emp_test',
            email='emp_test@knowletive.com',
            password='Password123!',
            first_name='Test',
            last_name='Emp',
            role='EMPLOYEE',
            department='Engineering',
            designation='Software Developer',
            employee_id='EMP999'
        )
        self.emp_token, _ = Token.objects.get_or_create(user=self.employee)
        self.admin_token, _ = Token.objects.get_or_create(user=self.admin)

    def test_employee_sign_out_while_working_stops_all_timers(self):
        """
        Signing out while working must stop attendance timer, close task session,
        mark attendance as Ended, invalidate auth token, and keep task In Progress (not Completed).
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp_token.key}')
        
        # 1. Start Workday
        res = self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'}, format='json')
        self.assertEqual(res.status_code, 200)

        # 2. Start a Task
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Alpha Project',
            'task_name': 'Backend API',
            'description': 'Building endpoints',
            'project_status': 'IN_PROGRESS'
        }, format='json')
        self.assertIn(res.status_code, [200, 201])
        task_id = res.data['task'].get('task_log_id') or res.data['task'].get('task_id')

        # Verify active state
        status_res = self.client.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'Working')
        self.assertIsNone(status_res.data.get('end_time'))

        # 3. Explicit Employee Sign Out
        logout_res = self.client.post('/api/auth/logout/')
        self.assertEqual(logout_res.status_code, 200)

        # Token must be invalidated
        self.assertFalse(Token.objects.filter(key=self.emp_token.key).exists())

        # 4. Check Backend State
        # Attendance must be Ended and have end_time / clock_out
        events = storage.get_events_for_user(self.employee.id)
        metrics = calculate_day_metrics(events)
        self.assertEqual(metrics['status'], 'Ended')
        self.assertIsNotNone(metrics['end_time'])

        # Task must NOT be marked COMPLETED (unfinished task remains in progress/ended)
        task = TaskLog.objects.get(task_id=task_id)
        self.assertNotEqual(task.status, 'COMPLETED')
        self.assertIn(task.status, ['IN_PROGRESS', 'ENDED'])
        self.assertIsNotNone(task.end_time)

        # WorkSession must be closed
        ws = WorkSession.objects.filter(user_id=self.employee.id).order_by('-created_at').first()
        self.assertIsNotNone(ws)
        self.assertIn(ws.status, ['ENDED', 'PAUSED'])
        self.assertIsNotNone(ws.end_time)

    def test_employee_sign_out_during_break_stops_break_and_attendance(self):
        """
        Signing out during a break must close break segment, stop attendance, and mark Ended.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp_token.key}')
        
        # Start work, then start break
        self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'}, format='json')
        self.client.post('/api/tracker/action/', {'action': 'START_BREAK', 'source': 'web'}, format='json')

        status_res = self.client.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'On Break')

        # Logout
        logout_res = self.client.post('/api/auth/logout/')
        self.assertEqual(logout_res.status_code, 200)

        # Check Ended
        events = storage.get_events_for_user(self.employee.id)
        metrics = calculate_day_metrics(events)
        self.assertEqual(metrics['status'], 'Ended')
        self.assertIsNotNone(metrics['end_time'])

        # Break must have ended
        last_event = events[-1]
        self.assertEqual(last_event.get('event_type') or last_event.get('action'), 'END_WORK')

    def test_end_workday_closes_task_without_marking_completed(self):
        """
        End Workday action must stop all timers, close active work session,
        mark attendance Ended, and keep unfinished task In Progress.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp_token.key}')
        self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'}, format='json')
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Beta Project',
            'task_name': 'Frontend UI',
            'description': 'Building dashboard',
            'project_status': 'IN_PROGRESS'
        }, format='json')
        self.assertIn(res.status_code, [200, 201])
        task_id = res.data['task'].get('task_log_id') or res.data['task'].get('task_id')

        # Click End Workday
        end_res = self.client.post('/api/tracker/action/', {'action': 'END_WORK', 'source': 'web'}, format='json')
        self.assertEqual(end_res.status_code, 200)

        # Check status is Ended
        events = storage.get_events_for_user(self.employee.id)
        metrics = calculate_day_metrics(events)
        self.assertEqual(metrics['status'], 'Ended')

        # Check task not completed
        task = TaskLog.objects.get(task_id=task_id)
        self.assertNotEqual(task.status, 'COMPLETED')

        # Work session is closed
        ws = WorkSession.objects.filter(user_id=self.employee.id).order_by('-created_at').first()
        self.assertIsNotNone(ws.end_time)

    def test_repeated_session_closure_is_idempotent(self):
        """
        Repeated calls to End Workday or session closure must be safe and not add duplicate durations.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp_token.key}')
        self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'}, format='json')
        
        # Call 1
        res1 = self.client.post('/api/tracker/action/', {'action': 'END_WORK', 'source': 'web'}, format='json')
        self.assertEqual(res1.status_code, 200)
        events_count1 = TimeEvent.objects.filter(user_id=self.employee.id).count()

        # Call 2 (repeated click)
        res2 = self.client.post('/api/tracker/action/', {'action': 'END_WORK', 'source': 'web'}, format='json')
        self.assertEqual(res2.status_code, 200)
        events_count2 = TimeEvent.objects.filter(user_id=self.employee.id).count()

        # Should not create duplicate END_WORK events or corrupt state
        self.assertEqual(events_count1, events_count2)

    def test_admin_sign_out_does_not_affect_employee_sessions(self):
        """
        When an admin signs out, active employee workday and task timers must remain running.
        """
        # Start employee work & task
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp_token.key}')
        self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'}, format='json')
        self.client.post('/api/tasks/start/', {
            'project_name': 'Project Gamma',
            'task_name': 'Architecture',
            'description': 'Designing core'
        }, format='json')

        # Admin logs out
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        admin_logout_res = self.client.post('/api/auth/logout/')
        self.assertEqual(admin_logout_res.status_code, 200)

        # Admin token deleted
        self.assertFalse(Token.objects.filter(key=self.admin_token.key).exists())
        # Employee token still intact
        self.assertTrue(Token.objects.filter(key=self.emp_token.key).exists())

        # Employee timers still running
        events = storage.get_events_for_user(self.employee.id)
        metrics = calculate_day_metrics(events)
        self.assertEqual(metrics['status'], 'Working')
        self.assertIsNone(metrics['end_time'])

    def test_historical_unclosed_task_does_not_inflate_duration(self):
        """
        A task from 3 days ago that was left without an end time must not accumulate
        continuous elapsed time up to now_utc.
        """
        three_days_ago = datetime.now(timezone.utc) - timedelta(days=3)
        three_days_ago_str = three_days_ago.isoformat().replace("+00:00", "Z")

        # Create past unclosed task
        past_task = TaskLog.objects.create(
            task_id='TL_PAST_1',
            user_id=self.employee.id,
            project_name='Legacy Project',
            task_name='Legacy Unclosed Task',
            start_time=three_days_ago_str,
            end_time=None,
            status='IN_PROGRESS',
            current_segment_start=three_days_ago_str,
            duration_seconds=120,
            date=three_days_ago.astimezone(IST_TZ).date().isoformat()
        )

        # calculate_task_duration must return recorded duration (120s), NOT 3 days of seconds (259200s)
        dur = storage.calculate_task_duration(past_task)
        self.assertEqual(dur, 120)

    def test_extract_task_period_sessions_bounds_unclosed_session(self):
        """
        extract_task_period_sessions_and_duration for All Time must not add multi-day elapsed time
        to historical unclosed sessions.
        """
        five_days_ago = datetime.now(timezone.utc) - timedelta(days=5)
        five_days_ago_str = five_days_ago.isoformat().replace("+00:00", "Z")

        proj = Project.objects.create(name='Proj', created_by=self.employee)
        pt = ProjectTask.objects.create(task_id='PT_1', project=proj, title='Task')

        task = TaskLog.objects.create(
            task_id='TL_PAST_2',
            user_id=self.employee.id,
            project_name='Proj',
            task_name='Task',
            start_time=five_days_ago_str,
            end_time=None,
            status='IN_PROGRESS',
            duration_seconds=300,
            date=five_days_ago.astimezone(IST_TZ).date().isoformat()
        )

        ws = WorkSession.objects.create(
            user_id=self.employee.id,
            task=pt,
            task_log_id='TL_PAST_2',
            start_time=five_days_ago_str,
            end_time=None,
            status='IN_PROGRESS',
            current_segment_start=five_days_ago_str,
            duration_seconds=300,
            date=five_days_ago.astimezone(IST_TZ).date().isoformat()
        )

        period_sec, sessions = extract_task_period_sessions_and_duration(pt, None, None)
        # Should be strictly bounded to recorded duration (300 seconds), NOT 5 days of seconds
        self.assertEqual(period_sec, 300)
