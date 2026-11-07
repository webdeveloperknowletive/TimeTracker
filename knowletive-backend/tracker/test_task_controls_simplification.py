import os
import django
from datetime import datetime, timezone, timedelta, time

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')
django.setup()

from django.test import TestCase
from tracker.models import User, TimeEvent, TaskLog, Project, ProjectTask, WorkSession, EmployeeProjectStatus
from tracker.storage_adapter import storage
from tracker.views import daily_tasks_view
from tracker.auto_closure_service import IST_TZ, set_mock_ist_time
from rest_framework.test import APIRequestFactory, force_authenticate

class TaskControlsSimplificationTest(TestCase):
    def setUp(self):
        set_mock_ist_time(None)
        self.factory = APIRequestFactory()

        # Create test employee
        self.emp = User.objects.create_user(
            username='task_worker',
            email='task_worker@knowletive.com',
            password='TestPassword123!',
            first_name='Task',
            last_name='Worker',
            role='EMPLOYEE',
            employee_id='EMP991',
            department='Engineering',
            designation='Software Engineer',
            is_active=True
        )

    def tearDown(self):
        set_mock_ist_time(None)

    def test_end_task_behavior(self):
        """
        - End Task closes active task work session at server timestamp and saves final duration.
        - Stops only task tracking; attendance continues.
        - Does NOT mark project Completed; preserves employee-selected project status.
        - Ended task preserved in Today's Tasks as ENDED.
        """
        mock_start = datetime(2026, 11, 7, 11, 0, 0, tzinfo=IST_TZ)
        set_mock_ist_time(mock_start)
        mock_start_utc = mock_start.astimezone(timezone.utc)

        # Employee clocks in (attendance starts)
        storage.record_event(self.emp.id, 'START_WORK', source='web', timestamp=mock_start_utc)

        # Employee sets project status to 'IN_PROGRESS' and starts task
        EmployeeProjectStatus.objects.create(
            user=self.emp,
            project_name='Project Phoenix',
            status='IN_PROGRESS'
        )

        task = storage.start_task(
            user_id=self.emp.id,
            project_name='Project Phoenix',
            task_name='Frontend Refactor',
            description='Refactoring task controls',
            user_email=self.emp.email,
            employee_id=self.emp.employee_id,
            employee_name='Task Worker'
        )

        self.assertIsNotNone(task)
        self.assertEqual(task['status'], 'IN_PROGRESS')

        # 30 minutes later, employee clicks "End Task"
        mock_end = datetime(2026, 11, 7, 11, 30, 0, tzinfo=IST_TZ)
        set_mock_ist_time(mock_end)

        ended = storage.end_task(
            user_id=self.emp.id,
            task_log_id=task['task_log_id'],
            user_email=self.emp.email,
            is_explicit_completed=False
        )

        self.assertIsNotNone(ended)
        self.assertEqual(ended['status'], 'ENDED')
        self.assertEqual(ended['duration_seconds'], 1800) # 30 mins = 1800s

        # 1. Verify project status was preserved and NOT marked completed
        eps = EmployeeProjectStatus.objects.get(user=self.emp, project_name='Project Phoenix')
        self.assertEqual(eps.status, 'IN_PROGRESS')
        project = Project.objects.get(name='Project Phoenix')
        self.assertEqual(project.status, 'IN_PROGRESS')

        # 2. Verify attendance is still ongoing (has not clocked out)
        active_task = storage.get_active_task_for_user(self.emp.id)
        self.assertIsNone(active_task, "Task should no longer be active")

        # 3. Verify Today's Tasks view shows the ended task with status 'ENDED'
        request = self.factory.get('/tasks/daily/?date=2026-11-07')
        force_authenticate(request, user=self.emp)
        response = daily_tasks_view(request)
        self.assertEqual(response.status_code, 200)
        tasks = response.data['tasks']
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]['task_name'], 'Frontend Refactor')
        self.assertEqual(tasks[0]['status'], 'ENDED')
        self.assertEqual(tasks[0]['duration_seconds'], 1800)

    def test_switch_task_creates_unique_task_and_ends_previous_atomically(self):
        """
        - Switch Task creates a new task entry with a unique ID.
        - Previous task is ended atomically at the exact same server timestamp.
        - Same task name submitted twice creates two distinct task entries (never merged).
        """
        mock_start = datetime(2026, 11, 7, 12, 0, 0, tzinfo=IST_TZ)
        set_mock_ist_time(mock_start)
        mock_start_utc = mock_start.astimezone(timezone.utc)

        storage.record_event(self.emp.id, 'START_WORK', source='web', timestamp=mock_start_utc)

        # Start Task 1
        t1 = storage.start_task(
            user_id=self.emp.id,
            project_name='Alpha Project',
            task_name='Feature Implementation',
            description='First pass',
            user_email=self.emp.email
        )

        # 20 minutes later, switch to Task 2 (same task name to test no merging)
        mock_switch = datetime(2026, 11, 7, 12, 20, 0, tzinfo=IST_TZ)
        set_mock_ist_time(mock_switch)

        t2 = storage.start_task(
            user_id=self.emp.id,
            project_name='Alpha Project',
            task_name='Feature Implementation',
            description='Second pass',
            user_email=self.emp.email
        )

        # Verify t1 and t2 have distinct unique IDs
        self.assertNotEqual(t1['task_log_id'], t2['task_log_id'])
        self.assertNotEqual(t1['project_task_id'], t2['project_task_id'])

        # Verify t1 is now ended with 20 minutes (1200 seconds)
        t1_refreshed = TaskLog.objects.get(task_id=t1['task_log_id'])
        self.assertEqual(t1_refreshed.status, 'ENDED')
        self.assertEqual(t1_refreshed.duration_seconds, 1200)

        # Verify t2 is in progress
        t2_refreshed = TaskLog.objects.get(task_id=t2['task_log_id'])
        self.assertEqual(t2_refreshed.status, 'IN_PROGRESS')

        # 10 minutes later, check daily tasks
        mock_now = datetime(2026, 11, 7, 12, 30, 0, tzinfo=IST_TZ)
        set_mock_ist_time(mock_now)

        request = self.factory.get('/tasks/daily/?date=2026-11-07')
        force_authenticate(request, user=self.emp)
        response = daily_tasks_view(request)
        self.assertEqual(response.status_code, 200)
        tasks = response.data['tasks']

        # Both tasks must exist separately and NOT be merged by task name
        self.assertEqual(len(tasks), 2)
        task_ids = [t['task_log_id'] for t in tasks]
        self.assertIn(t1['task_log_id'], task_ids)
        self.assertIn(t2['task_log_id'], task_ids)

    def test_existing_unfinished_tasks_preserved(self):
        """
        - Existing unfinished tasks in database retain their status and saved duration.
        """
        old_project = Project.objects.create(name='Legacy Project', status='IN_PROGRESS')
        old_pt = ProjectTask.objects.create(
            project=old_project,
            title='Old Unfinished Task',
            assigned_to=self.emp,
            status='IN_PROGRESS',
            total_duration_seconds=3600
        )
        old_tl = TaskLog.objects.create(
            task_id='old-uuid-1234',
            user_id=self.emp.id,
            project_name='Legacy Project',
            task_name='Old Unfinished Task',
            status='IN_PROGRESS',
            duration_seconds=3600,
            project_task_id=old_pt.task_id
        )

        # Verify old task still has 3600 seconds and is in progress
        self.assertEqual(old_pt.total_duration_seconds, 3600)
        self.assertEqual(old_tl.duration_seconds, 3600)

        # Start a brand new task with the same name under the same project
        new_t = storage.start_task(
            user_id=self.emp.id,
            project_name='Legacy Project',
            task_name='Old Unfinished Task',
            description='Brand new distinct work',
            user_email=self.emp.email
        )

        # Old task was ended as part of starting new work, preserving its 3600 seconds
        old_tl.refresh_from_db()
        self.assertEqual(old_tl.duration_seconds, 3600)
        self.assertEqual(old_tl.status, 'ENDED')

        # New task has a unique ID and duration 0
        self.assertNotEqual(new_t['task_log_id'], 'old-uuid-1234')
        self.assertNotEqual(new_t['project_task_id'], old_pt.task_id)
        self.assertEqual(new_t['duration_seconds'], 0)

    def test_active_task_duration_not_double_counted(self):
        """
        Ensure that an active task without closed segments has its elapsed duration
        counted exactly once in daily_tasks_view (no double counting via fallback).
        """
        mock_start = datetime(2026, 11, 7, 10, 55, 54, tzinfo=IST_TZ)
        set_mock_ist_time(mock_start)
        mock_start_utc = mock_start.astimezone(timezone.utc)

        storage.record_event(self.emp.id, 'START_WORK', source='web', timestamp=mock_start_utc)

        task = storage.start_task(
            user_id=self.emp.id,
            project_name='time tracker',
            task_name='Testing',
            description='testingg',
            user_email=self.emp.email
        )

        # 22 minutes 48 seconds later (1368 seconds)
        mock_now = datetime(2026, 11, 7, 11, 18, 42, tzinfo=IST_TZ)
        set_mock_ist_time(mock_now)

        request = self.factory.get('/tasks/daily/?date=2026-11-07')
        force_authenticate(request, user=self.emp)
        response = daily_tasks_view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['total_task_seconds'], 1368)
        self.assertEqual(len(response.data['tasks']), 1)
        self.assertEqual(response.data['tasks'][0]['duration_seconds'], 1368)
        self.assertEqual(response.data['project_breakdown'][0]['total_seconds'], 1368)
        self.assertEqual(response.data['project_breakdown'][0]['duration_formatted'], '22 min 48 sec')

