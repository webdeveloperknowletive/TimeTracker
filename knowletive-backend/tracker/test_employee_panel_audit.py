import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')
django.setup()

import time
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo
from django.test import Client, TestCase
from tracker.models import User, Project, ProjectTask, WorkSession, TaskLog, TimeEvent, TaskProgressNote
from rest_framework.authtoken.models import Token
from tracker.views import calculate_day_metrics, parse_iso_utc, format_task_seconds

IST = ZoneInfo("Asia/Kolkata")

class EmployeePanelQAAuditTests(TestCase):
    """
    Comprehensive QA Audit & Verification Test Suite for the Employee Panel:
    1. Attendance & Mutual Exclusivity (Start Workday, Break, Resume, End)
    2. Idempotency & Rapid Clicks (Deduplication)
    3. Server-side Authority on Timers
    4. Project & Task Creation, Validation, Editing & Notes
    5. Task Actions (Start, Pause, Resume, Stop, Switch, Complete, Reopen)
    6. Daily History Rules (All tasks worked on today appear, older idle tasks excluded)
    7. Multi-Employee Isolation & Security
    8. Complete End-to-End Daily Workflow Execution
    """

    def setUp(self):
        self.now_utc = datetime.now(timezone.utc)
        self.now_ist = self.now_utc.astimezone(IST)
        self.today_str = self.now_ist.date().isoformat()
        self.yesterday_str = (self.now_ist.date() - timedelta(days=1)).isoformat()
        self.yesterday_utc = self.now_utc - timedelta(days=1)

        # Isolated test users
        self.emp1 = User.objects.create_user(
            username='qa_alice', email='alice@knowletive.test', password='TestPass123!',
            role='EMPLOYEE', employee_id='EMP_QA_01', first_name='Alice', last_name='Tester'
        )
        self.emp1_token = Token.objects.create(user=self.emp1)

        self.emp2 = User.objects.create_user(
            username='qa_bob', email='bob@knowletive.test', password='TestPass123!',
            role='EMPLOYEE', employee_id='EMP_QA_02', first_name='Bob', last_name='Auditor'
        )
        self.emp2_token = Token.objects.create(user=self.emp2)

        self.admin = User.objects.create_user(
            username='qa_admin', email='admin@knowletive.test', password='TestPass123!',
            role='ADMIN', employee_id='ADMIN_01', first_name='QA', last_name='Lead'
        )
        self.admin_token = Token.objects.create(user=self.admin)

        self.client_emp1 = Client()
        self.client_emp1.defaults['HTTP_AUTHORIZATION'] = f'Token {self.emp1_token.key}'

        self.client_emp2 = Client()
        self.client_emp2.defaults['HTTP_AUTHORIZATION'] = f'Token {self.emp2_token.key}'

        self.client_admin = Client()
        self.client_admin.defaults['HTTP_AUTHORIZATION'] = f'Token {self.admin_token.key}'

        self.project = Project.objects.create(name='QA Core Project', status='IN_PROGRESS')

    # =========================================================================
    # MODULE 1: ATTENDANCE STATE MACHINE & MUTUAL EXCLUSIVITY
    # =========================================================================
    def test_attendance_state_machine_and_timers(self):
        # 1. Initially Not Started
        status_res = self.client_emp1.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'Not Started')

        # 2. Invalid action transitions rejected
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'START_BREAK'}, content_type='application/json')
        self.assertEqual(res.status_code, 400) # Cannot start break when not working
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'RESUME_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 400)
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'END_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 400)

        # 3. Start Workday
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        status_res = self.client_emp1.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'Working')
        self.assertIsNotNone(status_res.data['start_time'])

        # 4. Start Break (freezes work time, starts break)
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'START_BREAK'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        status_res = self.client_emp1.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'On Break')

        # 5. Resume Work (ends break, resumes work)
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'RESUME_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        status_res = self.client_emp1.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'Working')

        # 6. End Workday
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'END_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        status_res = self.client_emp1.get('/api/tracker/status/')
        self.assertEqual(status_res.data['status'], 'Ended')
        self.assertIsNotNone(status_res.data['end_time'])

        # 7. Cannot start work after workday has ended
        res = self.client_emp1.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')
        self.assertEqual(res.status_code, 400)

    # =========================================================================
    # MODULE 2: IDEMPOTENCY & RAPID DUPLICATE CLICKS
    # =========================================================================
    def test_idempotency_and_rapid_double_clicks(self):
        # First click: START_WORK
        res1 = self.client_emp2.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')
        self.assertEqual(res1.status_code, 200)

        # Immediate rapid second click (within 2 seconds) -> Rejected with 400 or 429
        res2 = self.client_emp2.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')
        self.assertIn(res2.status_code, [400, 429])

        # Exactly 1 event exists
        events = TimeEvent.objects.filter(user_id=self.emp2.id)
        self.assertEqual(events.count(), 1)

    # =========================================================================
    # MODULE 3: TASK LIFECYCLE & MUTUALLY EXCLUSIVE ACTIONS
    # =========================================================================
    def test_task_actions_lifecycle(self):
        # Clock in first
        self.client_emp1.post('/api/tracker/action/', {'action': 'START_WORK'}, content_type='application/json')

        # Required field validation
        res_fail = self.client_emp1.post('/api/tasks/start/', {'project_name': '', 'task_name': ''}, content_type='application/json')
        self.assertEqual(res_fail.status_code, 400)

        # 1. Start Task A
        res_a = self.client_emp1.post('/api/tasks/start/', {
            'project_name': 'QA Core Project',
            'task_name': 'Task Alpha',
            'description': 'QA Testing Lifecycle'
        }, content_type='application/json')
        self.assertEqual(res_a.status_code, 201)
        task_a_data = res_a.data['task']
        task_a_id = task_a_data.get('project_task_id') or task_a_data['task_log_id']

        # Task A status IN_PROGRESS
        status_res = self.client_emp1.get('/api/tracker/status/')
        self.assertEqual(status_res.data['active_task']['task_name'], 'Task Alpha')

        # 2. Pause Task A via /project-tasks/<id>/pause/
        p_task_a = ProjectTask.objects.get(title='Task Alpha', assigned_to=self.emp1)
        res_pause = self.client_emp1.post(f'/api/project-tasks/{p_task_a.task_id}/pause/')
        self.assertEqual(res_pause.status_code, 200)
        session_a = WorkSession.objects.get(task=p_task_a, user=self.emp1)
        self.assertEqual(session_a.status, 'PAUSED')

        # 3. Resume Task A
        res_res = self.client_emp1.post(f'/api/project-tasks/{p_task_a.task_id}/start/')
        self.assertEqual(res_res.status_code, 200)
        session_a.refresh_from_db()
        self.assertEqual(session_a.status, 'IN_PROGRESS')

        # 4. Stop Task A (leaves task in progress, ends session)
        res_stop = self.client_emp1.post(f'/api/project-tasks/{p_task_a.task_id}/stop/')
        self.assertEqual(res_stop.status_code, 200)
        p_task_a.refresh_from_db()
        session_a.refresh_from_db()
        self.assertEqual(p_task_a.status, 'IN_PROGRESS')
        self.assertEqual(session_a.status, 'ENDED')

        # 5. Start Task B -> Switch Task
        res_b = self.client_emp1.post('/api/tasks/start/', {
            'project_name': 'QA Core Project',
            'task_name': 'Task Beta',
            'description': 'Testing Switching'
        }, content_type='application/json')
        self.assertEqual(res_b.status_code, 201)
        p_task_b = ProjectTask.objects.get(title='Task Beta', assigned_to=self.emp1)
        session_b = WorkSession.objects.get(task=p_task_b, user=self.emp1)
        self.assertEqual(session_b.status, 'IN_PROGRESS')

        # 6. Add Progress Note to Task B
        res_note = self.client_emp1.post(f'/api/project-tasks/{p_task_b.task_id}/note/', {'content': 'Audit Progress Note'}, content_type='application/json')
        self.assertEqual(res_note.status_code, 200)
        self.assertEqual(TaskProgressNote.objects.filter(task=p_task_b).count(), 1)

        # 7. Complete Task B
        res_comp = self.client_emp1.post(f'/api/project-tasks/{p_task_b.task_id}/complete/')
        self.assertEqual(res_comp.status_code, 200)
        p_task_b.refresh_from_db()
        self.assertEqual(p_task_b.status, 'COMPLETED')
        self.assertIsNotNone(p_task_b.completed_at)

        # 8. Reopen Task B (Reason required)
        res_reopen_fail = self.client_emp1.post(f'/api/project-tasks/{p_task_b.task_id}/reopen/', {'reason': ''}, content_type='application/json')
        self.assertEqual(res_reopen_fail.status_code, 400)

        res_reopen = self.client_emp1.post(f'/api/project-tasks/{p_task_b.task_id}/reopen/', {'reason': 'QA Regression Reopen'}, content_type='application/json')
        self.assertEqual(res_reopen.status_code, 200)
        p_task_b.refresh_from_db()
        self.assertEqual(p_task_b.status, 'IN_PROGRESS')

    # =========================================================================
    # MODULE 4: DAILY HISTORY RULES (ALL TASKS WORKED ON TODAY)
    # =========================================================================
    def test_daily_history_rules(self):
        # Create an older task with activity ONLY yesterday
        proj_old = Project.objects.create(name='Old Project', status='IN_PROGRESS')
        task_old_idle = ProjectTask.objects.create(
            project=proj_old, title='Old Idle Task', assigned_to=self.emp1, status='IN_PROGRESS'
        )
        ProjectTask.objects.filter(task_id=task_old_idle.task_id).update(created_at=self.yesterday_utc)
        WorkSession.objects.create(
            task=task_old_idle, user=self.emp1, date=self.yesterday_str,
            start_time=self.yesterday_utc.isoformat(),
            end_time=(self.yesterday_utc + timedelta(seconds=1800)).isoformat(),
            duration_seconds=1800, status='ENDED'
        )

        # Create an older task RESUMED TODAY
        task_old_resumed = ProjectTask.objects.create(
            project=self.project, title='Old Resumed Task', assigned_to=self.emp1, status='IN_PROGRESS'
        )
        ProjectTask.objects.filter(task_id=task_old_resumed.task_id).update(created_at=self.yesterday_utc)
        WorkSession.objects.create(
            task=task_old_resumed, user=self.emp1, date=self.today_str,
            start_time=self.now_utc.isoformat(),
            end_time=(self.now_utc + timedelta(seconds=900)).isoformat(),
            duration_seconds=900, status='ENDED'
        )

        # Create a task stopped today
        task_today_stopped = ProjectTask.objects.create(
            project=self.project, title='Today Stopped Task', assigned_to=self.emp1, status='IN_PROGRESS'
        )
        WorkSession.objects.create(
            task=task_today_stopped, user=self.emp1, date=self.today_str,
            start_time=self.now_utc.isoformat(),
            end_time=(self.now_utc + timedelta(seconds=600)).isoformat(),
            duration_seconds=600, status='ENDED'
        )

        # Query /api/tasks/my-tasks/
        res = self.client_emp1.get('/api/tasks/my-tasks/')
        self.assertEqual(res.status_code, 200)
        task_ids = [t['task_id'] for t in res.data['tasks']]

        # 1. Idle yesterday task MUST be excluded
        self.assertNotIn(task_old_idle.task_id, task_ids)

        # 2. Older task resumed today MUST be included
        self.assertIn(task_old_resumed.task_id, task_ids)

        # 3. Stopped task today MUST be included
        self.assertIn(task_today_stopped.task_id, task_ids)

        # 4. Correct counts
        summary = res.data['summary']
        self.assertEqual(summary['total_tasks'], 2)
        self.assertEqual(summary['tasks_worked_today'], 2)

    # =========================================================================
    # MODULE 5: MULTI-EMPLOYEE DATA ISOLATION & SECURITY
    # =========================================================================
    def test_multi_employee_isolation(self):
        # Alice creates a task
        task_alice = ProjectTask.objects.create(
            project=self.project, title="Alice Secret Task", assigned_to=self.emp1, status='IN_PROGRESS'
        )
        WorkSession.objects.create(
            task=task_alice, user=self.emp1, date=self.today_str,
            start_time=self.now_utc.isoformat(), duration_seconds=600, status='ENDED'
        )

        # Bob queries his tasks
        res_bob = self.client_emp2.get('/api/tasks/my-tasks/')
        bob_tasks = [t['task_id'] for t in res_bob.data['tasks']]
        self.assertNotIn(task_alice.task_id, bob_tasks)

        # Bob attempts to start or modify Alice's task directly
        res_hack = self.client_emp2.post(f'/api/project-tasks/{task_alice.task_id}/start/')
        self.assertEqual(res_hack.status_code, 403) # Access denied!

        # Bob attempts to view Alice's daily log
        res_spy = self.client_emp2.get(f'/api/tasks/daily/?user_id={self.emp1.id}')
        self.assertEqual(res_spy.status_code, 403) # Access denied!

    # =========================================================================
    # MODULE 6: ADMIN REPORT SYNCHRONIZATION
    # =========================================================================
    def test_admin_report_synchronization(self):
        # Create a completed session for Alice
        p_task = ProjectTask.objects.create(project=self.project, title="Admin Synced Task", assigned_to=self.emp1, status='COMPLETED')
        WorkSession.objects.create(
            task=p_task, user=self.emp1, date=self.today_str,
            start_time=self.now_utc.isoformat(),
            end_time=(self.now_utc + timedelta(seconds=1800)).isoformat(),
            duration_seconds=1800, status='ENDED'
        )

        # Admin fetches live attendance
        admin_res = self.client_admin.get('/api/admin/dashboard/')
        self.assertEqual(admin_res.status_code, 200)

        # Admin queries Alice's daily tasks
        admin_daily = self.client_admin.get(f'/api/tasks/daily/?user_id={self.emp1.id}&date={self.today_str}')
        self.assertEqual(admin_daily.status_code, 200)
        self.assertEqual(admin_daily.data['employee']['employee_id'], self.emp1.employee_id)

    # =========================================================================
    # MODULE 7: FULL SCENARIO
    # Start Workday -> Task A -> Pause -> Resume -> Stop -> Task B -> Break -> Resume -> Complete B -> Resume A -> End Workday
    # =========================================================================
    def test_full_employee_scenario(self):
        # 1. Start Workday
        r = self.client_emp1.post('/api/tracker/action/', {'action': 'START_WORK'})
        self.assertEqual(r.status_code, 200)

        # 2. Task A -> Start
        r_a = self.client_emp1.post('/api/tasks/start/', {'project_name': 'QA Core Project', 'task_name': 'Scenario Task A'})
        self.assertEqual(r_a.status_code, 201)
        task_a = ProjectTask.objects.get(title='Scenario Task A', assigned_to=self.emp1)

        # 3. Task A -> Pause
        r_pause = self.client_emp1.post(f'/api/project-tasks/{task_a.task_id}/pause/')
        self.assertEqual(r_pause.status_code, 200)

        # 4. Task A -> Resume
        r_res = self.client_emp1.post(f'/api/project-tasks/{task_a.task_id}/start/')
        self.assertEqual(r_res.status_code, 200)

        # 5. Task A -> Stop
        r_stop = self.client_emp1.post(f'/api/project-tasks/{task_a.task_id}/stop/')
        self.assertEqual(r_stop.status_code, 200)

        # 6. Task B -> Start
        r_b = self.client_emp1.post('/api/tasks/start/', {'project_name': 'QA Core Project', 'task_name': 'Scenario Task B'})
        self.assertEqual(r_b.status_code, 201)
        task_b = ProjectTask.objects.get(title='Scenario Task B', assigned_to=self.emp1)

        # 7. Workday -> Break (Pauses Task B)
        r_brk = self.client_emp1.post('/api/tracker/action/', {'action': 'START_BREAK'})
        self.assertEqual(r_brk.status_code, 200)
        session_b = WorkSession.objects.filter(task=task_b, user=self.emp1).first()
        self.assertEqual(session_b.status, 'PAUSED')

        # 8. Workday -> Resume (Resumes Task B)
        r_res_work = self.client_emp1.post('/api/tracker/action/', {'action': 'RESUME_WORK'})
        self.assertEqual(r_res_work.status_code, 200)
        session_b.refresh_from_db()
        self.assertEqual(session_b.status, 'IN_PROGRESS')

        # 9. Task B -> Complete
        r_comp_b = self.client_emp1.post(f'/api/project-tasks/{task_b.task_id}/complete/')
        self.assertEqual(r_comp_b.status_code, 200)
        task_b.refresh_from_db()
        self.assertEqual(task_b.status, 'COMPLETED')

        # 10. Task A -> Resume
        r_res_a = self.client_emp1.post(f'/api/project-tasks/{task_a.task_id}/start/')
        self.assertEqual(r_res_a.status_code, 200)

        # 11. End Workday
        r_end = self.client_emp1.post('/api/tracker/action/', {'action': 'END_WORK'})
        self.assertEqual(r_end.status_code, 200)

        # 12. Verify History has BOTH Task A and Task B
        hist_res = self.client_emp1.get('/api/tasks/my-tasks/')
        self.assertEqual(hist_res.status_code, 200)
        hist_task_ids = [t['task_id'] for t in hist_res.data['tasks']]
        self.assertIn(task_a.task_id, hist_task_ids)
        self.assertIn(task_b.task_id, hist_task_ids)

        # Verify Task A remained IN_PROGRESS (not completed), Task B is COMPLETED
        t_a_data = [t for t in hist_res.data['tasks'] if t['task_id'] == task_a.task_id][0]
        t_b_data = [t for t in hist_res.data['tasks'] if t['task_id'] == task_b.task_id][0]
        self.assertEqual(t_a_data['status'], 'IN_PROGRESS')
        self.assertEqual(t_b_data['status'], 'COMPLETED')

