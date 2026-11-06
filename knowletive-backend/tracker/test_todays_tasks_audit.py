import json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from tracker.models import User, TaskLog, Project, ProjectTask, WorkSession, TimeEvent
from tracker.views import IST_TZ

class TodaysTasksDailyViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.now_utc = datetime.now(timezone.utc)
        self.now_ist = self.now_utc.astimezone(IST_TZ)
        self.today_str = self.now_ist.date().isoformat()
        self.yesterday_utc = self.now_utc - timedelta(days=1)
        self.yesterday_ist = self.yesterday_utc.astimezone(IST_TZ)
        self.yesterday_str = self.yesterday_ist.date().isoformat()

        self.employee = User.objects.create_user(
            username='emp_daily_qa',
            email='daily_qa@knowletive.com',
            password='TestPassword123!',
            first_name='Daily',
            last_name='Tester',
            role='EMPLOYEE',
            department='Engineering',
            designation='Software Developer',
            employee_id='EMP_DQA_01'
        )
        self.emp_token = Token.objects.create(user=self.employee)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp_token.key}')

    def test_todays_tasks_includes_active_completed_and_multi_sessions(self):
        """
        - Show all tasks worked on today (running, paused, stopped, completed).
        - Include tasks created earlier if they have work activity or were completed today.
        - Exclude tasks with only previous-day activity.
        - Show each task once and calculate duration from today's actual work segments.
        """
        # 1. Start Workday
        self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'}, format='json')

        # 2. Start Task A
        res_a = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Alpha',
            'task_name': 'Task Alpha 1',
            'description': 'Initial run',
            'project_status': 'IN_PROGRESS'
        }, format='json')
        self.assertIn(res_a.status_code, [200, 201])

        # Stop Task A
        res_stop = self.client.post('/api/tasks/end/', {}, format='json')
        self.assertEqual(res_stop.status_code, 200)

        # 3. Resume Task A later today (multiple sessions for same task)
        res_a2 = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Alpha',
            'task_name': 'Task Alpha 1',
            'description': 'Second session',
            'project_status': 'IN_PROGRESS'
        }, format='json')
        self.assertIn(res_a2.status_code, [200, 201])

        # Complete Task A
        res_comp = self.client.post('/api/tasks/end/', {'status': 'COMPLETED'}, format='json')
        self.assertEqual(res_comp.status_code, 200)

        # 4. Start Task B (Current running task)
        res_b = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Beta',
            'task_name': 'Task Beta Live',
            'description': 'Currently active',
            'project_status': 'IN_PROGRESS'
        }, format='json')
        self.assertIn(res_b.status_code, [200, 201])

        # 5. Create a Task C with ONLY yesterday's activity (must be excluded)
        tl_yesterday = TaskLog.objects.create(
            task_id='TL-YEST-001',
            user_id=self.employee.id,
            project_name='Project Gamma',
            task_name='Old Task Yesterday',
            status='COMPLETED',
            created_at=self.yesterday_utc.isoformat(),
            start_time=(self.yesterday_utc - timedelta(hours=2)).isoformat(),
            end_time=(self.yesterday_utc - timedelta(hours=1)).isoformat(),
            work_segments=[{
                'start_time': (self.yesterday_utc - timedelta(hours=2)).isoformat(),
                'end_time': (self.yesterday_utc - timedelta(hours=1)).isoformat()
            }]
        )

        # 6. Fetch Today's Tasks
        res_daily = self.client.get('/api/tasks/daily/')
        self.assertEqual(res_daily.status_code, 200)
        tasks = res_daily.data['tasks']

        task_names = [t['task_name'] for t in tasks]
        # Task A must appear ONCE even though it had 2 sessions
        self.assertEqual(task_names.count('Task Alpha 1'), 1)
        # Task B must appear
        self.assertIn('Task Beta Live', task_names)
        # Old Task Yesterday must NOT appear
        self.assertNotIn('Old Task Yesterday', task_names)

        # Check Active Task
        active = res_daily.data.get('active_task')
        self.assertIsNotNone(active)
        self.assertEqual(active['task_name'], 'Task Beta Live')

        # Check Task Alpha 1 status is COMPLETED
        alpha_task = next(t for t in tasks if t['task_name'] == 'Task Alpha 1')
        self.assertEqual(alpha_task['status'], 'COMPLETED')

        # Check project breakdown
        pb = res_daily.data.get('project_breakdown', [])
        pb_names = [p['project_name'] for p in pb]
        self.assertIn('Project Alpha', pb_names)
        self.assertIn('Project Beta', pb_names)
        self.assertNotIn('Project Gamma', pb_names)

    def test_older_task_worked_on_today_counts_only_todays_duration(self):
        """
        An older task with work yesterday (3600s) and today (1800s) must only count 1800s in Today's Tasks.
        """
        today_start_seg = self.now_utc - timedelta(minutes=30)
        today_end_seg = self.now_utc
        TaskLog.objects.create(
            task_id='TL-MULTI-DAY-001',
            user_id=self.employee.id,
            project_name='MultiDay Proj',
            task_name='MultiDay Task',
            status='COMPLETED',
            created_at=self.yesterday_utc.isoformat(),
            start_time=(self.yesterday_utc - timedelta(hours=2)).isoformat(),
            end_time=today_end_seg.isoformat(),
            work_segments=[
                {
                    'start_time': (self.yesterday_utc - timedelta(hours=2)).isoformat(),
                    'end_time': (self.yesterday_utc - timedelta(hours=1)).isoformat()
                },
                {
                    'start_time': today_start_seg.isoformat(),
                    'end_time': today_end_seg.isoformat()
                }
            ]
        )

        res = self.client.get('/api/tasks/daily/')
        self.assertEqual(res.status_code, 200)
        tasks = res.data['tasks']
        md_task = next((t for t in tasks if t['task_name'] == 'MultiDay Task'), None)
        self.assertIsNotNone(md_task)
        # Duration should be approx 1800 seconds (today's segment), NOT 5400 seconds
        self.assertAlmostEqual(md_task['duration_seconds'], 1800, delta=5)

    def test_admin_query_employee_daily_tasks(self):
        """
        Admins can query an employee's daily tasks using user_id param.
        """
        admin = User.objects.create_superuser(
            username='admin_qa',
            email='admin_qa@knowletive.com',
            password='TestPassword123!',
            role='ADMIN'
        )
        admin_token = Token.objects.create(user=admin)
        admin_client = APIClient()
        admin_client.credentials(HTTP_AUTHORIZATION=f'Token {admin_token.key}')

        # Create active task today for employee
        TaskLog.objects.create(
            task_id='TL-EMP-TODAY-001',
            user_id=self.employee.id,
            project_name='Admin Seen Proj',
            task_name='Admin Seen Task',
            status='COMPLETED',
            created_at=self.now_utc.isoformat(),
            start_time=(self.now_utc - timedelta(minutes=10)).isoformat(),
            end_time=self.now_utc.isoformat(),
            work_segments=[{
                'start_time': (self.now_utc - timedelta(minutes=10)).isoformat(),
                'end_time': self.now_utc.isoformat()
            }]
        )

        res = admin_client.get(f'/api/tasks/daily/?user_id={self.employee.id}')
        self.assertEqual(res.status_code, 200)
        tasks = res.data['tasks']
        task_names = [t['task_name'] for t in tasks]
        self.assertIn('Admin Seen Task', task_names)

