import json
from datetime import datetime, timezone
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import User, TaskLog, Project, ProjectTask, WorkSession, TimeEvent


class JobFunctionTaskTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin_user = User.objects.create_superuser(
            username='admin',
            email='admin@knowletive.com',
            password='Admin@12345',
            role='ADMIN',
            department='Administration',
            designation='Administrator'
        )

        self.dev_user = User.objects.create_user(
            username='developer1',
            email='dev1@knowletive.com',
            password='Password123!',
            first_name='Dev',
            last_name='User',
            role='EMPLOYEE',
            department='Engineering',
            designation='Software Developer',
            employee_id='EMP101'
        )

        self.hr_user = User.objects.create_user(
            username='hr1',
            email='hr1@knowletive.com',
            password='Password123!',
            first_name='HR',
            last_name='User',
            role='EMPLOYEE',
            department='Human Resources',
            designation='HR',
            employee_id='EMP102'
        )

        self.analyst_user = User.objects.create_user(
            username='analyst1',
            email='analyst1@knowletive.com',
            password='Password123!',
            first_name='Data',
            last_name='Analyst',
            role='EMPLOYEE',
            department='Data & Analytics',
            designation='Data Analyst',
            employee_id='EMP103'
        )

        self.unspecified_user = User.objects.create_user(
            username='general1',
            email='general1@knowletive.com',
            password='Password123!',
            first_name='General',
            last_name='Employee',
            role='EMPLOYEE',
            department='',
            designation='',
            employee_id='EMP104'
        )

    def test_designation_returned_in_profile_and_daily_tasks(self):
        """User profile and daily tasks endpoints must include designation."""
        self.client.force_authenticate(user=self.dev_user)
        res = self.client.get('/api/auth/me/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['designation'], 'Software Developer')

        res_daily = self.client.get('/api/tasks/daily/')
        self.assertEqual(res_daily.status_code, 200)
        self.assertEqual(res_daily.data['employee']['designation'], 'Software Developer')

    def test_software_developer_starts_preset_task(self):
        """Software Developer can start a preset task like 'Frontend'."""
        self.client.force_authenticate(user=self.dev_user)
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Core',
            'task_name': 'Frontend',
            'description': 'Building dashboard UI',
            'project_status': 'IN_PROGRESS'
        })
        self.assertIn(res.status_code, (200, 201))
        self.assertEqual(res.data['task']['task_name'], 'Frontend')

        task = TaskLog.objects.filter(user_id=self.dev_user.id).last()
        self.assertIsNotNone(task)
        self.assertEqual(task.task_name, 'Frontend')

    def test_hr_starts_preset_task(self):
        """HR user can start a preset task like 'Tracking Employee Records'."""
        self.client.force_authenticate(user=self.hr_user)
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'HR Operations',
            'task_name': 'Tracking Employee Records',
            'description': 'Updating employee files',
            'project_status': 'JUST_STARTED'
        })
        self.assertIn(res.status_code, (200, 201))
        self.assertEqual(res.data['task']['task_name'], 'Tracking Employee Records')

    def test_data_analyst_starts_preset_task(self):
        """Data analyst can start a preset task like 'SQL Queries'."""
        self.client.force_authenticate(user=self.analyst_user)
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Analytics Hub',
            'task_name': 'SQL Queries',
            'description': 'Optimizing monthly metrics query',
            'project_status': 'IN_PROGRESS'
        })
        self.assertIn(res.status_code, (200, 201))
        self.assertEqual(res.data['task']['task_name'], 'SQL Queries')

    def test_custom_task_name_saved_not_other(self):
        """When selecting Other and typing a custom name, the actual custom name is saved."""
        self.client.force_authenticate(user=self.dev_user)
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Infrastructure',
            'task_name': 'Redis Cluster Setup',
            'description': 'Configuring sentinel',
            'project_status': 'JUST_STARTED'
        })
        self.assertIn(res.status_code, (200, 201))
        self.assertEqual(res.data['task']['task_name'], 'Redis Cluster Setup')
        self.assertNotEqual(res.data['task']['task_name'].lower(), 'other')

    def test_backend_rejects_literal_other_and_break(self):
        """Backend rejects literal 'Other' or 'Break' as task names."""
        self.client.force_authenticate(user=self.dev_user)
        
        # Test literal 'Other'
        res_other = self.client.post('/api/tasks/start/', {
            'project_name': 'Testing Proj',
            'task_name': 'Other',
            'description': 'Some notes'
        })
        self.assertEqual(res_other.status_code, 400)
        self.assertIn('specific task name', res_other.data['error'].lower())

        # Test 'Break'
        res_break = self.client.post('/api/tasks/start/', {
            'project_name': 'Testing Proj',
            'task_name': 'Break',
            'description': 'Lunch break'
        })
        self.assertEqual(res_break.status_code, 400)
        self.assertIn('break', res_break.data['error'].lower())

    def test_unspecified_job_function_allows_custom_entry(self):
        """Employee with no job function can enter any custom task name."""
        self.client.force_authenticate(user=self.unspecified_user)
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Company Meeting',
            'task_name': 'Quarterly All-Hands Discussion',
            'description': 'Strategy alignment'
        })
        self.assertIn(res.status_code, (200, 201))
        self.assertEqual(res.data['task']['task_name'], 'Quarterly All-Hands Discussion')

    def test_editing_legacy_task_preserves_custom_name(self):
        """Editing an existing task preserves custom names absent from presets."""
        self.client.force_authenticate(user=self.dev_user)
        start_res = self.client.post('/api/tasks/start/', {
            'project_name': 'Legacy App',
            'task_name': 'Legacy Migration Patch v1.2',
            'description': 'Initial work'
        })
        self.assertIn(start_res.status_code, (200, 201))
        task_log_id = start_res.data['task']['task_log_id']

        # Update description while keeping the same legacy task name
        update_res = self.client.patch(f'/api/tasks/{task_log_id}/', {
            'project_name': 'Legacy App',
            'task_name': 'Legacy Migration Patch v1.2',
            'description': 'Updated work description'
        })
        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(update_res.data['task']['task_name'], 'Legacy Migration Patch v1.2')

    def test_admin_updates_employee_designation(self):
        """Admin can assign or update an employee's job function / designation."""
        self.client.force_authenticate(user=self.admin_user)
        res = self.client.patch(f'/api/admin/users/{self.unspecified_user.id}/', {
            'designation': 'Data Analyst'
        })
        self.assertEqual(res.status_code, 200)

        self.unspecified_user.refresh_from_db()
        self.assertEqual(self.unspecified_user.designation, 'Data Analyst')

    def test_admin_assigns_independent_designation_and_role(self):
        """Designation (job function) and Access Role are strictly independent."""
        self.client.force_authenticate(user=self.admin_user)

        # 1. Create a user with HR designation + ADMIN role
        create_res = self.client.post('/api/admin/users/', {
            'username': 'hr_admin_lead',
            'email': 'hr_lead@knowletive.com',
            'first_name': 'Priya',
            'last_name': 'Sharma',
            'designation': 'HR',
            'role': 'ADMIN',
            'password': 'LeadPassword123!'
        })
        self.assertIn(create_res.status_code, (200, 201))
        new_user = User.objects.get(username='hr_admin_lead')
        self.assertEqual(new_user.designation, 'HR')
        self.assertEqual(new_user.role, 'ADMIN')
        self.assertTrue(new_user.is_staff)

        # 2. Update to custom designation while leaving password empty (preserve existing password)
        orig_pw_hash = new_user.password
        patch_res = self.client.patch(f'/api/admin/users/{new_user.id}/', {
            'designation': 'Senior HR Specialist',
            'first_name': 'Priya',
            'last_name': 'Sharma',
            'role': 'ADMIN'
        })
        self.assertEqual(patch_res.status_code, 200)
        new_user.refresh_from_db()
        self.assertEqual(new_user.designation, 'Senior HR Specialist')
        self.assertEqual(new_user.role, 'ADMIN')
        self.assertEqual(new_user.password, orig_pw_hash)

        # 3. Demote from ADMIN to EMPLOYEE -> immediately strips admin privileges
        demote_res = self.client.patch(f'/api/admin/users/{new_user.id}/', {
            'role': 'EMPLOYEE',
            'designation': 'Senior HR Specialist'
        })
        self.assertEqual(demote_res.status_code, 200)
        new_user.refresh_from_db()
        self.assertEqual(new_user.role, 'EMPLOYEE')
        self.assertFalse(new_user.is_staff)
        self.assertFalse(new_user.is_superuser)

        # 4. Demoted user now gets 403 on admin-only endpoints
        self.client.force_authenticate(user=new_user)
        unauthorized_res = self.client.get('/api/admin/users/')
        self.assertEqual(unauthorized_res.status_code, 403)

    def test_non_admin_cannot_change_designation_or_role(self):
        """Unauthorized employees cannot alter user positions or roles."""
        self.client.force_authenticate(user=self.dev_user)
        res = self.client.patch(f'/api/admin/users/{self.dev_user.id}/', {
            'role': 'ADMIN',
            'designation': 'CTO'
        })
        self.assertEqual(res.status_code, 403)
        self.dev_user.refresh_from_db()
        self.assertEqual(self.dev_user.role, 'EMPLOYEE')
        self.assertEqual(self.dev_user.designation, 'Software Developer')
