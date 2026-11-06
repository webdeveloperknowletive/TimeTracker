from datetime import datetime, timezone, timedelta
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import User, Project, ProjectTask, WorkSession, TaskProgressNote, EmployeeProjectStatus
from tracker.views import IST_TZ


class ProjectProgressDetailsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='admin_lead',
            email='admin_lead@knowletive.com',
            password='AdminPassword123!',
            role='ADMIN'
        )
        self.emp1 = User.objects.create_user(
            username='alice_dev',
            email='alice@knowletive.com',
            password='Password123!',
            first_name='Alice',
            last_name='Dev',
            role='EMPLOYEE',
            employee_id='EMP001'
        )
        self.emp2 = User.objects.create_user(
            username='bob_qa',
            email='bob@knowletive.com',
            password='Password123!',
            first_name='Bob',
            last_name='QA',
            role='EMPLOYEE',
            employee_id='EMP002'
        )
        self.client.force_authenticate(user=self.admin)

    def test_fetch_project_by_stable_id_and_separate_duplicate_names(self):
        """
        Projects with identical names must remain completely separate and fetchable
        via their distinct stable project_id.
        """
        proj1 = Project.objects.create(
            project_id='PRJ-OCR-001',
            name='OCR LEAD GEN',
            description='Client A Lead Generation Pipeline',
            created_by=self.admin
        )
        proj2 = Project.objects.create(
            project_id='PRJ-OCR-002',
            name='OCR LEAD GEN',
            description='Client B Lead Generation Pipeline',
            created_by=self.admin
        )

        # Task under proj1
        task1 = ProjectTask.objects.create(
            task_id='TSK-001',
            project=proj1,
            title='Document Scanning Engine',
            assigned_to=self.emp1,
            status='IN_PROGRESS',
            total_duration_seconds=3600
        )
        # Task under proj2
        task2 = ProjectTask.objects.create(
            task_id='TSK-002',
            project=proj2,
            title='Data Extraction Pipeline',
            assigned_to=self.emp2,
            status='COMPLETED',
            total_duration_seconds=7200
        )

        # Fetch proj1 details
        res1 = self.client.get(f'/api/projects/{proj1.project_id}/')
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.data['project']['project_id'], 'PRJ-OCR-001')
        self.assertEqual(res1.data['project']['description'], 'Client A Lead Generation Pipeline')
        task_ids_1 = [t['task_id'] for t in res1.data['tasks']]
        self.assertIn('TSK-001', task_ids_1)
        self.assertNotIn('TSK-002', task_ids_1)

        # Fetch proj2 details
        res2 = self.client.get(f'/api/projects/{proj2.project_id}/')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data['project']['project_id'], 'PRJ-OCR-002')
        self.assertEqual(res2.data['project']['description'], 'Client B Lead Generation Pipeline')
        task_ids_2 = [t['task_id'] for t in res2.data['tasks']]
        self.assertIn('TSK-002', task_ids_2)
        self.assertNotIn('TSK-001', task_ids_2)

    def test_mixed_reported_statuses_and_task_details(self):
        """
        Tests that multiple employees reporting different statuses are accurately reflected
        in assigned_employees and employee_contributions, separate from task completion.
        """
        proj = Project.objects.create(
            project_id='PRJ-OCR-MIX',
            name='OCR LEAD GEN',
            description='Pipeline Integration',
            created_by=self.admin
        )
        task1 = ProjectTask.objects.create(
            task_id='TSK-M1',
            project=proj,
            title='Frontend Uploader',
            assigned_to=self.emp1,
            status='IN_PROGRESS',
            total_duration_seconds=1800
        )
        task2 = ProjectTask.objects.create(
            task_id='TSK-M2',
            project=proj,
            title='Backend Validator',
            assigned_to=self.emp2,
            status='COMPLETED',
            total_duration_seconds=3600
        )

        # Alice reports IN_PROGRESS, Bob reports COMPLETED
        EmployeeProjectStatus.objects.create(
            user=self.emp1,
            project_name='OCR LEAD GEN',
            status='IN_PROGRESS'
        )
        EmployeeProjectStatus.objects.create(
            user=self.emp2,
            project_name='OCR LEAD GEN',
            status='COMPLETED'
        )

        res = self.client.get(f'/api/projects/{proj.project_id}/')
        self.assertEqual(res.status_code, 200)
        
        assigned_emps = res.data['project']['assigned_employees']
        emp_status_map = {e['id']: e['employee_project_status'] for e in assigned_emps}
        self.assertEqual(emp_status_map.get(self.emp1.id), 'IN_PROGRESS')
        self.assertEqual(emp_status_map.get(self.emp2.id), 'COMPLETED')

        # Recorded tasks completion is 1 of 2
        self.assertEqual(res.data['project']['completed_tasks'], 1)
        self.assertEqual(res.data['project']['total_tasks'], 2)

    def test_saved_tasks_included_without_notes_or_sessions(self):
        """
        Tasks without any work sessions or notes must not be excluded from the details task list.
        """
        proj = Project.objects.create(
            project_id='PRJ-EMPTY-TASKS',
            name='Brand New Project',
            created_by=self.admin
        )
        task = ProjectTask.objects.create(
            task_id='TSK-BARE',
            project=proj,
            title='Bare Architecture Blueprint',
            assigned_to=self.emp1,
            status='NOT_STARTED',
            total_duration_seconds=0
        )

        res = self.client.get(f'/api/projects/{proj.project_id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['tasks']), 1)
        self.assertEqual(res.data['tasks'][0]['task_id'], 'TSK-BARE')
        self.assertEqual(res.data['tasks'][0]['status'], 'NOT_STARTED')
        self.assertEqual(res.data['tasks'][0]['title'], 'Bare Architecture Blueprint')

    def test_interval_ist_formatting_and_running_session(self):
        """
        Tests that work intervals are formatted in IST, running sessions show '... – Running',
        and time in period reflects actual work excluding breaks.
        """
        now_utc = datetime.now(timezone.utc)
        today_ist = now_utc.astimezone(IST_TZ).date()

        proj = Project.objects.create(
            project_id='PRJ-INT-001',
            name='Interval Test Project',
            created_by=self.admin
        )
        task = ProjectTask.objects.create(
            task_id='TSK-INT-1',
            project=proj,
            title='Core Engine Optimization',
            assigned_to=self.emp1,
            status='IN_PROGRESS',
            total_duration_seconds=120
        )

        # 03:58 PM IST to 04:00 PM IST today
        s_dt = datetime(today_ist.year, today_ist.month, today_ist.day, 15, 58, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        e_dt = datetime(today_ist.year, today_ist.month, today_ist.day, 16, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)

        WorkSession.objects.create(
            session_id='SESS-INT-1',
            task=task,
            user=self.emp1,
            date=str(today_ist),
            start_time=s_dt.isoformat(),
            end_time=e_dt.isoformat(),
            duration_seconds=120,
            status='ENDED'
        )

        res = self.client.get(f'/api/projects/{proj.project_id}/?period=today')
        self.assertEqual(res.status_code, 200)
        p_data = res.data['project']
        self.assertEqual(p_data['primary_interval'], '03:58 PM – 04:00 PM')
        self.assertEqual(p_data['extra_intervals_count'], 0)

        # Now test running session
        task2 = ProjectTask.objects.create(
            task_id='TSK-INT-RUN',
            project=proj,
            title='Realtime Ingestion',
            assigned_to=self.emp1,
            status='IN_PROGRESS'
        )
        run_start = now_utc - timedelta(minutes=15)
        run_start_ist = run_start.astimezone(IST_TZ).strftime('%I:%M %p')
        WorkSession.objects.create(
            session_id='SESS-INT-RUN',
            task=task2,
            user=self.emp1,
            date=str(today_ist),
            start_time=run_start.isoformat(),
            current_segment_start=run_start.isoformat(),
            status='IN_PROGRESS'
        )

        res_run = self.client.get(f'/api/projects/{proj.project_id}/?period=today')
        self.assertEqual(res_run.status_code, 200)
        p_data_run = res_run.data['project']
        self.assertEqual(p_data_run['primary_interval'], f"{run_start_ist} – Running")
        self.assertEqual(p_data_run['extra_intervals_count'], 1)

    def test_interval_ist_weekly_monthly_includes_date(self):
        """
        Weekly, Monthly, Custom Range, and All Time views must include the date beside each interval.
        """
        now_utc = datetime.now(timezone.utc)
        today_ist = now_utc.astimezone(IST_TZ).date()

        proj = Project.objects.create(
            project_id='PRJ-WEEK-001',
            name='Weekly Range Project',
            created_by=self.admin
        )
        task = ProjectTask.objects.create(
            task_id='TSK-WEEK-1',
            project=proj,
            title='Weekly Audit',
            assigned_to=self.emp2,
            status='COMPLETED'
        )
        s_dt = datetime(today_ist.year, today_ist.month, today_ist.day, 10, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        e_dt = datetime(today_ist.year, today_ist.month, today_ist.day, 11, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)

        WorkSession.objects.create(
            session_id='SESS-WEEK-1',
            task=task,
            user=self.emp2,
            date=str(today_ist),
            start_time=s_dt.isoformat(),
            end_time=e_dt.isoformat(),
            duration_seconds=3600,
            status='ENDED'
        )

        res_weekly = self.client.get(f'/api/projects/{proj.project_id}/?period=weekly')
        self.assertEqual(res_weekly.status_code, 200)
        p_weekly = res_weekly.data['project']
        date_prefix = today_ist.strftime('%d %b')
        self.assertTrue(p_weekly['primary_interval'].startswith(f"{date_prefix}, 10:00 AM – 11:00 AM"))

    def test_breaks_not_combined_into_continuous_interval(self):
        """
        Work segments separated by pauses/breaks must remain separate intervals, not merged together.
        """
        now_utc = datetime.now(timezone.utc)
        today_ist = now_utc.astimezone(IST_TZ).date()

        proj = Project.objects.create(
            project_id='PRJ-BREAK-001',
            name='Break Tracking Project',
            created_by=self.admin
        )
        task = ProjectTask.objects.create(
            task_id='TSK-BRK-1',
            project=proj,
            title='Database Migration',
            assigned_to=self.emp1,
            status='COMPLETED'
        )

        # Two segments with a 30-min break between 02:00 PM and 02:30 PM
        seg1_s = datetime(today_ist.year, today_ist.month, today_ist.day, 13, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        seg1_e = datetime(today_ist.year, today_ist.month, today_ist.day, 14, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)

        seg2_s = datetime(today_ist.year, today_ist.month, today_ist.day, 14, 30, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        seg2_e = datetime(today_ist.year, today_ist.month, today_ist.day, 15, 30, 0, tzinfo=IST_TZ).astimezone(timezone.utc)

        WorkSession.objects.create(
            session_id='SESS-BRK-1',
            task=task,
            user=self.emp1,
            date=str(today_ist),
            start_time=seg1_s.isoformat(),
            end_time=seg2_e.isoformat(),
            duration_seconds=7200,
            status='ENDED',
            work_segments=[
                {'start_time': seg1_s.isoformat(), 'end_time': seg1_e.isoformat()},
                {'start_time': seg2_s.isoformat(), 'end_time': seg2_e.isoformat()}
            ]
        )

        res = self.client.get(f'/api/projects/{proj.project_id}/?period=today')
        self.assertEqual(res.status_code, 200)
        p_data = res.data['project']
        # 2 distinct intervals, not 1 continuous span from 01:00 PM to 03:30 PM
        self.assertEqual(len(p_data['period_intervals']), 2)
        interval_displays = [item['interval_display'] for item in p_data['period_intervals']]
        self.assertIn('01:00 PM – 02:00 PM', interval_displays)
        self.assertIn('02:30 PM – 03:30 PM', interval_displays)
        # Most recent interval is primary:
        self.assertEqual(p_data['primary_interval'], '02:30 PM – 03:30 PM')
        self.assertEqual(p_data['extra_intervals_count'], 1)

    def test_no_work_sessions_shows_no_work_session(self):
        """
        Projects without work sessions must display 'No work session' rather than inventing timestamps.
        """
        proj = Project.objects.create(
            project_id='PRJ-NONE-001',
            name='Untracked Project',
            created_by=self.admin
        )
        ProjectTask.objects.create(
            task_id='TSK-NONE-1',
            project=proj,
            title='Research RFC',
            assigned_to=self.emp1,
            status='NOT_STARTED'
        )

        res = self.client.get(f'/api/projects/{proj.project_id}/?period=today')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['project']['primary_interval'], 'No work session')
        self.assertEqual(res.data['project']['extra_intervals_count'], 0)
