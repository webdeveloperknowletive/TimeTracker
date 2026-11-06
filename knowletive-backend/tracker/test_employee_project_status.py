from datetime import datetime, timezone
from django.test import TestCase
from rest_framework.test import APIClient
from tracker.models import User, Project, ProjectTask, EmployeeProjectStatus, ProjectAuditHistory, TimeEvent
from tracker.storage_adapter import storage

class EmployeeProjectStatusTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.employee1 = User.objects.create_user(
            username='emp1',
            email='emp1@example.com',
            password='Password@123',
            first_name='Alice',
            last_name='Smith',
            role='EMPLOYEE',
            employee_id='EMP001'
        )
        self.employee2 = User.objects.create_user(
            username='emp2',
            email='emp2@example.com',
            password='Password@123',
            first_name='Bob',
            last_name='Jones',
            role='EMPLOYEE',
            employee_id='EMP002'
        )
        self.admin = User.objects.create_superuser(
            username='admin_test',
            email='admin@knowletive.com',
            password='Admin@12345',
            first_name='Admin',
            last_name='User',
            role='ADMIN'
        )
        self.project = Project.objects.create(
            name='Alpha Project',
            description='Test Project',
            created_by=self.admin
        )

    def test_auto_initialization_on_first_work(self):
        """Starting a task initializes employee project contribution as Just Started."""
        self.client.force_authenticate(user=self.employee1)
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Alpha Project',
            'task_name': 'Feature 1',
            'description': 'Working on feature'
        })
        self.assertEqual(res.status_code, 201)

        eps = EmployeeProjectStatus.objects.filter(user=self.employee1, project_name='Alpha Project').first()
        self.assertIsNotNone(eps)
        self.assertEqual(eps.status, 'JUST_STARTED')

        # Status view reflects my_project_status
        status_res = self.client.get('/api/tracker/status/')
        self.assertEqual(status_res.status_code, 200)
        active_task = status_res.data.get('active_task')
        self.assertIsNotNone(active_task)
        self.assertEqual(active_task.get('my_project_status'), 'JUST_STARTED')
        self.assertEqual(active_task.get('my_project_status_display'), 'Just Started')

    def test_employee_update_status_without_approval(self):
        """Employee can update status to IN_PROGRESS or COMPLETED directly."""
        self.client.force_authenticate(user=self.employee1)
        # Update to IN_PROGRESS
        res = self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'IN_PROGRESS'
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'IN_PROGRESS')
        self.assertEqual(res.data['status_display'], 'In Progress')

        eps = EmployeeProjectStatus.objects.get(user=self.employee1, project_name='Alpha Project')
        self.assertEqual(eps.status, 'IN_PROGRESS')

        # Update to COMPLETED
        res = self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'COMPLETED'
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'COMPLETED')
        self.assertEqual(res.data['status_display'], 'Completed')

        eps.refresh_from_db()
        self.assertEqual(eps.status, 'COMPLETED')

        # Check audit log
        audit = ProjectAuditHistory.objects.filter(
            action='EMPLOYEE_PROJECT_STATUS_UPDATED',
            actor=self.employee1
        ).order_by('timestamp').last()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details['new_status'], 'COMPLETED')

    def test_resuming_work_transitions_completed_to_in_progress(self):
        """If an employee explicitly starts further work after marking Completed, it transitions to In Progress."""
        self.client.force_authenticate(user=self.employee1)
        # Mark as Completed
        self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'COMPLETED'
        })
        eps = EmployeeProjectStatus.objects.get(user=self.employee1, project_name='Alpha Project')
        self.assertEqual(eps.status, 'COMPLETED')

        # Now start further work on the same project
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Alpha Project',
            'task_name': 'Additional Revision',
            'description': 'Follow up work'
        })
        self.assertEqual(res.status_code, 201)

        eps.refresh_from_db()
        self.assertEqual(eps.status, 'IN_PROGRESS')

        # Audit history records the transition
        audit = ProjectAuditHistory.objects.filter(
            action='EMPLOYEE_PROJECT_STATUS_RESUMED',
            actor=self.employee1
        ).last()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details['old_status'], 'COMPLETED')
        self.assertEqual(audit.details['new_status'], 'IN_PROGRESS')

    def test_shared_project_statuses_are_independent(self):
        """Two employees contributing to the same project have independent statuses."""
        # Emp1 marks Completed
        self.client.force_authenticate(user=self.employee1)
        self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'COMPLETED'
        })

        # Emp2 marks In Progress
        self.client.force_authenticate(user=self.employee2)
        self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'IN_PROGRESS'
        })

        eps1 = EmployeeProjectStatus.objects.get(user=self.employee1, project_name='Alpha Project')
        eps2 = EmployeeProjectStatus.objects.get(user=self.employee2, project_name='Alpha Project')
        self.assertEqual(eps1.status, 'COMPLETED')
        self.assertEqual(eps2.status, 'IN_PROGRESS')

        # The project itself is not marked COMPLETED
        self.project.refresh_from_db()
        self.assertNotEqual(self.project.status, 'COMPLETED')

    def test_timer_actions_do_not_change_project_status(self):
        """Pause, break, stopping timer, and End Workday must not mark the project Completed."""
        self.client.force_authenticate(user=self.employee1)
        # Start task
        self.client.post('/api/tasks/start/', {
            'project_name': 'Alpha Project',
            'task_name': 'Task A'
        })
        # Set project status to In Progress
        self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'IN_PROGRESS'
        })

        # Start Break
        self.client.post('/api/attendance/action/', {'action': 'START_BREAK'})
        eps = EmployeeProjectStatus.objects.get(user=self.employee1, project_name='Alpha Project')
        self.assertEqual(eps.status, 'IN_PROGRESS')

        # Resume Work
        self.client.post('/api/attendance/action/', {'action': 'RESUME_WORK'})
        eps.refresh_from_db()
        self.assertEqual(eps.status, 'IN_PROGRESS')

        # End Workday
        self.client.post('/api/attendance/action/', {'action': 'END_WORK'})
        eps.refresh_from_db()
        self.assertEqual(eps.status, 'IN_PROGRESS')

    def test_admin_visibility_and_serialization(self):
        """Admin project views serialize employee project status with timestamps and tracked time."""
        # Employee 1 sets status
        self.client.force_authenticate(user=self.employee1)
        self.client.post('/api/tasks/start/', {
            'project_name': 'Alpha Project',
            'task_name': 'Task 1'
        })
        self.client.post('/api/employee/project-status/', {
            'project_name': 'Alpha Project',
            'status': 'COMPLETED'
        })

        # Admin lists projects
        self.client.force_authenticate(user=self.admin)
        res = self.client.get('/api/projects/?period=all')
        self.assertEqual(res.status_code, 200)
        projects = res.data.get('projects', [])
        p_data = next((p for p in projects if p['project_id'] == self.project.project_id), None)
        self.assertIsNotNone(p_data)

        # Check assigned_employees in project list
        emp_list = p_data.get('assigned_employees', [])
        emp1_rec = next((e for e in emp_list if e['id'] == self.employee1.id), None)
        self.assertIsNotNone(emp1_rec)
        self.assertEqual(emp1_rec.get('employee_project_status'), 'COMPLETED')
        self.assertEqual(emp1_rec.get('employee_project_status_display'), 'Completed')
        self.assertIsNotNone(emp1_rec.get('employee_project_status_updated_at'))

        # Check detailed project view
        detail_res = self.client.get(f'/api/projects/{self.project.project_id}/?period=all')
        self.assertEqual(detail_res.status_code, 200)
        contributions = detail_res.data.get('employee_contributions', [])
        c_emp1 = next((c for c in contributions if c['user_id'] == self.employee1.id), None)
        self.assertIsNotNone(c_emp1)
        self.assertEqual(c_emp1.get('employee_project_status'), 'COMPLETED')
        self.assertEqual(c_emp1.get('employee_project_status_display'), 'Completed')

