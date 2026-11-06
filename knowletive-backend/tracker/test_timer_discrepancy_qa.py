import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')

import time
from datetime import datetime, timedelta
from django.utils import timezone
from zoneinfo import ZoneInfo
from django.test import Client, TestCase
from tracker.models import User, Project, ProjectTask, WorkSession, TaskLog, TimeEvent
from rest_framework.authtoken.models import Token
from tracker.storage_adapter import storage

IST = ZoneInfo("Asia/Kolkata")

class TimerDiscrepancyQATests(TestCase):
    def setUp(self):
        self.now_utc = timezone.now()
        self.user = User.objects.create_user(
            username="qa_user",
            email="qa@knowletive.com",
            password="testpassword123!",
            employee_id="QA001",
            first_name="QA",
            last_name="Tester",
            role="EMPLOYEE",
            designation="Tester",
            department="Engineering"
        )
        self.token = Token.objects.create(user=self.user)
        self.client = Client()
        self.client.defaults['HTTP_AUTHORIZATION'] = f'Token {self.token.key}'

        self.project = Project.objects.create(name="QA Testing Project", status="IN_PROGRESS")
        self.project_task = ProjectTask.objects.create(
            project=self.project,
            title="QA Verification Task"
        )

    def test_status_and_daily_tasks_have_server_time_and_clean_base(self):
        """Verify API response formats: server_time present, duration_seconds_base reflects closed segments."""
        now = timezone.now()
        t0 = (now - timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
        t_task = (now - timedelta(seconds=30)).isoformat().replace("+00:00", "Z")

        # Record START_WORK
        storage.record_event(self.user.id, "START_WORK")
        ev = TimeEvent.objects.filter(user_id=self.user.id, event_type="START_WORK").first()
        ev.timestamp = t0
        ev.save()

        # Start task
        res_task = self.client.post('/api/tasks/start/', {
            'project_name': 'QA Testing Project',
            'task_name': 'QA Verification Task',
            'description': 'Deterministic testing',
            'project_task_id': self.project_task.task_id
        }, content_type='application/json')
        self.assertIn(res_task.status_code, [200, 201])

        # Set task current segment start to t_task
        tl = TaskLog.objects.filter(user_id=self.user.id, status="IN_PROGRESS").first()
        tl.start_time = t_task
        tl.current_segment_start = t_task
        tl.duration_seconds = 0
        tl.work_segments = []
        tl.save()

        ws = WorkSession.objects.filter(user=self.user, status="IN_PROGRESS").first()
        if ws:
            ws.start_time = t_task
            ws.current_segment_start = t_task
            ws.duration_seconds = 0
            ws.work_segments = []
            ws.save()

        res_status = self.client.get('/api/tracker/status/')
        self.assertEqual(res_status.status_code, 200)
        data = res_status.json()
        self.assertIn("server_time", data)
        self.assertIsNotNone(data["server_time"])
        self.assertIn("active_task", data)
        self.assertEqual(data["active_task"]["closed_duration_seconds"], 0)
        self.assertEqual(data["active_task"]["duration_seconds_base"], 0)

        res_tasks = self.client.get('/api/tasks/daily/')
        self.assertEqual(res_tasks.status_code, 200)
        t_data = res_tasks.json()
        self.assertIn("server_time", t_data)
        self.assertIsNotNone(t_data["server_time"])
        self.assertEqual(len(t_data["tasks"]), 1)
        self.assertEqual(t_data["tasks"][0]["closed_duration_seconds"], 0)
        self.assertEqual(t_data["tasks"][0]["duration_seconds_base"], 0)

    def test_pause_resume_task_excludes_paused_gap(self):
        """40s task + 20s pause + 30s task -> 70s task duration, 20s pause excluded."""
        now = timezone.now()
        t0 = now - timedelta(seconds=90)
        t_pause = t0 + timedelta(seconds=40)
        t_resume = t_pause + timedelta(seconds=20)
        t_end = t_resume + timedelta(seconds=30)

        t0_iso = t0.isoformat().replace("+00:00", "Z")
        t_pause_iso = t_pause.isoformat().replace("+00:00", "Z")
        t_resume_iso = t_resume.isoformat().replace("+00:00", "Z")
        t_end_iso = t_end.isoformat().replace("+00:00", "Z")

        tl = TaskLog.objects.create(
            task_id="test_tl_1",
            user_id=self.user.id,
            employee_id="QA001",
            employee_name="QA Tester",
            project_name="QA Testing Project",
            task_name="QA Verification Task",
            project_task_id=self.project_task.task_id,
            start_time=t0_iso,
            status="IN_PROGRESS",
            current_segment_start=t0_iso,
            duration_seconds=0,
            work_segments=[]
        )
        ws = WorkSession.objects.create(
            user=self.user,
            task=self.project_task,
            date=t0.astimezone(IST).date().isoformat(),
            status="IN_PROGRESS",
            start_time=t0_iso,
            current_segment_start=t0_iso,
            duration_seconds=0,
            work_segments=[]
        )

        # Pause task at t_pause
        paused = storage.pause_active_task(self.user.id, pause_time_iso=t_pause_iso)
        self.assertIsNotNone(paused)
        self.assertEqual(paused["status"], "PAUSED")
        self.assertEqual(paused["duration_seconds"], 40)
        ws.refresh_from_db()
        self.assertEqual(ws.status, "PAUSED")
        self.assertEqual(ws.duration_seconds, 40)

        # Resume task at t_resume
        resumed = storage.resume_active_task(self.user.id, resume_time_iso=t_resume_iso)
        self.assertIsNotNone(resumed)
        self.assertEqual(resumed["status"], "IN_PROGRESS")
        self.assertEqual(resumed["duration_seconds"], 40)
        self.assertEqual(resumed["current_segment_start"], t_resume_iso)
        ws.refresh_from_db()
        self.assertEqual(ws.status, "IN_PROGRESS")
        self.assertEqual(ws.duration_seconds, 40)
        self.assertEqual(ws.current_segment_start, t_resume_iso)

        # Complete task
        ended = storage.end_task(self.user.id, is_explicit_completed=True)
        self.assertIsNotNone(ended)
        ws.refresh_from_db()
        self.assertEqual(ws.status, "COMPLETED")

    def test_attendance_with_break_durations(self):
        """60s work + 30s break + 60s work -> 120s work, 30s break."""
        now = timezone.now()
        t0 = (now - timedelta(seconds=150)).isoformat().replace("+00:00", "Z")
        t_break = (now - timedelta(seconds=90)).isoformat().replace("+00:00", "Z")
        t_resume = (now - timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
        t_out = now.isoformat().replace("+00:00", "Z")

        TimeEvent.objects.create(event_id="e1", user_id=self.user.id, event_type="START_WORK", timestamp=t0)
        TimeEvent.objects.create(event_id="e2", user_id=self.user.id, event_type="START_BREAK", timestamp=t_break)
        TimeEvent.objects.create(event_id="e3", user_id=self.user.id, event_type="RESUME_WORK", timestamp=t_resume)
        TimeEvent.objects.create(event_id="e4", user_id=self.user.id, event_type="END_WORK", timestamp=t_out)

        res = self.client.get('/api/tracker/status/')
        data = res.json()
        self.assertEqual(data["status"], "Ended")
        self.assertEqual(data["total_work_seconds"], 120)
        self.assertEqual(data["total_break_seconds"], 30)

    def test_attendance_before_task_duration(self):
        """30s attendance before task + 60s task -> 90s attendance, 60s task."""
        now = timezone.now()
        t0 = (now - timedelta(seconds=90)).isoformat().replace("+00:00", "Z")
        t_task = (now - timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
        t_out = now.isoformat().replace("+00:00", "Z")

        TimeEvent.objects.create(event_id="e10", user_id=self.user.id, event_type="START_WORK", timestamp=t0)
        TimeEvent.objects.create(event_id="e11", user_id=self.user.id, event_type="END_WORK", timestamp=t_out)

        TaskLog.objects.create(
            task_id="test_tl_before",
            user_id=self.user.id,
            employee_id="QA001",
            employee_name="QA Tester",
            date=now.astimezone(IST).date().isoformat(),
            project_name="QA Testing Project",
            task_name="QA Verification Task",
            start_time=t_task,
            end_time=t_out,
            status="COMPLETED",
            duration_seconds=60,
            work_segments=[{"start": t_task, "end": t_out, "duration_seconds": 60}]
        )

        res_status = self.client.get('/api/tracker/status/')
        s_data = res_status.json()
        self.assertEqual(s_data["total_work_seconds"], 90)

        res_tasks = self.client.get(f'/api/tasks/daily/?date={now.astimezone(IST).date().isoformat()}')
        t_data = res_tasks.json()
        self.assertEqual(t_data["total_task_seconds"], 60)
        self.assertEqual(t_data["tasks"][0]["duration_seconds"], 60)
