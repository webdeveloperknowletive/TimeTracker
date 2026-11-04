import io
import json
import zoneinfo
import openpyxl
from datetime import datetime, timezone, timedelta
from django.test import TestCase
from django.urls import reverse
from django.core.management import call_command
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from .models import (
    User, Invitation, Notification, TimeEvent, TaskLog, TimesheetEntry, AuditLog, SystemSettings,
    Project, ProjectTask, WorkSession, TaskProgressNote, ProjectAuditHistory
)
from .storage_adapter import storage

IST_TZ = zoneinfo.ZoneInfo("Asia/Kolkata")


class TimeTrackerTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        
        # Create Admin
        self.admin = User.objects.create_superuser(
            username='admin@knowletive.com',
            email='admin@knowletive.com',
            password='adminpassword',
            first_name='Admin',
            last_name='User',
            role='ADMIN'
        )
        self.admin_token, _ = Token.objects.get_or_create(user=self.admin)

        # Create Employee
        self.employee = User.objects.create_user(
            username='emp@knowletive.com',
            email='emp@knowletive.com',
            password='emppassword',
            first_name='John',
            last_name='Doe',
            role='EMPLOYEE',
            department='Engineering',
            employee_id='JOHN001'
        )
        self.employee_token, _ = Token.objects.get_or_create(user=self.employee)

        # Clean mock file for isolated tests
        storage._ensure_mock_file()
        if storage.use_mock:
            import json
            with open(storage.local_file, 'w', encoding='utf-8') as f:
                json.dump({'TimeEvents': [], 'AuditLog': [], 'Settings': {'work_start_time': '10:00', 'work_end_time': '19:00', 'timezone': 'Asia/Kolkata'}}, f)

    def test_auth_login_and_logout(self):
        # Invalid credentials
        res = self.client.post('/api/auth/login/', {'email': 'emp@knowletive.com', 'password': 'wrong'})
        self.assertEqual(res.status_code, 400)

        # Valid login
        res = self.client.post('/api/auth/login/', {'email': 'emp@knowletive.com', 'password': 'emppassword'})
        self.assertEqual(res.status_code, 200)
        self.assertIn('token', res.data)
        token = res.data['token']

        # Logout
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        res = self.client.post('/api/auth/logout/')
        self.assertEqual(res.status_code, 200)

    def test_permission_enforcement(self):
        # Unauthenticated request to tracker
        res = self.client.get('/api/tracker/status/')
        self.assertEqual(res.status_code, 401)

        # Employee cannot access admin dashboard
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        res = self.client.get('/api/admin/dashboard/')
        self.assertEqual(res.status_code, 403)

        # Admin can access admin dashboard
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/dashboard/')
        self.assertEqual(res.status_code, 200)

    def test_time_tracking_valid_sequence(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        
        # 1. Initial status: Not Started
        res = self.client.get('/api/tracker/status/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'Not Started')

        # 2. Start Work
        res = self.client.post('/api/tracker/action/', {'action': 'START_WORK', 'source': 'web'})
        self.assertEqual(res.status_code, 200)

        res = self.client.get('/api/tracker/status/')
        self.assertEqual(res.data['status'], 'Working')
        self.assertIsNotNone(res.data['start_time'])

        # 3. Start Break
        res = self.client.post('/api/tracker/action/', {'action': 'START_BREAK', 'source': 'web'})
        self.assertEqual(res.status_code, 200)

        res = self.client.get('/api/tracker/status/')
        self.assertEqual(res.data['status'], 'On Break')

        # 4. Resume Work
        res = self.client.post('/api/tracker/action/', {'action': 'RESUME_WORK', 'source': 'web'})
        self.assertEqual(res.status_code, 200)

        res = self.client.get('/api/tracker/status/')
        self.assertEqual(res.data['status'], 'Working')

        # 5. End Work
        res = self.client.post('/api/tracker/action/', {'action': 'END_WORK', 'source': 'web'})
        self.assertEqual(res.status_code, 200)

        res = self.client.get('/api/tracker/status/')
        self.assertEqual(res.data['status'], 'Ended')
        self.assertIsNotNone(res.data['end_time'])

    def test_invalid_state_transitions(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')

        # Cannot start break before starting work
        res = self.client.post('/api/tracker/action/', {'action': 'START_BREAK'})
        self.assertEqual(res.status_code, 400)

        # Cannot resume work before starting work
        res = self.client.post('/api/tracker/action/', {'action': 'RESUME_WORK'})
        self.assertEqual(res.status_code, 400)

        # Cannot end work before starting work
        res = self.client.post('/api/tracker/action/', {'action': 'END_WORK'})
        self.assertEqual(res.status_code, 400)

        # Start work
        self.client.post('/api/tracker/action/', {'action': 'START_WORK'})

        # Cannot start work again while already working
        res = self.client.post('/api/tracker/action/', {'action': 'START_WORK'})
        self.assertEqual(res.status_code, 400)

    def test_admin_correction_workflow_and_audit(self):
        # Employee records START_WORK
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        act_res = self.client.post('/api/tracker/action/', {'action': 'START_WORK'})
        event_id = act_res.data['event']['event_id']

        # Switch to Admin
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # Attempt correction without mandatory reason
        res = self.client.post('/api/admin/corrections/', {
            'event_id': event_id,
            'new_timestamp': '2026-10-07T10:00:00Z',
            'reason': ''
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('strictly required', res.data['error'])

        # Valid correction with reason
        res = self.client.post('/api/admin/corrections/', {
            'event_id': event_id,
            'new_timestamp': '2026-10-07T10:00:00Z',
            'reason': 'Adjusting for missed system clock-in due to power outage'
        })
        self.assertEqual(res.status_code, 200)

        # Verify audit log recorded the correction
        res = self.client.get('/api/admin/audit-logs/')
        self.assertEqual(res.status_code, 200)
        logs = res.data['audit_logs']
        correction_log = next((l for l in logs if l['action'] == 'ADMIN_CORRECTION'), None)
        self.assertIsNotNone(correction_log)
        self.assertIn('Adjusting for missed system clock-in', str(correction_log['details']))

    def test_reports_and_export_formats(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # Fetch JSON reports
        res = self.client.get('/api/admin/reports/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('reports', res.data)

        # CSV Export
        res = self.client.get('/api/admin/reports/export/?format=csv')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers['Content-Type'], 'text/csv; charset=utf-8')
        csv_text = res.content.decode('utf-8')
        self.assertIn('Date (IST)', csv_text)
        self.assertIn('Break Duration', csv_text)

        # Excel Export
        res = self.client.get('/api/admin/reports/export/?format=xlsx')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.assertGreater(len(res.content), 100)

        # Verify Excel headers
        wb = openpyxl.load_workbook(io.BytesIO(res.content))
        ws = wb.active
        headers = [cell.value for cell in ws[4]]
        self.assertIn('Break Duration', headers)

    def test_export_break_duration_columns_and_dynamic_filenames(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # Create two distinct test employees
        emp1 = User.objects.create_user(
            username='ayush.kadam@knowletive.com',
            email='ayush.kadam@knowletive.com',
            password='Password123!',
            first_name='Ayush',
            last_name='Kadam',
            role='EMPLOYEE',
            department='Engineering',
            employee_id='EMP101'
        )
        emp2 = User.objects.create_user(
            username='aman.bendkule@knowletive.com',
            email='aman.bendkule@knowletive.com',
            password='Password123!',
            first_name='Aman',
            last_name='Bendkule',
            role='EMPLOYEE',
            department='Product',
            employee_id='EMP102'
        )

        # Populate recorded time events with breaks
        # Emp 1 (Ayush Kadam) on 2026-10-05:
        # 09:00 IST (03:30 UTC) - START_WORK
        # 13:00 IST (07:30 UTC) - START_BREAK
        # 13:45 IST (08:15 UTC) - RESUME_WORK  (45 min break)
        # 16:00 IST (10:30 UTC) - START_BREAK
        # 16:15 IST (10:45 UTC) - RESUME_WORK  (15 min break)
        # 18:00 IST (12:30 UTC) - END_WORK     (Total break = 1 hr = 01:00:00)
        # Emp 1 on 2026-10-06:
        # 09:30 IST (04:00 UTC) - START_WORK
        # 13:30 IST (08:00 UTC) - START_BREAK
        # 14:00 IST (08:30 UTC) - RESUME_WORK  (30 min break)
        # 18:30 IST (13:00 UTC) - END_WORK     (Total break = 30 min = 00:30:00)

        # Emp 2 (Aman Bendkule) on 2026-10-05:
        # 10:00 IST (04:30 UTC) - START_WORK
        # 12:30 IST (07:00 UTC) - START_BREAK
        # 13:00 IST (07:30 UTC) - RESUME_WORK  (30 min break)
        # 19:00 IST (13:30 UTC) - END_WORK     (Total break = 30 min = 00:30:00)

        events_data = [
            # Ayush - Oct 5
            {'event_id': 'e1', 'user_id': emp1.id, 'event_type': 'START_WORK', 'timestamp': '2026-10-05T03:30:00Z', 'source': 'web'},
            {'event_id': 'e2', 'user_id': emp1.id, 'event_type': 'START_BREAK', 'timestamp': '2026-10-05T07:30:00Z', 'source': 'web'},
            {'event_id': 'e3', 'user_id': emp1.id, 'event_type': 'RESUME_WORK', 'timestamp': '2026-10-05T08:15:00Z', 'source': 'web'},
            {'event_id': 'e4', 'user_id': emp1.id, 'event_type': 'START_BREAK', 'timestamp': '2026-10-05T10:30:00Z', 'source': 'web'},
            {'event_id': 'e5', 'user_id': emp1.id, 'event_type': 'RESUME_WORK', 'timestamp': '2026-10-05T10:45:00Z', 'source': 'web'},
            {'event_id': 'e6', 'user_id': emp1.id, 'event_type': 'END_WORK', 'timestamp': '2026-10-05T12:30:00Z', 'source': 'web'},
            # Ayush - Oct 6
            {'event_id': 'e7', 'user_id': emp1.id, 'event_type': 'START_WORK', 'timestamp': '2026-10-06T04:00:00Z', 'source': 'web'},
            {'event_id': 'e8', 'user_id': emp1.id, 'event_type': 'START_BREAK', 'timestamp': '2026-10-06T08:00:00Z', 'source': 'web'},
            {'event_id': 'e9', 'user_id': emp1.id, 'event_type': 'RESUME_WORK', 'timestamp': '2026-10-06T08:30:00Z', 'source': 'web'},
            {'event_id': 'e10', 'user_id': emp1.id, 'event_type': 'END_WORK', 'timestamp': '2026-10-06T13:00:00Z', 'source': 'web'},
            # Aman - Oct 5
            {'event_id': 'e11', 'user_id': emp2.id, 'event_type': 'START_WORK', 'timestamp': '2026-10-05T04:30:00Z', 'source': 'web'},
            {'event_id': 'e12', 'user_id': emp2.id, 'event_type': 'START_BREAK', 'timestamp': '2026-10-05T07:00:00Z', 'source': 'web'},
            {'event_id': 'e13', 'user_id': emp2.id, 'event_type': 'RESUME_WORK', 'timestamp': '2026-10-05T07:30:00Z', 'source': 'web'},
            {'event_id': 'e14', 'user_id': emp2.id, 'event_type': 'END_WORK', 'timestamp': '2026-10-05T13:30:00Z', 'source': 'web'},
        ]

        # Save events to database
        for ev in events_data:
            TimeEvent.objects.create(**ev)

        # 1. TEST ADMIN PANEL JSON REPORTS API
        rep_res = self.client.get(f'/api/admin/reports/?user_id={emp1.id}&start_date=2026-10-01&end_date=2026-10-07')
        self.assertEqual(rep_res.status_code, 200)
        self.assertEqual(len(rep_res.data['reports']), 7)
        r_oct5 = next(r for r in rep_res.data['reports'] if r['date'] == '2026-10-05')
        self.assertEqual(r_oct5['employee_name'], 'Ayush Kadam')
        self.assertEqual(r_oct5['break_duration'], '01:00:00')
        r_oct6 = next(r for r in rep_res.data['reports'] if r['date'] == '2026-10-06')
        self.assertEqual(r_oct6['break_duration'], '00:30:00')
        self.assertEqual(rep_res.data['summary']['total_break_duration'], '01:30:00')

        # 2. TEST AYUSH KADAM CSV EXPORT (Single Employee, Date Range)
        csv_emp1 = self.client.get(f'/api/admin/reports/export/?format=csv&user_id={emp1.id}&start_date=2026-10-01&end_date=2026-10-07')
        self.assertEqual(csv_emp1.status_code, 200)
        self.assertIn('filename="Ayush_Kadam_Time_Report_2026-10-01_to_2026-10-07.csv"', csv_emp1.headers['Content-Disposition'])
        self.assertEqual(csv_emp1.headers['X-Suggested-Filename'], 'Ayush_Kadam_Time_Report_2026-10-01_to_2026-10-07.csv')
        csv1_content = csv_emp1.content.decode('utf-8')
        self.assertIn('Ayush Kadam', csv1_content)
        self.assertNotIn('Aman Bendkule', csv1_content)  # Filter correctly excludes other employee
        self.assertIn('01:00:00', csv1_content)
        self.assertIn('01:30:00', csv1_content)  # Totals row break duration

        # 3. TEST AYUSH KADAM EXCEL EXPORT (Single Employee, Date Range)
        xlsx_emp1 = self.client.get(f'/api/admin/reports/export/?format=xlsx&user_id={emp1.id}&start_date=2026-10-01&end_date=2026-10-07')
        self.assertEqual(xlsx_emp1.status_code, 200)
        self.assertIn('filename="Ayush_Kadam_Time_Report_2026-10-01_to_2026-10-07.xlsx"', xlsx_emp1.headers['Content-Disposition'])
        self.assertEqual(xlsx_emp1.headers['X-Suggested-Filename'], 'Ayush_Kadam_Time_Report_2026-10-01_to_2026-10-07.xlsx')
        wb1 = openpyxl.load_workbook(io.BytesIO(xlsx_emp1.content))
        ws1 = wb1.active
        headers1 = [cell.value for cell in ws1[4]]
        self.assertIn('Break Duration', headers1)
        date_idx1 = headers1.index('Date (IST)') + 1
        break_dur_idx = headers1.index('Break Duration') + 1
        emp_name_idx = headers1.index('Employee Name') + 1
        
        # Check Oct 5 and Oct 6 rows in Excel
        row_oct5 = next(r for r in range(5, ws1.max_row) if ws1.cell(row=r, column=date_idx1).value == '2026-10-05')
        self.assertEqual(ws1.cell(row=row_oct5, column=emp_name_idx).value, 'Ayush Kadam')
        self.assertEqual(ws1.cell(row=row_oct5, column=break_dur_idx).value, '01:00:00')

        row_oct6 = next(r for r in range(5, ws1.max_row) if ws1.cell(row=r, column=date_idx1).value == '2026-10-06')
        self.assertEqual(ws1.cell(row=row_oct6, column=break_dur_idx).value, '00:30:00')

        # 4. TEST AMAN BENDKULE EXCEL & CSV EXPORT (Single Employee, Full Month)
        xlsx_emp2 = self.client.get(f'/api/admin/reports/export/?format=xlsx&user_id={emp2.id}&start_date=2026-10-01&end_date=2026-10-31')
        self.assertEqual(xlsx_emp2.status_code, 200)
        self.assertIn('filename="Aman_Bendkule_Time_Report_2026-10-01_to_2026-10-31.xlsx"', xlsx_emp2.headers['Content-Disposition'])
        wb2 = openpyxl.load_workbook(io.BytesIO(xlsx_emp2.content))
        ws2 = wb2.active
        headers2 = [cell.value for cell in ws2[4]]
        date_idx2 = headers2.index('Date (IST)') + 1
        row_oct5_aman = next(r for r in range(5, ws2.max_row) if ws2.cell(row=r, column=date_idx2).value == '2026-10-05')
        self.assertEqual(ws2.cell(row=row_oct5_aman, column=emp_name_idx).value, 'Aman Bendkule')
        self.assertEqual(ws2.cell(row=row_oct5_aman, column=break_dur_idx).value, '00:30:00')

        csv_emp2 = self.client.get(f'/api/admin/reports/export/?format=csv&user_id={emp2.id}&start_date=2026-10-01&end_date=2026-10-31')
        self.assertEqual(csv_emp2.status_code, 200)
        self.assertIn('filename="Aman_Bendkule_Time_Report_2026-10-01_to_2026-10-31.csv"', csv_emp2.headers['Content-Disposition'])
        csv2_content = csv_emp2.content.decode('utf-8')
        self.assertIn('Aman Bendkule', csv2_content)
        self.assertNotIn('Ayush Kadam', csv2_content)

        # 5. TEST ALL EMPLOYEES EXPORT (Date Range)
        csv_all = self.client.get('/api/admin/reports/export/?format=csv&start_date=2026-10-01&end_date=2026-10-07')
        self.assertEqual(csv_all.status_code, 200)
        self.assertIn('filename="All_Employees_Time_Report_2026-10-01_to_2026-10-07.csv"', csv_all.headers['Content-Disposition'])
        csv_all_content = csv_all.content.decode('utf-8')
        self.assertIn('Ayush Kadam', csv_all_content)
        self.assertIn('Aman Bendkule', csv_all_content)

        xlsx_all = self.client.get('/api/admin/reports/export/?format=xlsx&start_date=2026-10-01&end_date=2026-10-07')
        self.assertEqual(xlsx_all.status_code, 200)
        self.assertIn('filename="All_Employees_Time_Report_2026-10-01_to_2026-10-07.xlsx"', xlsx_all.headers['Content-Disposition'])

        # 6. TEST MONTH FILTER MODE
        csv_month = self.client.get(f'/api/admin/reports/export/?format=csv&user_id={emp1.id}&date_mode=month&month=10&year=2026')
        self.assertEqual(csv_month.status_code, 200)
        self.assertIn('filename="Ayush_Kadam_Time_Report_2026-10-01_to_2026-10-31.csv"', csv_month.headers['Content-Disposition'])

        # 7. TEST DATE FILTERING EXCLUDES OUT-OF-RANGE DATES
        csv_range_filtered = self.client.get('/api/admin/reports/export/?format=csv&start_date=2026-10-06&end_date=2026-10-07')
        self.assertEqual(csv_range_filtered.status_code, 200)
        csv_filtered_content = csv_range_filtered.content.decode('utf-8')
        self.assertIn('2026-10-06', csv_filtered_content)
        self.assertNotIn('2026-10-05', csv_filtered_content)

    def test_user_management(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # Create new employee
        res = self.client.post('/api/admin/users/', {
            'email': 'alice@knowletive.com',
            'first_name': 'Alice',
            'last_name': 'Smith',
            'department': 'Design',
            'role': 'EMPLOYEE',
            'password': 'SecurePassword123!'
        })
        self.assertEqual(res.status_code, 201)
        new_user_id = res.data['user']['id']

        # Edit employee
        res = self.client.patch(f'/api/admin/users/{new_user_id}/', {
            'department': 'Product',
            'employment_status': 'Part-Time'
        })
        self.assertEqual(res.status_code, 200)

        # Deactivate employee
        res = self.client.patch(f'/api/admin/users/{new_user_id}/', {
            'is_active': False
        })
        self.assertEqual(res.status_code, 200)

        # Deactivated user cannot log in
        client2 = APIClient()
        res = client2.post('/api/auth/login/', {'email': 'alice@knowletive.com', 'password': 'SecurePassword123!'})
        self.assertEqual(res.status_code, 403)

    def test_monthly_timesheet_permissions_and_entries(self):
        # 1. Employee fetches own timesheet
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        res = self.client.get('/api/timesheet/monthly/?year=2026&month=10')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['employee']['id'], self.employee.id)
        self.assertIn('days', res.data)
        self.assertIn('summary', res.data)

        # 2. Employee tries to access Admin's timesheet -> 403 Forbidden
        res = self.client.get(f'/api/timesheet/monthly/?year=2026&month=10&user_id={self.admin.id}')
        self.assertEqual(res.status_code, 403)
        self.assertIn('Access denied', res.data['error'])

        # 3. Employee updates project, task, description for a work date
        res = self.client.post('/api/timesheet/entry/', {
            'date': '2026-10-07',
            'project_name': 'Knowletive Website',
            'task_name': 'Website Redesign',
            'work_description': 'Implemented responsive monthly timesheet grid'
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['entry']['project_name'], 'Knowletive Website')

        # 4. Employee tries to update another user's timesheet entry -> 403 Forbidden
        res = self.client.post('/api/timesheet/entry/', {
            'user_id': self.admin.id,
            'date': '2026-10-07',
            'project_name': 'Hacked Project',
            'task_name': 'Unauthorized',
            'work_description': 'Malicious payload'
        })
        self.assertEqual(res.status_code, 403)

        # 5. Admin can access employee's timesheet and review entries
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get(f'/api/timesheet/monthly/?year=2026&month=10&user_id={self.employee.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['employee']['id'], self.employee.id)
        
        # Verify the saved entry is present
        target_day = next((d for d in res.data['days'] if d['date'] == '2026-10-07'), None)
        self.assertIsNotNone(target_day)
        self.assertEqual(target_day['project_name'], 'Knowletive Website')
        self.assertEqual(target_day['task_name'], 'Website Redesign')

    def test_timesheet_exports(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        
        # Export CSV
        res = self.client.get('/api/timesheet/export/?year=2026&month=10&format=csv')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers['Content-Type'], 'text/csv; charset=utf-8')
        content = res.content.decode('utf-8')
        self.assertIn('KNOWLETIVE MONTHLY EMPLOYEE TIMESHEET', content)
        self.assertIn('Sr. No.', content)

        # Export Excel (.xlsx)
        res = self.client.get('/api/timesheet/export/?year=2026&month=10&format=xlsx')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.assertGreater(len(res.content), 200)

    def test_timewise_task_logging_and_admin_reports(self):
        # 1. Employee starts first task
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Alpha',
            'task_name': 'Reviewing customer data',
            'description': 'Analyzing CSV imports'
        })
        self.assertEqual(res.status_code, 201)
        task1 = res.data['task']
        self.assertEqual(task1['project_name'], 'Project Alpha')
        self.assertEqual(task1['status'], 'IN_PROGRESS')
        self.assertIsNotNone(task1['start_time'])
        task1_id = task1['task_log_id']

        # 2. Cannot start a task without required project name
        res = self.client.post('/api/tasks/start/', {
            'project_name': '',
            'task_name': 'Preparing report',
            'description': 'Drafting Q3 deck'
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('Project name is required', res.data['error'])

        # 3. Employee updates project/task/description of current task
        res = self.client.patch(f'/api/tasks/{task1_id}/', {
            'description': 'Updated description: Analyzing customer churn metrics'
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['task']['description'], 'Updated description: Analyzing customer churn metrics')

        # 4. End first task
        res = self.client.post('/api/tasks/end/', {
            'task_log_id': task1_id
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['task']['status'], 'COMPLETED')
        self.assertIsNotNone(res.data['task']['end_time'])

        # 5. Start second task on the same day
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Beta',
            'task_name': 'Preparing report',
            'description': 'Drafting Q3 deck'
        })
        self.assertEqual(res.status_code, 201)
        task2_id = res.data['task']['task_log_id']

        # 6. Fetch daily tasks for employee
        res = self.client.get('/api/tasks/daily/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['tasks']), 2)
        self.assertEqual(res.data['tasks'][0]['project_name'], 'Project Alpha')
        self.assertEqual(res.data['tasks'][1]['project_name'], 'Project Beta')
        self.assertIn('project_breakdown', res.data)
        self.assertGreaterEqual(len(res.data['project_breakdown']), 2)

        # 7. Employee forbidden from viewing other user's daily tasks
        res = self.client.get(f'/api/tasks/daily/?user_id={self.admin.id}')
        self.assertEqual(res.status_code, 403)

        # 8. Admin view: report with filters
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/tasks/report/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('tasks', res.data)
        self.assertIn('by_employee', res.data)
        self.assertIn('by_project_and_employee', res.data)
        self.assertIn('summary', res.data)

        # Filter by project
        res = self.client.get('/api/admin/tasks/report/?project=Project%20Alpha')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(all(t['project_name'] == 'Project Alpha' for t in res.data['tasks']))

        # 9. Admin CSV export
        res = self.client.get('/api/admin/tasks/export/?format=csv')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers['Content-Type'], 'text/csv; charset=utf-8')
        content = res.content.decode('utf-8')
        self.assertIn('KNOWLETIVE DAILY TIME-WISE TASK REPORT', content)
        self.assertIn('Project Alpha', content)

        # 10. Admin Excel export
        res = self.client.get('/api/admin/tasks/export/?format=xlsx')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.assertGreater(len(res.content), 200)


class EmployeeSignupAndOnboardingTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Create Admin
        self.admin = User.objects.create_superuser(
            username='admin@knowletive.com',
            email='admin@knowletive.com',
            password='AdminPassword123!',
            first_name='Admin',
            last_name='User',
            role='ADMIN',
            approval_status='APPROVED'
        )
        self.admin_token, _ = Token.objects.get_or_create(user=self.admin)

        # Create existing Employee
        self.employee = User.objects.create_user(
            username='existing@knowletive.com',
            email='existing@knowletive.com',
            password='EmployeePassword123!',
            first_name='Existing',
            last_name='Staff',
            role='EMPLOYEE',
            approval_status='APPROVED'
        )
        self.employee_token, _ = Token.objects.get_or_create(user=self.employee)

        # Create test invitation
        self.invitation = Invitation.objects.create(
            code='KNOW-TEST1234',
            created_by=self.admin,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            notes='Test invitation'
        )

        storage._ensure_mock_file()
        if storage.use_mock:
            import json
            with open(storage.local_file, 'w', encoding='utf-8') as f:
                json.dump({'TimeEvents': [], 'TaskLogs': [], 'TimesheetEntries': [], 'AuditLog': [], 'Settings': {'work_start_time': '10:00', 'work_end_time': '19:00', 'timezone': 'Asia/Kolkata'}}, f)

    def test_admin_generate_invitations(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        
        # 1. Admin generates an invitation
        res = self.client.post('/api/admin/invitations/', {
            'recipient_email': 'newhire@knowletive.com',
            'days_valid': 14,
            'notes': 'Engineering candidate'
        })
        self.assertEqual(res.status_code, 201)
        self.assertIn('code', res.data['invitation'])
        code = res.data['invitation']['code']
        self.assertTrue(code.startswith('KNOW-'))

        # 2. Admin lists invitations
        res = self.client.get('/api/admin/invitations/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data['invitations']), 2)

        # 3. Employee forbidden from generating or listing invitations
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        res = self.client.get('/api/admin/invitations/')
        self.assertEqual(res.status_code, 403)
        res = self.client.post('/api/admin/invitations/', {'days_valid': 7})
        self.assertEqual(res.status_code, 403)

    def test_public_signup_strictly_assigns_employee_role(self):
        # 1. Standard public signup receives EMPLOYEE role
        res1 = self.client.post('/api/auth/signup/', {
            'username': 'standard_worker',
            'password': 'password123'
        })
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(res1.data['user']['role'], 'EMPLOYEE')

        worker = User.objects.get(username='standard_worker')
        self.assertEqual(worker.role, 'EMPLOYEE')
        self.assertFalse(worker.is_staff)
        self.assertFalse(worker.is_superuser)
        self.assertTrue(worker.check_password('password123'))
        self.assertNotEqual(worker.password, 'password123')  # Securely hashed

        # 2. Malicious user attempting to request ADMIN role via public signup
        res2 = self.client.post('/api/auth/signup/', {
            'username': 'fake_admin',
            'password': 'password123',
            'role': 'ADMIN',
            'account_type': 'ADMIN'
        })
        self.assertEqual(res2.status_code, 201)
        # Backend MUST strictly override and enforce EMPLOYEE
        self.assertEqual(res2.data['user']['role'], 'EMPLOYEE')

        fake_admin = User.objects.get(username='fake_admin')
        self.assertEqual(fake_admin.role, 'EMPLOYEE')
        self.assertFalse(fake_admin.is_staff)
        self.assertFalse(fake_admin.is_superuser)

    def test_newly_signed_up_employee_forbidden_from_admin_apis(self):
        # Signup new employee
        signup_res = self.client.post('/api/auth/signup/', {
            'username': 'new_recruit',
            'password': 'password123'
        })
        self.assertEqual(signup_res.status_code, 201)
        token = signup_res.data['token']

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token}')

        # 1. Admin Dashboard -> 403
        res = self.client.get('/api/admin/dashboard/')
        self.assertEqual(res.status_code, 403)
        self.assertNotIn('overview', res.data)

        # 2. User Management -> 403
        res = self.client.get('/api/admin/users/')
        self.assertEqual(res.status_code, 403)

        # 3. Reports & Exports -> 403
        res = self.client.get('/api/admin/reports/')
        self.assertEqual(res.status_code, 403)
        res = self.client.get('/api/admin/reports/export/')
        self.assertEqual(res.status_code, 403)

        # 4. Daily Task Reports -> 403
        res = self.client.get('/api/admin/tasks/report/')
        self.assertEqual(res.status_code, 403)
        res = self.client.get('/api/admin/tasks/export/')
        self.assertEqual(res.status_code, 403)

        # 5. Audit Logs -> 403
        res = self.client.get('/api/admin/audit-logs/')
        self.assertEqual(res.status_code, 403)

        # 6. Admin Attendance Corrections -> 403
        res = self.client.post('/api/admin/corrections/', {'event_id': 'xyz', 'reason': 'test'})
        self.assertEqual(res.status_code, 403)

    def test_employee_cannot_access_other_employees_records(self):
        # Create Employee A and Employee B
        emp_a = User.objects.create_user(username='emp_a', password='password123', role='EMPLOYEE')
        emp_b = User.objects.create_user(username='emp_b', password='password123', role='EMPLOYEE')

        token_a, _ = Token.objects.get_or_create(user=emp_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token_a.key}')

        # 1. Employee A requests Employee B's monthly timesheet -> 403 Forbidden
        res_view = self.client.get(f'/api/timesheet/monthly/?user_id={emp_b.id}')
        self.assertEqual(res_view.status_code, 403)

        # 2. Employee A attempts to save timesheet entry for Employee B -> 403 Forbidden
        res_save = self.client.post('/api/timesheet/entry/', {
            'user_id': emp_b.id,
            'date': '2026-10-07',
            'project_name': 'Hacked',
            'task_name': 'Injected'
        })
        self.assertEqual(res_save.status_code, 403)

        # 3. Employee A attempts to export Employee B's timesheet -> 403 Forbidden
        res_export = self.client.get(f'/api/timesheet/export/?user_id={emp_b.id}')
        self.assertEqual(res_export.status_code, 403)

        # 4. Employee A can access their own timesheet -> 200 OK
        res_own = self.client.get(f'/api/timesheet/monthly/?user_id={emp_a.id}')
        self.assertEqual(res_own.status_code, 200)

    def test_first_admin_created_via_management_command(self):
        # Create first admin via setup_admin command
        call_command(
            'setup_admin',
            username='cli_admin',
            password='AdminPassword123!',
            no_input=True
        )

        admin_user = User.objects.get(username='cli_admin')
        self.assertEqual(admin_user.role, 'ADMIN')
        self.assertTrue(admin_user.is_staff)
        self.assertTrue(admin_user.is_superuser)
        self.assertTrue(admin_user.check_password('AdminPassword123!'))

        # Log in through login API
        res = self.client.post('/api/auth/login/', {
            'username': 'cli_admin',
            'password': 'AdminPassword123!'
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['role'], 'ADMIN')

        # Admin CAN access admin dashboard
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {res.data["token"]}')
        dash_res = self.client.get('/api/admin/dashboard/')
        self.assertEqual(dash_res.status_code, 200)

        # Only existing Admin can create another Admin
        create_admin_res = self.client.post('/api/admin/users/', {
            'username': 'second_admin',
            'password': 'AdminPassword123!',
            'role': 'ADMIN'
        })
        self.assertEqual(create_admin_res.status_code, 201)
        self.assertEqual(create_admin_res.data['user']['role'], 'ADMIN')

    def test_duplicate_username_rejected(self):
        signup_data = {
            'username': 'unique_worker',
            'password': 'mypassword123'
        }
        res1 = self.client.post('/api/auth/signup/', signup_data)
        self.assertEqual(res1.status_code, 201)

        # Duplicate signup with same username (case-insensitive)
        signup_data_dup = {
            'username': 'UNIQUE_WORKER',
            'password': 'differentpassword'
        }
        res2 = self.client.post('/api/auth/signup/', signup_data_dup)
        self.assertEqual(res2.status_code, 400)
        self.assertIn('already taken', res2.data['error'].lower())

    def test_username_and_password_validation(self):
        # Empty username
        res = self.client.post('/api/auth/signup/', {
            'username': '',
            'password': 'validpassword123'
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('username is required', res.data['error'].lower())

        # Too short username
        res = self.client.post('/api/auth/signup/', {
            'username': 'ab',
            'password': 'validpassword123'
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('at least 3 characters', res.data['error'].lower())

        # Too short password
        res = self.client.post('/api/auth/signup/', {
            'username': 'validuser',
            'password': '123'
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('at least 6 characters', res.data['error'].lower())

    def test_login_with_username_and_wrong_password(self):
        User.objects.create_user(
            username='sammy',
            password='SecretPassword123!',
            role='EMPLOYEE'
        )

        # 1. Wrong password
        res_wrong = self.client.post('/api/auth/login/', {
            'username': 'sammy',
            'password': 'WrongPassword999'
        })
        self.assertEqual(res_wrong.status_code, 400)
        self.assertIn('invalid username or password', res_wrong.data['error'].lower())

        # 2. Correct password
        res_ok = self.client.post('/api/auth/login/', {
            'username': 'sammy',
            'password': 'SecretPassword123!'
        })
        self.assertEqual(res_ok.status_code, 200)
        self.assertIn('token', res_ok.data)
        self.assertEqual(res_ok.data['user']['role'], 'EMPLOYEE')
        self.assertEqual(res_ok.data['user']['username'], 'sammy')

    def test_deactivated_account_login_blocked(self):
        User.objects.create_user(
            username='disabled_guy',
            password='mypassword123',
            role='EMPLOYEE',
            is_active=False
        )
        res = self.client.post('/api/auth/login/', {
            'username': 'disabled_guy',
            'password': 'mypassword123'
        })
        self.assertEqual(res.status_code, 403)
        self.assertIn('deactivated', res.data['error'].lower())

    def test_admin_attendance_and_reports_exclude_admin_accounts(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        
        # 1. Admin dashboard live attendance excludes admin accounts
        dash_res = self.client.get('/api/admin/dashboard/')
        self.assertEqual(dash_res.status_code, 200)
        
        # Total employees overview must exclude Admin
        total_employees = dash_res.data['overview']['total_employees']
        all_emp_count = User.objects.filter(role='EMPLOYEE').count()
        self.assertEqual(total_employees, all_emp_count)
        
        # Every user row must strictly have role == 'EMPLOYEE'
        returned_user_roles = [u['role'] for u in dash_res.data['users']]
        self.assertTrue(all(r == 'EMPLOYEE' for r in returned_user_roles))
        self.assertNotIn('ADMIN', returned_user_roles)

        # 2. Reports view strictly includes only employees
        rep_res = self.client.get('/api/admin/reports/')
        self.assertEqual(rep_res.status_code, 200)
        for r in rep_res.data['reports']:
            self.assertNotEqual(r['email'], self.admin.email)
            self.assertNotEqual(r['employee_id'], self.admin.id)

        # 3. CSV report export strictly contains only employees
        csv_res = self.client.get('/api/admin/reports/export/?format=csv')
        self.assertEqual(csv_res.status_code, 200)
        csv_content = csv_res.content.decode('utf-8')
        self.assertNotIn(self.admin.email, csv_content)

        # 4. Monthly timesheet for an Admin account is rejected (target must be an Employee)
        ts_res = self.client.get(f'/api/timesheet/monthly/?user_id={self.admin.id}')
        self.assertEqual(ts_res.status_code, 404)
        self.assertIn('Employee not found', ts_res.data['error'])

    def test_admin_tasks_report_strictly_shows_only_employee_tasks(self):
        # Record task for employee
        emp_task = storage.start_task(
            user_id=self.employee.id,
            project_name='Client Portal',
            task_name='Build Auth Flow',
            description='Employee work session',
            user_email=self.employee.email
        )
        storage.end_task(user_id=self.employee.id, task_log_id=emp_task['task_log_id'])

        # Record task for admin (simulate accidental admin task record in storage)
        admin_task = storage.start_task(
            user_id=self.admin.id,
            project_name='Admin Ops',
            task_name='System Configuration',
            description='Admin action',
            user_email=self.admin.email
        )
        storage.end_task(user_id=self.admin.id, task_log_id=admin_task['task_log_id'])

        # Admin fetches daily task report
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/tasks/report/')
        self.assertEqual(res.status_code, 200)
        
        # Verify tasks returned strictly exclude the admin's task
        returned_task_ids = [t['task_log_id'] for t in res.data['tasks']]
        self.assertIn(emp_task['task_log_id'], returned_task_ids)
        self.assertNotIn(admin_task['task_log_id'], returned_task_ids)

        # Verify summary counts only employee tasks
        self.assertEqual(res.data['summary']['total_tasks'], 1)
        self.assertEqual(len(res.data['by_employee']), 1)
        self.assertEqual(res.data['by_employee'][0]['user_id'], self.employee.id)
        self.assertEqual(res.data['by_employee'][0]['employee_id'], self.employee.employee_id or f"EMP{self.employee.id:03d}")

        # Verify CSV export excludes admin task
        csv_res = self.client.get('/api/admin/tasks/export/?format=csv')
        self.assertEqual(csv_res.status_code, 200)
        csv_text = csv_res.content.decode('utf-8')
        self.assertIn('Client Portal', csv_text)
        self.assertNotIn('Admin Ops', csv_text)
        self.assertIn('Employee ID', csv_text)

    def test_employee_id_generation_format_and_uniqueness(self):
        """
        Tests:
        - Uppercase name-based prefix + 3-digit number (e.g. AYUSH001, AMAN002, RAVINA003, AMAY004, SAKSHAM005).
        - Uniqueness: if two employees have the same name or prefix, use next available number.
        - Permanent and never reused, even if an account is deactivated.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        
        # Clean any users other than admin and John
        User.objects.exclude(id__in=[self.admin.id, self.employee.id]).delete()
        self.employee.employee_id = None
        self.employee.save()

        # Create Ayush
        res1 = self.client.post('/api/admin/users/', {
            'username': 'ayush_user1',
            'first_name': 'Ayush',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res1.status_code, 201)
        self.assertEqual(res1.data['user']['employee_id'], 'AYUSH001')

        # Create Aman
        res2 = self.client.post('/api/admin/users/', {
            'username': 'aman_user',
            'first_name': 'Aman',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(res2.data['user']['employee_id'], 'AMAN002')

        # Create Ravina
        res3 = self.client.post('/api/admin/users/', {
            'username': 'ravina_user',
            'first_name': 'Ravina',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res3.status_code, 201)
        self.assertEqual(res3.data['user']['employee_id'], 'RAVINA003')

        # Create Amay
        res4 = self.client.post('/api/admin/users/', {
            'username': 'amay_user',
            'first_name': 'Amay',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res4.status_code, 201)
        self.assertEqual(res4.data['user']['employee_id'], 'AMAY004')

        # Create Saksham
        res5 = self.client.post('/api/admin/users/', {
            'username': 'saksham_user',
            'first_name': 'Saksham',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res5.status_code, 201)
        self.assertEqual(res5.data['user']['employee_id'], 'SAKSHAM005')

        # Create second Ayush (collision with same name) -> must use next available number (006)
        res6 = self.client.post('/api/admin/users/', {
            'username': 'ayush_user2',
            'first_name': 'Ayush',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res6.status_code, 201)
        self.assertEqual(res6.data['user']['employee_id'], 'AYUSH006')

        # Deactivate Ayush 1 (is_active=False)
        ayush1 = User.objects.get(username='ayush_user1')
        ayush1.is_active = False
        ayush1.save()

        # Create third Ayush -> must NOT reuse AYUSH001, must generate AYUSH007
        res7 = self.client.post('/api/admin/users/', {
            'username': 'ayush_user3',
            'first_name': 'Ayush',
            'role': 'EMPLOYEE',
            'password': 'password123'
        })
        self.assertEqual(res7.status_code, 201)
        self.assertEqual(res7.data['user']['employee_id'], 'AYUSH007')

    def test_admin_updates_employee_name_keeps_employee_id_unchanged(self):
        """
        If an employee's name changes, admin can update displayed name while keeping Employee ID unchanged.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        
        emp = User.objects.create_user(
            username='robert_u',
            first_name='Robert',
            last_name='Baratheon',
            role='EMPLOYEE',
            employee_id='ROBERT001'
        )

        res = self.client.patch(f'/api/admin/users/{emp.id}/', {
            'first_name': 'Robb',
            'last_name': 'Stark'
        })
        self.assertEqual(res.status_code, 200)

        emp.refresh_from_db()
        self.assertEqual(emp.first_name, 'Robb')
        self.assertEqual(emp.last_name, 'Stark')
        self.assertEqual(emp.employee_id, 'ROBERT001') # unchanged

    def test_task_creation_auto_attaches_employee_id_and_ignores_client_tampering(self):
        """
        When employee creates task, Employee ID and saved name are automatically attached
        from profile, and any client-provided name/id is ignored.
        """
        emp = User.objects.create_user(
            username='alice_w',
            first_name='Alice',
            last_name='Wonder',
            role='EMPLOYEE',
            employee_id='ALICE001',
            password='password123'
        )
        token, _ = Token.objects.get_or_create(user=emp)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

        # Attempt to tamper by passing fake employee_id and employee_name in payload
        res = self.client.post('/api/tasks/start/', {
            'project_name': 'Project Phoenix',
            'task_name': 'Code Review',
            'description': 'Reviewing PR #42',
            'employee_id': 'HACKER999',
            'employee_name': 'Attacker'
        })
        self.assertEqual(res.status_code, 201)
        created_task = res.data['task']
        
        # Verify server used authenticated user's real employee_id and name
        self.assertEqual(created_task['employee_id'], 'ALICE001')
        self.assertEqual(created_task['employee_name'], 'Alice Wonder')

    def test_employee_can_only_view_own_tasks_admin_can_view_all(self):
        """
        Employees can view only their own task records. Admins can view all.
        """
        emp2 = User.objects.create_user(
            username='bob_builder',
            first_name='Bob',
            last_name='Builder',
            role='EMPLOYEE',
            employee_id='BOB001',
            password='password123'
        )
        token2, _ = Token.objects.get_or_create(user=emp2)

        # self.employee attempts to access emp2's tasks -> 403 Forbidden
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        res_emp = self.client.get(f'/api/tasks/daily/?user_id={emp2.id}')
        self.assertEqual(res_emp.status_code, 403)

        # Admin accesses emp2's tasks -> 200 OK
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_admin = self.client.get(f'/api/tasks/daily/?user_id={emp2.id}')
        self.assertEqual(res_admin.status_code, 200)
        self.assertEqual(res_admin.data['employee']['employee_id'], 'BOB001')

    def test_csv_and_excel_exports_contain_employee_id(self):
        """
        Verify Employee ID is included in admin reports export, tasks export, and timesheet export.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # 1. Reports CSV Export
        res_rep_csv = self.client.get('/api/admin/reports/export/?format=csv')
        self.assertEqual(res_rep_csv.status_code, 200)
        self.assertIn('Employee ID', res_rep_csv.content.decode('utf-8'))

        # 2. Reports Excel Export
        res_rep_xlsx = self.client.get('/api/admin/reports/export/?format=xlsx')
        self.assertEqual(res_rep_xlsx.status_code, 200)
        self.assertEqual(res_rep_xlsx['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

        # 3. Tasks CSV Export
        res_task_csv = self.client.get('/api/admin/tasks/export/?format=csv')
        self.assertEqual(res_task_csv.status_code, 200)
        self.assertIn('Employee ID', res_task_csv.content.decode('utf-8'))

        # 4. Tasks Excel Export
        res_task_xlsx = self.client.get('/api/admin/tasks/export/?format=xlsx')
        self.assertEqual(res_task_xlsx.status_code, 200)
        self.assertEqual(res_task_xlsx['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

        # 5. Timesheet CSV Export
        res_ts_csv = self.client.get(f'/api/timesheet/export/?user_id={self.employee.id}&format=csv')
        self.assertEqual(res_ts_csv.status_code, 200)
        self.assertIn('Employee ID:', res_ts_csv.content.decode('utf-8'))

    def test_admin_cannot_track_employee_work(self):
        """
        Admins cannot record employee work sessions or log employee tasks.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        
        # Admin trying to start workday
        res_action = self.client.post('/api/tracker/action/', {'action': 'START_WORK'})
        self.assertEqual(res_action.status_code, 403)
        self.assertIn('Only employee accounts can track work time', res_action.data['error'])

        # Admin trying to start task
        res_task = self.client.post('/api/tasks/start/', {
            'project_name': 'Admin Work',
            'task_name': 'Reviewing logs',
            'description': 'Supervising'
        })
        self.assertEqual(res_task.status_code, 403)
        self.assertIn('Only employee accounts can log tasks', res_task.data['error'])

    def test_individual_employee_report_filter_and_export_verification(self):
        """
        Verify:
        - Admin can filter report by individual employee and date range / month.
        - The report rows and downloads contain only that employee's records.
        - Records include dates, start/end times, break duration, total work time, project, task, and description.
        - Export totals match the filtered report shown on screen.
        - Changing/clearing filter updates data.
        - Employees cannot download other employees' reports or access admin exports.
        """
        self.employee.employee_id = 'EMP001'
        self.employee.save()

        emp2 = User.objects.create_user(
            username='clara_oswald',
            first_name='Clara',
            last_name='Oswald',
            role='EMPLOYEE',
            employee_id='CLARA001',
            password='password123'
        )
        token2, _ = Token.objects.get_or_create(user=emp2)

        today_str = datetime.now(timezone.utc).astimezone(IST_TZ).date().isoformat()

        # Employee 1 records workday and a timesheet entry
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        self.client.post('/api/tracker/action/', {'action': 'START_WORK'})
        self.client.post('/api/timesheet/entry/', {
            'date': today_str,
            'project_name': 'Knowletive Cloud',
            'task_name': 'Core API Architecture',
            'work_description': 'Refining REST endpoints and authorization'
        })

        # Employee 2 records workday
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token2.key}')
        self.client.post('/api/tracker/action/', {'action': 'START_WORK'})
        self.client.post('/api/timesheet/entry/', {
            'date': today_str,
            'project_name': 'Design System',
            'task_name': 'Component Styling',
            'work_description': 'Glassmorphism and light theme polish'
        })

        # 1. Employee cannot access Admin reports or export
        res_emp_rep = self.client.get('/api/admin/reports/')
        self.assertEqual(res_emp_rep.status_code, 403)
        res_emp_exp = self.client.get('/api/admin/reports/export/?format=csv')
        self.assertEqual(res_emp_exp.status_code, 403)

        # 2. Employee cannot tamper with user_id parameter on timesheet export
        # emp2 downloading own timesheet succeeds
        res_emp2_own = self.client.get(f'/api/timesheet/export/?user_id={emp2.id}&format=csv')
        self.assertEqual(res_emp2_own.status_code, 200)
        # But emp2 tampering with user_id to download Employee 1's timesheet gives 403 Forbidden
        res_tamper_other = self.client.get(f'/api/timesheet/export/?user_id={self.employee.id}&format=csv')
        self.assertEqual(res_tamper_other.status_code, 403)

        # 3. Admin filters specifically for Employee 1
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_admin_rep = self.client.get(f'/api/admin/reports/?employee_id={self.employee.id}&start_date={today_str}&end_date={today_str}')
        self.assertEqual(res_admin_rep.status_code, 200)
        rep_data = res_admin_rep.data['reports']
        summary = res_admin_rep.data['summary']

        # Contains ONLY Employee 1's records
        self.assertEqual(len(rep_data), 1)
        row = rep_data[0]
        self.assertEqual(row['employee_id'], self.employee.employee_id)
        self.assertEqual(row['project'], 'Knowletive Cloud')
        self.assertEqual(row['task'], 'Core API Architecture')
        self.assertEqual(row['description'], 'Refining REST endpoints and authorization')
        self.assertEqual(summary['total_records'], 1)

        # 4. Admin downloads CSV for Employee 1
        res_csv = self.client.get(f'/api/admin/reports/export/?format=csv&employee_id={self.employee.id}&start_date={today_str}&end_date={today_str}')
        self.assertEqual(res_csv.status_code, 200)
        csv_text = res_csv.content.decode('utf-8')
        self.assertIn(self.employee.employee_id, csv_text)
        self.assertNotIn('CLARA001', csv_text) # Other employee MUST NOT be present
        self.assertIn('Knowletive Cloud', csv_text)
        self.assertIn('Core API Architecture', csv_text)
        self.assertIn('TOTALS', csv_text)
        self.assertIn(summary['total_work_duration'], csv_text)

        # 5. Admin downloads Excel for Employee 1
        res_xlsx = self.client.get(f'/api/admin/reports/export/?format=xlsx&employee_id={self.employee.id}&start_date={today_str}&end_date={today_str}')
        self.assertEqual(res_xlsx.status_code, 200)
        stream = io.BytesIO(res_xlsx.content)
        wb = openpyxl.load_workbook(stream)
        ws = wb.active
        # Header row 4, Data row 5, Totals row 6
        cell_vals = [cell.value for cell in ws[5]]
        self.assertIn(self.employee.employee_id, cell_vals)
        self.assertIn('Knowletive Cloud', cell_vals)
        self.assertNotIn('CLARA001', [c.value for row in ws.rows for c in row if c.value])

        # 6. Clearing/changing filter to Employee 2
        res_admin_rep2 = self.client.get(f'/api/admin/reports/?employee_id={emp2.id}&start_date={today_str}&end_date={today_str}')
        self.assertEqual(res_admin_rep2.status_code, 200)
        self.assertEqual(res_admin_rep2.data['reports'][0]['employee_id'], 'CLARA001')
        self.assertEqual(res_admin_rep2.data['reports'][0]['project'], 'Design System')

    def test_public_signup_role_integrity(self):
        """
        Public employee signup must always create an Employee account.
        Users cannot choose or assign themselves Admin.
        """
        res = self.client.post('/api/auth/signup/', {
            'username': 'attacker_admin',
            'password': 'StrongPassword123!',
            'role': 'ADMIN' # Malicious attempt to elevate role
        })
        self.assertEqual(res.status_code, 201)
        created_user = User.objects.get(username='attacker_admin')
        self.assertEqual(created_user.role, 'EMPLOYEE')
        self.assertFalse(created_user.is_staff)
        self.assertFalse(created_user.is_superuser)
        self.assertTrue(created_user.employee_id.startswith('ATTACKER'))

    def test_admin_edit_user_work_email(self):
        """
        Verify that Admin can edit a user's work email in User Management,
        validations are enforced, and the user can subsequently sign in with the new email.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        
        # 1. Update employee's work email
        res = self.client.patch(f'/api/admin/users/{self.employee.id}/', {
            'email': 'new.work.email@knowletive.com'
        })
        self.assertEqual(res.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.email, 'new.work.email@knowletive.com')

        # 2. Verify user list includes new email
        list_res = self.client.get('/api/admin/users/')
        self.assertEqual(list_res.status_code, 200)
        emp_data = next((u for u in list_res.data['users'] if u['id'] == self.employee.id), None)
        self.assertIsNotNone(emp_data)
        self.assertEqual(emp_data['email'], 'new.work.email@knowletive.com')

        # 3. Employee can log in with new work email
        self.client.credentials()  # Clear admin credentials for public login call
        login_res = self.client.post('/api/auth/login/', {
            'username': 'new.work.email@knowletive.com',
            'password': 'EmployeePassword123!'
        })
        self.assertEqual(login_res.status_code, 200)
        self.assertEqual(login_res.data['user']['email'], 'new.work.email@knowletive.com')

        # 4. Attempt to set duplicate email -> 400
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        dup_res = self.client.patch(f'/api/admin/users/{self.employee.id}/', {
            'email': self.admin.email
        })
        self.assertEqual(dup_res.status_code, 400)
        self.assertIn('already used', dup_res.data['error'])

        # 5. Attempt to set invalid email -> 400
        inv_res = self.client.patch(f'/api/admin/users/{self.employee.id}/', {
            'email': 'not-an-email'
        })
        self.assertEqual(inv_res.status_code, 400)
        self.assertIn('valid work email', inv_res.data['error'])

        # 6. Non-admin cannot edit user
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.employee_token.key}')
        unauth_res = self.client.patch(f'/api/admin/users/{self.admin.id}/', {
            'email': 'hacked@knowletive.com'
        })
        self.assertEqual(unauth_res.status_code, 403)


class AnalyticsDashboardTests(TestCase):
    def setUp(self):
        storage._ensure_mock_file()
        with open(storage.local_file, 'w', encoding='utf-8') as f:
            json.dump({
                'TimeEvents': [],
                'TimesheetEntries': [],
                'TaskLogs': [],
                'AuditLog': [],
                'Settings': {'work_start_time': '10:00', 'work_end_time': '19:00', 'timezone': 'Asia/Kolkata'},
                'Users': []
            }, f, indent=2)

        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='admin_analytics@knowletive.com',
            email='admin_analytics@knowletive.com',
            password='Password123!',
            role='ADMIN',
            employee_id='ADM001',
            first_name='Admin',
            last_name='User'
        )
        self.admin_token = Token.objects.create(user=self.admin)

        self.emp1 = User.objects.create_user(
            username='emp1_analytics@knowletive.com',
            email='emp1_analytics@knowletive.com',
            password='Password123!',
            role='EMPLOYEE',
            employee_id='EMP001',
            first_name='Aman',
            last_name='Bendkule',
            department='SD'
        )
        self.emp1_token = Token.objects.create(user=self.emp1)

        self.emp2 = User.objects.create_user(
            username='emp2_analytics@knowletive.com',
            email='emp2_analytics@knowletive.com',
            password='Password123!',
            role='EMPLOYEE',
            employee_id='EMP002',
            first_name='Ayush',
            last_name='Kadam',
            department='AI/DATA'
        )
        self.emp2_token = Token.objects.create(user=self.emp2)

        # Seed realistic events
        storage.record_event(self.emp1.id, 'START_WORK')
        storage.record_event(self.emp1.id, 'START_BREAK')
        storage.record_event(self.emp1.id, 'RESUME_WORK')
        storage.record_event(self.emp1.id, 'END_WORK')

        # Seed tasks
        t1 = storage.start_task(self.emp1.id, 'Project Alpha', 'Feature 1', 'Desc', 'EMP001', 'Aman Bendkule')
        storage.end_task(self.emp1.id, t1['task_log_id'])

        t2 = storage.start_task(self.emp2.id, 'Project Beta', 'Model training', 'Desc', 'EMP002', 'Ayush Kadam')
        storage.end_task(self.emp2.id, t2['task_log_id'])

    def test_employee_permissions_enforced(self):
        # Authenticated as emp1
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        
        # Request analytics
        res = self.client.get('/api/analytics/dashboard/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user_role'], 'EMPLOYEE')
        self.assertFalse(res.data['is_admin'])

        # emp1 can only see their own tasks
        self.assertEqual(res.data['summary']['total_tasks'], 1)
        self.assertEqual(res.data['by_project'][0]['project_name'], 'Project Alpha')

        # If emp1 maliciously passes employee_id=EMP002, backend MUST enforce emp1's scope
        res_malicious = self.client.get(f'/api/analytics/dashboard/?employee_id={self.emp2.id}')
        self.assertEqual(res_malicious.status_code, 200)
        self.assertEqual(res_malicious.data['summary']['total_tasks'], 1)
        self.assertEqual(res_malicious.data['by_project'][0]['project_name'], 'Project Alpha')

    def test_admin_analytics_and_filtering(self):
        # Authenticated as admin
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # 1. Admin gets all team analytics
        res = self.client.get('/api/analytics/dashboard/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user_role'], 'ADMIN')
        self.assertTrue(res.data['is_admin'])
        self.assertEqual(res.data['summary']['total_tasks'], 2)
        self.assertEqual(len(res.data['by_project']), 2)
        self.assertIn('Project Alpha', [p['project_name'] for p in res.data['by_project']])
        self.assertIn('Project Beta', [p['project_name'] for p in res.data['by_project']])

        # 2. Admin filters by employee
        res_filtered_emp = self.client.get(f'/api/analytics/dashboard/?employee_id={self.emp2.id}')
        self.assertEqual(res_filtered_emp.status_code, 200)
        self.assertEqual(res_filtered_emp.data['summary']['total_tasks'], 1)
        self.assertEqual(res_filtered_emp.data['by_project'][0]['project_name'], 'Project Beta')

        # 3. Admin filters by project
        res_filtered_proj = self.client.get('/api/analytics/dashboard/?project=Alpha')
        self.assertEqual(res_filtered_proj.status_code, 200)
        self.assertEqual(res_filtered_proj.data['summary']['total_tasks'], 1)
        self.assertEqual(res_filtered_proj.data['by_project'][0]['project_name'], 'Project Alpha')


class HourlyTaskReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='hourly_admin@knowletive.com',
            email='hourly_admin@knowletive.com',
            password='password123',
            first_name='Admin',
            last_name='Leader',
            role='ADMIN'
        )
        self.admin_token, _ = Token.objects.get_or_create(user=self.admin)

        self.emp1 = User.objects.create_user(
            username='alice@knowletive.com',
            email='alice@knowletive.com',
            password='password123',
            first_name='Alice',
            last_name='Wonderland',
            role='EMPLOYEE',
            department='Engineering',
            employee_id='EMP101'
        )
        self.emp1_token, _ = Token.objects.get_or_create(user=self.emp1)

        self.emp2 = User.objects.create_user(
            username='bob@knowletive.com',
            email='bob@knowletive.com',
            password='password123',
            first_name='Bob',
            last_name='Builder',
            role='EMPLOYEE',
            department='Marketing',
            employee_id='EMP102'
        )
        self.emp2_token, _ = Token.objects.get_or_create(user=self.emp2)

        SystemSettings.objects.all().delete()
        SystemSettings.objects.create(
            company_name='Knowletive',
            workspace_name='Knowletive',
            work_start_time='10:00',
            work_end_time='19:00',
            timezone='Asia/Kolkata'
        )

    def test_permission_enforcement(self):
        """Employees should be blocked (403), while Admins can access."""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res = self.client.get('/api/admin/tasks/hourly-report/')
        self.assertEqual(res.status_code, 403)
        self.assertIn('Admin permissions required', res.data.get('error', ''))

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_admin = self.client.get('/api/admin/tasks/hourly-report/')
        self.assertEqual(res_admin.status_code, 200)
        self.assertIn('slots', res_admin.data)
        self.assertEqual(len(res_admin.data['slots']), 11)

    def test_cross_hour_splitting_and_completion_example(self):
        """
        Tests the exact prompt specification:
        Task A from 10:30 AM to 12:15 PM IST without breaks, completed at 12:15 PM IST.
        - 10-11 AM: 30 minutes (1800s); 0 completed.
        - 11 AM-12 PM: 60 minutes (3600s); 0 completed.
        - 12-1 PM: 15 minutes (900s); 1 completed.
        """
        # IST is UTC+05:30
        # 10:30 AM IST = 05:00:00 UTC
        # 12:15 PM IST = 06:45:00 UTC
        start_utc = "2026-11-03T05:00:00Z"
        end_utc = "2026-11-03T06:45:00Z"
        duration_sec = 6300  # 1h 45m = 1800 + 3600 + 900

        TaskLog.objects.create(
            task_id="task-a-123",
            user_id=self.emp1.id,
            employee_id="EMP101",
            employee_name="Alice Wonderland",
            date="2026-11-03",
            project_name="Client Portal",
            task_name="Task A",
            description="Frontend development",
            status="COMPLETED",
            start_time=start_utc,
            end_time=end_utc,
            duration_seconds=duration_sec,
            work_segments=[{
                "start_time": start_utc,
                "end_time": end_utc,
                "duration_seconds": duration_sec
            }],
            created_at=start_utc,
            updated_at=end_utc
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03')
        self.assertEqual(res.status_code, 200)

        slots = {s['slot_index']: s for s in res.data['slots']}

        # Slot 10: 10:00 AM - 11:00 AM
        slot_10 = slots[10]
        self.assertEqual(slot_10['slot_label'], '10:00 AM–11:00 AM')
        self.assertEqual(slot_10['total_seconds'], 1800)  # 30 mins
        self.assertEqual(slot_10['tasks_worked_count'], 1)
        self.assertEqual(slot_10['tasks_completed_count'], 0)

        # Slot 11: 11:00 AM - 12:00 PM
        slot_11 = slots[11]
        self.assertEqual(slot_11['slot_label'], '11:00 AM–12:00 PM')
        self.assertEqual(slot_11['total_seconds'], 3600)  # 60 mins
        self.assertEqual(slot_11['tasks_worked_count'], 1)
        self.assertEqual(slot_11['tasks_completed_count'], 0)

        # Slot 12: 12:00 PM - 1:00 PM
        slot_12 = slots[12]
        self.assertEqual(slot_12['slot_label'], '12:00 PM–1:00 PM')
        self.assertEqual(slot_12['total_seconds'], 900)  # 15 mins
        self.assertEqual(slot_12['tasks_worked_count'], 1)
        self.assertEqual(slot_12['tasks_completed_count'], 1)

        # Empty slots should report no activity
        slot_9 = slots[9]
        self.assertFalse(slot_9['has_activity'])
        self.assertEqual(slot_9['total_seconds'], 0)
        self.assertEqual(slot_9['tasks_worked_count'], 0)
        self.assertEqual(slot_9['tasks_completed_count'], 0)

    def test_break_exclusion_and_multiple_tasks(self):
        """
        Verify that pauses/breaks are excluded and multiple tasks in one slot increment distinct task counts.
        """
        # Task 1: 10:00 AM - 10:20 AM IST (1200s), Pause 10:20 - 10:40 AM (break), Resume 10:40 - 11:00 AM (1200s)
        # Total worked in 10-11 AM: 2400s (40 min). 20 min break excluded!
        t1_start = "2026-11-03T04:30:00Z"  # 10:00 AM IST
        t1_seg1_end = "2026-11-03T04:50:00Z"  # 10:20 AM IST
        t1_seg2_start = "2026-11-03T05:10:00Z"  # 10:40 AM IST
        t1_end = "2026-11-03T05:30:00Z"  # 11:00 AM IST

        TaskLog.objects.create(
            task_id="task-break-1",
            user_id=self.emp1.id,
            employee_id="EMP101",
            employee_name="Alice Wonderland",
            date="2026-11-03",
            project_name="Project X",
            task_name="Task 1 with break",
            status="COMPLETED",
            start_time=t1_start,
            end_time=t1_end,
            duration_seconds=2400,
            work_segments=[
                {"start_time": t1_start, "end_time": t1_seg1_end, "duration_seconds": 1200},
                {"start_time": t1_seg2_start, "end_time": t1_end, "duration_seconds": 1200}
            ]
        )

        # Task 2 by Emp 2: Worked in the same slot from 10:15 AM to 10:45 AM (1800s, 30 min)
        t2_start = "2026-11-03T04:45:00Z"  # 10:15 AM IST
        t2_end = "2026-11-03T05:15:00Z"  # 10:45 AM IST

        TaskLog.objects.create(
            task_id="task-emp2-2",
            user_id=self.emp2.id,
            employee_id="EMP102",
            employee_name="Bob Builder",
            date="2026-11-03",
            project_name="Marketing Launch",
            task_name="Campaign Banner",
            status="COMPLETED",
            start_time=t2_start,
            end_time=t2_end,
            duration_seconds=1800,
            work_segments=[
                {"start_time": t2_start, "end_time": t2_end, "duration_seconds": 1800}
            ]
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03')
        self.assertEqual(res.status_code, 200)

        slot_10 = [s for s in res.data['slots'] if s['slot_index'] == 10][0]
        # Total worked seconds: 2400 (Alice) + 1800 (Bob) = 4200 seconds (70 minutes total employee labor)
        self.assertEqual(slot_10['total_seconds'], 4200)
        # Distinct tasks worked on: 2
        self.assertEqual(slot_10['tasks_worked_count'], 2)
        # Active employees: 2
        self.assertEqual(slot_10['employees_count'], 2)
        self.assertEqual(len(slot_10['by_employee']), 2)

    def test_exact_hour_boundary_start_inclusive_end_exclusive(self):
        """
        Verify rule: "Treat intervals as start-inclusive and end-exclusive:
        a completion at exactly 11:00 AM belongs to 11:00 AM–12:00 PM."
        """
        # Completed at exactly 11:00:00 AM IST (05:30:00 UTC)
        exact_11_utc = "2026-11-03T05:30:00Z"
        start_utc = "2026-11-03T05:00:00Z"

        TaskLog.objects.create(
            task_id="boundary-task",
            user_id=self.emp1.id,
            employee_id="EMP101",
            employee_name="Alice Wonderland",
            date="2026-11-03",
            project_name="Boundary Check",
            task_name="Exact 11 AM Finish",
            status="COMPLETED",
            start_time=start_utc,
            end_time=exact_11_utc,
            duration_seconds=1800,
            work_segments=[{"start_time": start_utc, "end_time": exact_11_utc, "duration_seconds": 1800}]
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03')
        slots = {s['slot_index']: s for s in res.data['slots']}

        # Slot 10 (10:00 AM–11:00 AM): Completion at exactly 11:00:00 AM does NOT count in slot 10
        self.assertEqual(slots[10]['tasks_completed_count'], 0)
        # Slot 11 (11:00 AM–12:00 PM): Completion at exactly 11:00:00 AM belongs here!
        self.assertEqual(slots[11]['tasks_completed_count'], 1)

    def test_filtering_and_export(self):
        """Verify employee, project, and slot filters as well as export endpoints."""
        TaskLog.objects.create(
            task_id="task-f1",
            user_id=self.emp1.id,
            employee_id="EMP101",
            date="2026-11-03",
            project_name="Web Redesign",
            task_name="Design Mockups",
            status="COMPLETED",
            start_time="2026-11-03T05:00:00Z",
            end_time="2026-11-03T05:30:00Z",
            duration_seconds=1800,
            work_segments=[{"start_time": "2026-11-03T05:00:00Z", "end_time": "2026-11-03T05:30:00Z", "duration_seconds": 1800}]
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # 1. Slot filter
        res_slot = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03&slot=10')
        self.assertEqual(res_slot.status_code, 200)
        self.assertEqual(len(res_slot.data['slots']), 1)
        self.assertEqual(res_slot.data['slots'][0]['slot_index'], 10)

        # 2. Project filter
        res_proj = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03&project=Web')
        self.assertEqual(res_proj.status_code, 200)
        self.assertEqual(res_proj.data['summary']['total_tasks_worked'], 1)

        # 3. CSV Export
        res_csv = self.client.get('/api/admin/tasks/hourly-report/export/?date=2026-11-03&format=csv')
        self.assertEqual(res_csv.status_code, 200)
        self.assertIn('text/csv', res_csv['Content-Type'])
        self.assertIn('KNOWLETIVE HOURLY EMPLOYEE TASK REPORT', res_csv.content.decode('utf-8'))

        # 4. Excel Export
        res_xlsx = self.client.get('/api/admin/tasks/hourly-report/export/?date=2026-11-03&format=xlsx')
        self.assertEqual(res_xlsx.status_code, 200)
        self.assertIn('application/vnd.openxmlformats', res_xlsx['Content-Type'])

    def test_window_boundary_task_and_eleven_slots(self):
        """
        Verify that 11 slots (9 AM to 8 PM) are returned, and tasks overlapping the
        edges (e.g. 8:30 AM to 9:30 AM and 7:30 PM to 8:30 PM) are properly split
        and allocated into the visible slots.
        """
        # Task 1: 8:30 AM - 9:30 AM IST (Nov 3)
        # 8:30 AM IST = 03:00:00 UTC
        # 9:30 AM IST = 04:00:00 UTC
        t1_start = "2026-11-03T03:00:00Z"
        t1_end = "2026-11-03T04:00:00Z"
        dur1 = 3600

        TaskLog.objects.create(
            task_id="morning-task-1",
            user_id=self.emp1.id,
            employee_id="EMP101",
            employee_name="Alice Wonderland",
            date="2026-11-03",
            project_name="Morning Kickoff",
            task_name="Standup & Setup",
            status="COMPLETED",
            start_time=t1_start,
            end_time=t1_end,
            duration_seconds=dur1,
            work_segments=[{"start_time": t1_start, "end_time": t1_end, "duration_seconds": dur1}]
        )

        # Task 2: 7:30 PM - 8:30 PM IST (Nov 3)
        # 7:30 PM IST = 14:00:00 UTC
        # 8:30 PM IST = 15:00:00 UTC
        t2_start = "2026-11-03T14:00:00Z"
        t2_end = "2026-11-03T15:00:00Z"
        dur2 = 3600

        TaskLog.objects.create(
            task_id="evening-task-2",
            user_id=self.emp2.id,
            employee_id="EMP102",
            employee_name="Bob Builder",
            date="2026-11-03",
            project_name="Evening Wrapup",
            task_name="Deployment",
            status="COMPLETED",
            start_time=t2_start,
            end_time=t2_end,
            duration_seconds=dur2,
            work_segments=[{"start_time": t2_start, "end_time": t2_end, "duration_seconds": dur2}]
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03')
        self.assertEqual(res.status_code, 200)
        
        # Exactly 11 slots (hours 9 to 19 inclusive)
        self.assertEqual(len(res.data['slots']), 11)
        slots = {s['slot_index']: s for s in res.data['slots']}

        # First slot (9:00 AM–10:00 AM)
        slot_9 = slots[9]
        self.assertEqual(slot_9['slot_label'], '9:00 AM–10:00 AM')
        self.assertEqual(slot_9['total_seconds'], 1800)  # 9:00 - 9:30 AM = 30 mins
        self.assertEqual(slot_9['tasks_worked_count'], 1)
        self.assertEqual(slot_9['tasks_completed_count'], 1)

        # Last slot (7:00 PM–8:00 PM)
        slot_19 = slots[19]
        self.assertEqual(slot_19['slot_label'], '7:00 PM–8:00 PM')
        self.assertEqual(slot_19['total_seconds'], 1800)  # 7:30 - 8:00 PM = 30 mins
        self.assertEqual(slot_19['tasks_worked_count'], 1)
        self.assertEqual(slot_19['tasks_completed_count'], 0)  # Completed at 8:30 PM (outside 9 AM-8 PM)


class ProjectTaskProgressTests(TestCase):
    """
    Comprehensive test suite for connected Project & Task Progress feature:
    - Relationship: Project -> Assigned Tasks -> Work Sessions
    - Stable IDs
    - Multi-session task tracking without duplicating tasks
    - Status lifecycle: Not Started, In Progress, Ready for Closure, Completed
    - Pause, stop, break, clock-out preserving In Progress status (no accidental completion)
    - Explicit completion closing active session and timestamping atomically
    - Prevention of additional time logging on completed tasks
    - Admin-only project closure, reopen with mandatory reason, reopen task with reason
    - Adding task to closed project rejected until reopened
    - Role and assignment permissions enforcement
    - Progress notes and audit history
    - Hourly report integration with explicit completion timestamps
    """
    def setUp(self):
        self.client = APIClient()

        # Admin User
        self.admin = User.objects.create_superuser(
            username='admin_proj@knowletive.com',
            email='admin_proj@knowletive.com',
            password='adminpassword',
            first_name='Chief',
            last_name='Admin',
            role='ADMIN'
        )
        self.admin_token, _ = Token.objects.get_or_create(user=self.admin)

        # Employee 1
        self.emp1 = User.objects.create_user(
            username='alice_proj@knowletive.com',
            email='alice_proj@knowletive.com',
            password='password123',
            first_name='Alice',
            last_name='Developer',
            role='EMPLOYEE',
            employee_id='ALICE001',
            department='Engineering'
        )
        self.emp1_token, _ = Token.objects.get_or_create(user=self.emp1)

        # Employee 2
        self.emp2 = User.objects.create_user(
            username='bob_proj@knowletive.com',
            email='bob_proj@knowletive.com',
            password='password123',
            first_name='Bob',
            last_name='Designer',
            role='EMPLOYEE',
            employee_id='BOB002',
            department='Design'
        )
        self.emp2_token, _ = Token.objects.get_or_create(user=self.emp2)

        SystemSettings.objects.create(
            company_name='Knowletive',
            work_start_time='10:00',
            work_end_time='19:00',
            timezone='Asia/Kolkata'
        )

    def test_full_project_and_task_progress_lifecycle(self):
        # 1. Admin creates project
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_create_p = self.client.post('/api/projects/', {
            'name': 'Cloud Portal Re-architecture',
            'description': 'Migrate portal to microservices',
            'deadline': '2026-12-31T18:00:00Z'
        }, format='json')
        self.assertEqual(res_create_p.status_code, 201)
        p_data = res_create_p.data['project']
        project_id = p_data['project_id']
        self.assertTrue(project_id.startswith('PRJ-'))
        # Initially no tasks: status NO_TASKS, percentage None, label 'No tasks recorded'
        self.assertEqual(p_data['status'], 'NO_TASKS')
        self.assertIsNone(p_data['completion_percentage'])
        self.assertIn(p_data['completion_label'], ['No tasks recorded', 'No tasks assigned'])

        # 2. Admin creates two tasks in this project
        # Task 1 assigned to Alice
        res_t1 = self.client.post(f'/api/projects/{project_id}/tasks/', {
            'title': 'Design Auth Architecture',
            'description': 'JWT + OAuth2 flow specification',
            'assigned_to': self.emp1.id,
            'deadline': '2026-11-15T18:00:00Z'
        }, format='json')
        self.assertEqual(res_t1.status_code, 201)
        t1_id = res_t1.data['task']['task_id']
        self.assertTrue(t1_id.startswith('TSK-'))
        self.assertEqual(res_t1.data['task']['status'], 'NOT_STARTED')

        # Task 2 assigned to Bob
        res_t2 = self.client.post(f'/api/projects/{project_id}/tasks/', {
            'title': 'Design UI Mockups',
            'description': 'Figma prototypes for admin dashboard',
            'assigned_to': self.emp2.id
        }, format='json')
        self.assertEqual(res_t2.status_code, 201)
        t2_id = res_t2.data['task']['task_id']

        # Project status should now be NOT_STARTED with 0% completion
        res_p_check = self.client.get(f'/api/projects/{project_id}/')
        self.assertEqual(res_p_check.status_code, 200)
        p_summary = res_p_check.data['project']
        self.assertEqual(p_summary['status'], 'NOT_STARTED')
        self.assertEqual(p_summary['total_tasks'], 2)
        self.assertEqual(p_summary['completed_tasks'], 0)
        self.assertEqual(p_summary['completion_percentage'], 0.0)

        # 3. Alice checks "My Projects & Tasks"
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res_my_tasks = self.client.get('/api/tasks/my-tasks/')
        self.assertEqual(res_my_tasks.status_code, 200)
        # Alice should see Task 1, but NOT Task 2
        alice_task_ids = [t['task_id'] for t in res_my_tasks.data['tasks']]
        self.assertIn(t1_id, alice_task_ids)
        self.assertNotIn(t2_id, alice_task_ids)

        # 4. Alice starts work on Task 1
        res_start = self.client.post(f'/api/project-tasks/{t1_id}/start/')
        self.assertEqual(res_start.status_code, 200)
        t1_updated = res_start.data['task']
        self.assertEqual(t1_updated['status'], 'IN_PROGRESS')
        self.assertIsNotNone(t1_updated['first_started_at'])
        self.assertIsNotNone(t1_updated['active_session'])
        self.assertEqual(t1_updated['active_session']['status'], 'IN_PROGRESS')

        # Project should now be IN_PROGRESS and have first_started_at recorded
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_p_active = self.client.get(f'/api/projects/{project_id}/')
        self.assertEqual(res_p_active.data['project']['status'], 'IN_PROGRESS')
        self.assertIsNotNone(res_p_active.data['project']['first_started_at'])
        self.assertIn('Started at', res_p_active.data['project']['started_at_display'])

        # 5. Alice pauses work on Task 1 (e.g. taking a quick break)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res_pause = self.client.post(f'/api/project-tasks/{t1_id}/pause/')
        self.assertEqual(res_pause.status_code, 200)
        # Crucial requirement: Task MUST remain IN_PROGRESS!
        self.assertEqual(res_pause.data['task']['status'], 'IN_PROGRESS')
        self.assertEqual(res_pause.data['task']['active_session']['status'], 'PAUSED')

        # 6. Alice resumes and stops the timer session
        res_resume = self.client.post(f'/api/project-tasks/{t1_id}/start/')
        self.assertEqual(res_resume.status_code, 200)
        self.assertEqual(res_resume.data['task']['active_session']['status'], 'IN_PROGRESS')

        res_stop = self.client.post(f'/api/project-tasks/{t1_id}/stop/')
        self.assertEqual(res_stop.status_code, 200)
        # Crucial requirement: Stopping timer session must NOT mark task completed!
        self.assertEqual(res_stop.data['task']['status'], 'IN_PROGRESS')

        # 7. Alice adds a progress note
        res_note = self.client.post(f'/api/project-tasks/{t1_id}/note/', {
            'content': 'Completed JWT token signing logic and refresh mechanism. Pending review.'
        }, format='json')
        self.assertEqual(res_note.status_code, 200)
        self.assertEqual(len(res_note.data['task']['progress_notes']), 1)
        self.assertEqual(res_note.data['note']['author_name'], 'Alice Developer')

        # 8. Multi-day / multiple work sessions support: Alice starts another work session
        res_start2 = self.client.post(f'/api/project-tasks/{t1_id}/start/')
        self.assertEqual(res_start2.status_code, 200)

        # 9. Alice explicitly marks Task 1 Completed
        res_comp1 = self.client.post(f'/api/project-tasks/{t1_id}/complete/')
        self.assertEqual(res_comp1.status_code, 200)
        t1_completed = res_comp1.data['task']
        self.assertEqual(t1_completed['status'], 'COMPLETED')
        self.assertIsNotNone(t1_completed['completed_at'])
        self.assertEqual(t1_completed['completed_by'], 'Alice Developer')

        # Duplicate completion should be prevented
        res_comp_dup = self.client.post(f'/api/project-tasks/{t1_id}/complete/')
        self.assertEqual(res_comp_dup.status_code, 400)
        self.assertIn('already', res_comp_dup.data['error'])

        # Additional time logging on completed task must be blocked
        res_start_blocked = self.client.post(f'/api/project-tasks/{t1_id}/start/')
        self.assertEqual(res_start_blocked.status_code, 400)
        self.assertIn('Cannot log time on a completed task', res_start_blocked.data['error'])

        # 10. Check Project completion percentage: 1 of 2 tasks completed = 50.0%
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_p_half = self.client.get(f'/api/projects/{project_id}/')
        self.assertEqual(res_p_half.data['project']['completed_tasks'], 1)
        self.assertEqual(res_p_half.data['project']['completion_percentage'], 50.0)
        self.assertEqual(res_p_half.data['project']['status'], 'IN_PROGRESS')

        # 11. Bob completes Task 2
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp2_token.key}')
        self.client.post(f'/api/project-tasks/{t2_id}/start/')
        res_comp2 = self.client.post(f'/api/project-tasks/{t2_id}/complete/')
        self.assertEqual(res_comp2.status_code, 200)
        self.assertEqual(res_comp2.data['task']['status'], 'COMPLETED')

        # When all tasks completed: Project becomes ALL_RECORDED_COMPLETED (All Recorded Tasks Completed)
        self.assertIn(res_comp2.data['project_status'], ['ALL_RECORDED_COMPLETED', 'READY_FOR_CLOSURE'])

        # 12. Admin confirms closure (or monitoring view sees all completed)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_close = self.client.post(f'/api/projects/{project_id}/close/')
        self.assertEqual(res_close.status_code, 200)
        self.assertEqual(res_close.data['project']['status'], 'COMPLETED')
        self.assertIsNotNone(res_close.data['project']['closed_at'])

        # 13. Adding task to closed project must be rejected until reopened
        res_add_closed = self.client.post(f'/api/projects/{project_id}/tasks/', {
            'title': 'New Post-Launch Task',
            'assigned_to': self.emp1.id
        }, format='json')
        self.assertEqual(res_add_closed.status_code, 400)
        self.assertIn('reopening it first', res_add_closed.data['error'])

        # 14. Admin reopens project with mandatory reason
        # Without reason -> rejected
        res_reopen_noreason = self.client.post(f'/api/projects/{project_id}/reopen/', {'reason': ''}, format='json')
        self.assertEqual(res_reopen_noreason.status_code, 400)

        # With reason -> successfully reopened
        res_reopen_ok = self.client.post(f'/api/projects/{project_id}/reopen/', {
            'reason': 'Phase 2 deliverables requested by client'
        }, format='json')
        self.assertEqual(res_reopen_ok.status_code, 200)
        self.assertIn(res_reopen_ok.data['project']['status'], ['ALL_RECORDED_COMPLETED', 'READY_FOR_CLOSURE', 'IN_PROGRESS'])
        self.assertEqual(res_reopen_ok.data['project']['reopen_reason'], 'Phase 2 deliverables requested by client')

        # Now adding task succeeds, and since a new uncompleted task exists, project becomes IN_PROGRESS
        res_add_after_reopen = self.client.post(f'/api/projects/{project_id}/tasks/', {
            'title': 'Phase 2 Performance Benchmarks',
            'assigned_to': self.emp1.id
        }, format='json')
        self.assertEqual(res_add_after_reopen.status_code, 201)

        res_p_reopened = self.client.get(f'/api/projects/{project_id}/')
        self.assertEqual(res_p_reopened.data['project']['status'], 'IN_PROGRESS')

    def test_reopen_completed_task_requires_reason(self):
        # Setup project & completed task
        proj = Project.objects.create(name='Mobile App', status='IN_PROGRESS')
        task = ProjectTask.objects.create(
            project=proj,
            title='Push Notifications',
            assigned_to=self.emp1,
            status='COMPLETED',
            completed_at=datetime.now(timezone.utc)
        )

        # Other employee (Bob) cannot reopen Alice's task -> 403
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp2_token.key}')
        res_bob_reopen = self.client.post(f'/api/project-tasks/{task.task_id}/reopen/', {'reason': 'Want to work more'})
        self.assertEqual(res_bob_reopen.status_code, 403)

        # Assigned employee (Alice) without reason -> 400
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res_no_reason = self.client.post(f'/api/project-tasks/{task.task_id}/reopen/', {'reason': ''})
        self.assertEqual(res_no_reason.status_code, 400)

        # Assigned employee (Alice) with reason -> 200 and task status returns to IN_PROGRESS
        res_reopen = self.client.post(f'/api/project-tasks/{task.task_id}/reopen/', {
            'reason': 'APNS payload specification changed'
        })
        self.assertEqual(res_reopen.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.status, 'IN_PROGRESS')
        self.assertIsNone(task.completed_at)
        self.assertEqual(task.reopen_reason, 'APNS payload specification changed')

        # Alice can now log time on the reopened task again
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res_start_again = self.client.post(f'/api/project-tasks/{task.task_id}/start/')
        self.assertEqual(res_start_again.status_code, 200)

    def test_permission_boundaries_for_employees(self):
        # Alice cannot track time on Bob's task
        proj = Project.objects.create(name='Data Science', status='IN_PROGRESS')
        bob_task = ProjectTask.objects.create(
            project=proj,
            title='Data Cleaning Pipeline',
            assigned_to=self.emp2,
            status='NOT_STARTED'
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res_alice_on_bob = self.client.post(f'/api/project-tasks/{bob_task.task_id}/start/')
        self.assertEqual(res_alice_on_bob.status_code, 403)
        self.assertIn('only track time on tasks assigned to you', res_alice_on_bob.data['error'])

        # Alice cannot close project
        res_close = self.client.post(f'/api/projects/{proj.project_id}/close/')
        self.assertEqual(res_close.status_code, 403)

        # Alice cannot create project
        res_create_p = self.client.post('/api/projects/', {'name': 'Alice Project'})
        self.assertEqual(res_create_p.status_code, 403)

    def test_employee_driven_project_workflow_and_monitoring(self):
        """
        Verify employee-driven project/task recording workflow and admin read-only monitoring:
        1. Employee starts a task under project 'E-Commerce Platform' without admin pre-creating it.
        2. Stopping timer leaves task In Progress.
        3. Employee adds a progress note.
        4. Resuming unfinished task reuses the same canonical task without creating duplicate.
        5. Employee explicitly marks task completed (sets completed_at and completed_by).
        6. Employee can reopen their completed task with mandatory reason.
        7. Other employees cannot reopen it.
        8. Admin monitoring view derives status, completion %, and first-start timestamp.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        
        # 1. Start task
        res_start = self.client.post('/api/tasks/start/', {
            'project_name': 'E-Commerce Platform',
            'task_name': 'Payment Gateway Integration',
            'description': 'Stripe checkout webhook integration'
        }, format='json')
        self.assertEqual(res_start.status_code, 201)
        task_log_id = res_start.data['task']['task_log_id']
        project_task_id = res_start.data['task']['project_task_id']
        self.assertIsNotNone(project_task_id)

        # 2. Stop timer -> TaskLog ended, but ProjectTask remains IN_PROGRESS!
        res_stop = self.client.post('/api/tasks/end/', {
            'task_log_id': task_log_id,
            'is_completed': False
        }, format='json')
        self.assertEqual(res_stop.status_code, 200)

        ptask = ProjectTask.objects.get(task_id=project_task_id)
        self.assertEqual(ptask.status, 'IN_PROGRESS')
        self.assertIsNone(ptask.completed_at)

        # 3. Add progress note
        res_note = self.client.post(f'/api/project-tasks/{project_task_id}/note/', {
            'content': 'Webhook signature verified; idempotency key tests passing.'
        }, format='json')
        self.assertEqual(res_note.status_code, 200)

        # 4. Resume work on same task with project_task_id -> does not duplicate task!
        res_resume = self.client.post('/api/tasks/start/', {
            'project_name': 'E-Commerce Platform',
            'task_name': 'Payment Gateway Integration',
            'project_task_id': project_task_id
        }, format='json')
        self.assertEqual(res_resume.status_code, 201)
        self.assertEqual(res_resume.data['task']['project_task_id'], project_task_id)
        self.assertEqual(ProjectTask.objects.filter(project__name__iexact='E-Commerce Platform').count(), 1)

        # 5. Explicitly complete task
        task_log2_id = res_resume.data['task']['task_log_id']
        res_complete = self.client.post('/api/tasks/end/', {
            'task_log_id': task_log2_id,
            'is_completed': True
        }, format='json')
        self.assertEqual(res_complete.status_code, 200)
        ptask.refresh_from_db()
        self.assertEqual(ptask.status, 'COMPLETED')
        self.assertIsNotNone(ptask.completed_at)
        self.assertEqual(ptask.completed_by, self.emp1)

        # 6. Employee reopens their own task with reason
        res_reopen = self.client.post(f'/api/project-tasks/{project_task_id}/reopen/', {
            'reason': 'Customer requested PayPal addition to checkout'
        }, format='json')
        self.assertEqual(res_reopen.status_code, 200)
        ptask.refresh_from_db()
        self.assertEqual(ptask.status, 'IN_PROGRESS')
        self.assertIsNone(ptask.completed_at)
        self.assertEqual(ptask.reopen_reason, 'Customer requested PayPal addition to checkout')

        # Re-complete it for monitoring check
        self.client.post(f'/api/project-tasks/{project_task_id}/complete/')

        # 7. Admin monitoring view
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_admin_p = self.client.get('/api/projects/')
        self.assertEqual(res_admin_p.status_code, 200)
        self.assertTrue(res_admin_p.data['count'] >= 1)
        
        ecom_proj = next(p for p in res_admin_p.data['projects'] if p['name'] == 'E-Commerce Platform')
        self.assertEqual(ecom_proj['status'], 'ALL_RECORDED_COMPLETED')
        self.assertEqual(ecom_proj['completion_percentage'], 100.0)
        self.assertIn('Started at', ecom_proj['started_at_display'])
        self.assertEqual(len(ecom_proj['assigned_employees']), 1)
        self.assertEqual(ecom_proj['assigned_employees'][0]['id'], self.emp1.id)

    def test_project_progress_period_filters_and_activity_matching(self):
        """
        Verify date-wise, weekly, monthly, and custom period filters in Project Progress Hub:
        1. Projects matched by activity (work sessions, starts, completions, notes).
        2. Older project created last month appears when worked on this week.
        3. Accurate period totals (distinct projects, tasks worked, starts, completions, work time).
        4. Distinguishing work time in period from lifetime tracked time.
        5. Employee-filtered progress labeled 'Selected Employee's Task Completion'.
        6. Empty periods return 0 matching projects.
        7. Detail view returns period-scoped tasks, work sessions, progress notes, and employee contributions.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # Create an older project (created in Oct 2026)
        p_old = Project.objects.create(
            name="Legacy Billing Engine",
            description="Created last month",
            status="IN_PROGRESS"
        )
        t_old = ProjectTask.objects.create(
            project=p_old,
            title="Database Migration Script",
            status="IN_PROGRESS",
            assigned_to=self.emp1,
            total_duration_seconds=7200 # 2 lifetime hours
        )

        # October 15 session for old project (2 hours = 7200s)
        # 10:00 AM IST to 12:00 PM IST on Oct 15, 2026
        # In UTC: Oct 15 04:30:00Z to 06:30:00Z
        WorkSession.objects.create(
            task=t_old,
            user=self.emp1,
            date="2026-10-15",
            start_time="2026-10-15T04:30:00Z",
            end_time="2026-10-15T06:30:00Z",
            duration_seconds=7200,
            status="ENDED",
            work_segments=[{
                'start_time': '2026-10-15T04:30:00Z',
                'end_time': '2026-10-15T06:30:00Z',
                'duration_seconds': 7200
            }]
        )

        # Work recorded THIS WEEK (Nov 3, 2026) on the old project!
        # 10:00 AM IST to 11:30 AM IST (1.5 hours = 5400s)
        # In UTC: Nov 3 04:30:00Z to 06:00:00Z
        WorkSession.objects.create(
            task=t_old,
            user=self.emp1,
            date="2026-11-03",
            start_time="2026-11-03T04:30:00Z",
            end_time="2026-11-03T06:00:00Z",
            duration_seconds=5400,
            status="ENDED",
            work_segments=[{
                'start_time': '2026-11-03T04:30:00Z',
                'end_time': '2026-11-03T06:00:00Z',
                'duration_seconds': 5400
            }]
        )
        t_old.total_duration_seconds += 5400
        t_old.save()

        # Add a progress note on Nov 3, 2026
        TaskProgressNote.objects.create(
            task=t_old,
            author=self.emp1,
            author_name=f"{self.emp1.first_name} {self.emp1.last_name}",
            content="Tested migration in staging environment"
        )

        # 1. TEST WEEKLY FILTER (Nov 2 - Nov 8, 2026)
        # Older project created in Oct MUST appear because employee worked on it this week!
        res_weekly = self.client.get('/api/projects/?period=weekly&date=2026-11-03')
        self.assertEqual(res_weekly.status_code, 200)
        proj_names_weekly = [p['name'] for p in res_weekly.data['projects']]
        self.assertIn("Legacy Billing Engine", proj_names_weekly)

        legacy_p_weekly = next(p for p in res_weekly.data['projects'] if p['name'] == "Legacy Billing Engine")
        # Period work time must reflect ONLY this week's work (5400s = 1.5h)
        self.assertEqual(legacy_p_weekly['period_tracked_seconds'], 5400)
        self.assertEqual(legacy_p_weekly['period_tracked_hours'], 1.5)
        # Lifetime tracked time must reflect full lifetime (12600s = 3.5h)
        self.assertEqual(legacy_p_weekly['lifetime_tracked_seconds'], 12600)
        self.assertEqual(legacy_p_weekly['current_status'], 'IN_PROGRESS')

        # 2. TEST SPECIFIC DATE FILTER (2026-11-03)
        res_date = self.client.get('/api/projects/?period=specific&date=2026-11-03')
        self.assertEqual(res_date.status_code, 200)
        proj_names_date = [p['name'] for p in res_date.data['projects']]
        self.assertIn("Legacy Billing Engine", proj_names_date)

        # 3. TEST EMPTY PERIOD (2026-11-01 - Sunday before the work)
        res_empty = self.client.get('/api/projects/?period=specific&date=2026-11-01')
        self.assertEqual(res_empty.status_code, 200)
        proj_names_empty = [p['name'] for p in res_empty.data['projects']]
        self.assertNotIn("Legacy Billing Engine", proj_names_empty)

        # 4. TEST MONTHLY FILTER (October 2026)
        # In October 2026, Legacy Billing Engine had 7200s (2.0h)
        res_monthly_oct = self.client.get('/api/projects/?period=monthly&month=10&year=2026')
        self.assertEqual(res_monthly_oct.status_code, 200)
        legacy_oct = next(p for p in res_monthly_oct.data['projects'] if p['name'] == "Legacy Billing Engine")
        self.assertEqual(legacy_oct['period_tracked_seconds'], 7200)
        self.assertEqual(legacy_oct['period_tracked_hours'], 2.0)

        # 5. TEST CUSTOM RANGE (Oct 10, 2026 to Oct 20, 2026)
        res_custom = self.client.get('/api/projects/?period=custom&start_date=2026-10-10&end_date=2026-10-20')
        self.assertEqual(res_custom.status_code, 200)
        legacy_custom = next(p for p in res_custom.data['projects'] if p['name'] == "Legacy Billing Engine")
        self.assertEqual(legacy_custom['period_tracked_seconds'], 7200)

        # 6. TEST EMPLOYEE FILTERING COMBINED WITH PERIOD
        res_emp1_weekly = self.client.get(f'/api/projects/?period=weekly&date=2026-11-03&employee={self.emp1.id}')
        self.assertEqual(res_emp1_weekly.status_code, 200)
        legacy_emp1 = next(p for p in res_emp1_weekly.data['projects'] if p['name'] == "Legacy Billing Engine")
        self.assertIsNotNone(legacy_emp1.get('employee_progress'))
        self.assertEqual(legacy_emp1['employee_progress']['user_id'], self.emp1.id)
        self.assertEqual(legacy_emp1['employee_progress']['total_tasks'], 1)
        self.assertEqual(legacy_emp1['period_tracked_seconds'], 5400)

        # 7. TEST PROJECT DETAIL VIEW IN PERIOD
        res_detail = self.client.get(f'/api/projects/{p_old.project_id}/?period=weekly&date=2026-11-03')
        self.assertEqual(res_detail.status_code, 200)
        self.assertEqual(len(res_detail.data['work_sessions']), 1)
        ws_item = res_detail.data['work_sessions'][0]
        self.assertEqual(ws_item['duration_seconds'], 5400)
        self.assertEqual(ws_item['date_display'], '03 Nov 2026')
        self.assertEqual(len(res_detail.data['progress_notes']), 1)
        self.assertIn('Nov 2026', res_detail.data['progress_notes'][0]['created_at_display'])
        self.assertEqual(res_detail.data['employee_contributions'][0]['period_duration_seconds'], 5400)

    def test_hourly_report_explicit_completion_vs_timer_stop(self):
        """
        Verify that in the 9 AM - 8 PM hourly report:
        - When an employee pauses/stops a task timer at 11:30 AM without completing the task,
          it counts 30 mins worked in 11 AM - 12 PM, but 0 tasks completed.
        - When an employee explicitly completes the task at 11:45 AM,
          it counts 1 task completed in 11 AM - 12 PM.
        """
        # Target day: Nov 3, 2026
        # 11:00 AM IST = 05:30:00 UTC
        # 11:30 AM IST = 06:00:00 UTC
        # 11:45 AM IST = 06:15:00 UTC
        t_start_utc = "2026-11-03T05:30:00Z"
        t_stop_utc = "2026-11-03T06:00:00Z"
        t_comp_utc = "2026-11-03T06:15:00Z"

        proj = Project.objects.create(name='Report Testing Project')
        task = ProjectTask.objects.create(
            project=proj,
            title='Explicit Completion Task',
            assigned_to=self.emp1,
            status='IN_PROGRESS'
        )

        # Timer stop record (NOT completed)
        TaskLog.objects.create(
            task_id="log-timer-stop-only",
            user_id=self.emp1.id,
            employee_id="ALICE001",
            employee_name="Alice Developer",
            date="2026-11-03",
            project_id=proj.project_id,
            project_task_id=task.task_id,
            project_name=proj.name,
            task_name=task.title,
            status="ENDED",
            start_time=t_start_utc,
            end_time=t_stop_utc,
            duration_seconds=1800,
            work_segments=[{"start_time": t_start_utc, "end_time": t_stop_utc, "duration_seconds": 1800}],
            is_explicit_completed=False,
            completed_at=None
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_report = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03')
        self.assertEqual(res_report.status_code, 200)

        slot_11 = [s for s in res_report.data['slots'] if s['slot_index'] == 11][0]
        # 30 mins worked
        self.assertEqual(slot_11['total_seconds'], 1800)
        self.assertEqual(slot_11['tasks_worked_count'], 1)
        # Because it was just a timer stop, tasks_completed_count MUST BE 0!
        self.assertEqual(slot_11['tasks_completed_count'], 0)

        # Now simulate explicit completion of task at 11:45 AM IST
        TaskLog.objects.create(
            task_id="log-explicit-completed",
            user_id=self.emp1.id,
            employee_id="ALICE001",
            employee_name="Alice Developer",
            date="2026-11-03",
            project_id=proj.project_id,
            project_task_id=task.task_id,
            project_name=proj.name,
            task_name=task.title,
            status="COMPLETED",
            start_time=t_stop_utc,
            end_time=t_comp_utc,
            duration_seconds=900,
            work_segments=[{"start_time": t_stop_utc, "end_time": t_comp_utc, "duration_seconds": 900}],
            is_explicit_completed=True,
            completed_at=t_comp_utc
        )

        res_report_after = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-03')
        slot_11_after = [s for s in res_report_after.data['slots'] if s['slot_index'] == 11][0]
        self.assertEqual(slot_11_after['total_seconds'], 2700)  # 30m + 15m = 45m (2700s)
        self.assertEqual(slot_11_after['tasks_worked_count'], 1)
        # Explicit completion verified!
        self.assertEqual(slot_11_after['tasks_completed_count'], 1)

    def test_employee_panel_today_tasks_and_activity(self):
        """
        Verifies employee panel 'My Projects & Tasks' exact visibility rule:
        - Show a task ONLY when its original created_at falls between today at 00:00 IST and tomorrow at 00:00 IST.
        - Yesterday's task must remain hidden even if updated, completed, or resumed today.
        - Today's task must appear only once.
        - Project card shown only if containing a qualifying task.
        - Deduplication by stable ID.
        """
        from datetime import date
        from zoneinfo import ZoneInfo
        ws_tz = ZoneInfo("Asia/Kolkata")
        today_date = date.today()
        yesterday_date = today_date - timedelta(days=1)

        # Timestamps in Asia/Kolkata
        yesterday_dt_utc = datetime(yesterday_date.year, yesterday_date.month, yesterday_date.day, 10, 0, 0, tzinfo=ws_tz).astimezone(timezone.utc)
        today_dt_utc = datetime(today_date.year, today_date.month, today_date.day, 10, 0, 0, tzinfo=ws_tz).astimezone(timezone.utc)

        proj_active = Project.objects.create(name="Active Project", status="IN_PROGRESS")
        proj_old = Project.objects.create(name="Yesterday Project", status="IN_PROGRESS")

        # 1. Task created yesterday, updated & completed today (MUST REMAIN HIDDEN)
        t_yesterday = ProjectTask.objects.create(
            project=proj_old,
            title="Yesterday Task",
            assigned_to=self.emp1,
            status="COMPLETED",
            completed_at=today_dt_utc,
            completed_by=self.emp1
        )
        ProjectTask.objects.filter(task_id=t_yesterday.task_id).update(created_at=yesterday_dt_utc)
        # Even with work session today, must remain hidden because original created_at is yesterday
        WorkSession.objects.create(
            task=t_yesterday,
            user=self.emp1,
            date=today_date.isoformat(),
            start_time=today_dt_utc.isoformat(),
            end_time=(today_dt_utc + timedelta(seconds=1800)).isoformat(),
            duration_seconds=1800,
            status="ENDED"
        )

        # 2. Task created today (MUST APPEAR EXACTLY ONCE)
        t_today = ProjectTask.objects.create(
            project=proj_active,
            title="Today Task",
            assigned_to=self.emp1,
            status="IN_PROGRESS"
        )
        # Set created_at to today_dt_utc
        ProjectTask.objects.filter(task_id=t_today.task_id).update(created_at=today_dt_utc)

        # 3. Another employee's task created today (MUST NEVER APPEAR FOR EMP1)
        t_other = ProjectTask.objects.create(
            project=proj_active,
            title="Other Employee Today Task",
            assigned_to=self.emp2,
            status="IN_PROGRESS"
        )

        # Query My Tasks as Alice (emp1)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.emp1_token.key}')
        res = self.client.get('/api/tasks/my-tasks/')
        self.assertEqual(res.status_code, 200)

        task_ids = [t['task_id'] for t in res.data['tasks']]

        # 1. Verification of Exact Visibility Rules
        self.assertNotIn(t_yesterday.task_id, task_ids, "Yesterday task must remain hidden even if updated/completed today")
        self.assertNotIn(t_other.task_id, task_ids, "Other employee's task must never appear")
        self.assertIn(t_today.task_id, task_ids, "Task created today must appear")
        self.assertEqual(task_ids.count(t_today.task_id), 1, "Today's task must appear exactly once")

        # 2. Project visibility: Yesterday Project has no qualifying tasks, so must NOT appear
        returned_project_ids = [p['project_id'] for p in res.data['projects']]
        self.assertIn(proj_active.project_id, returned_project_ids)
        self.assertNotIn(proj_old.project_id, returned_project_ids, "Project without tasks created today must not appear")

        # 3. Summary counters strictly reflect tasks created today
        summary = res.data['summary']
        self.assertEqual(summary['total_tasks'], 1)
        self.assertEqual(summary['in_progress'], 1)
        self.assertEqual(summary['completed'], 0)
        self.assertEqual(summary['not_started'], 0)

        # 4. With all_history=true, yesterday's task is accessible in history
        res_all = self.client.get('/api/tasks/my-tasks/?all_history=true')
        self.assertEqual(res_all.status_code, 200)
        all_task_ids = [t['task_id'] for t in res_all.data['tasks']]
        self.assertIn(t_yesterday.task_id, all_task_ids)


class AdminFilterAuditTests(TestCase):
    """
    Comprehensive QA verification test suite for all admin module filters:
    - Live Attendance & Reports: date ranges, inverted dates, month selection, employee, department, project, task
    - AND logic across multiple filters
    - Whitespace trimming and case-insensitive matching
    - Export with filters applied
    - Analytics dashboard custom date validation
    - Daily Task Reports & Hourly Task Reports 11 slots (9 AM–8 PM)
    """
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='admin_audit@knowletive.com',
            email='admin_audit@knowletive.com',
            password='password123',
            first_name='Admin',
            last_name='Audit',
            role='ADMIN'
        )
        self.admin_token, _ = Token.objects.get_or_create(user=self.admin)

        self.emp1 = User.objects.create_user(
            username='charlie@knowletive.com',
            email='charlie@knowletive.com',
            password='password123',
            first_name='Charlie',
            last_name='Chaplin',
            role='EMPLOYEE',
            department='Engineering',
            employee_id='EMP201'
        )
        self.emp1_token, _ = Token.objects.get_or_create(user=self.emp1)

        self.emp2 = User.objects.create_user(
            username='diana@knowletive.com',
            email='diana@knowletive.com',
            password='password123',
            first_name='Diana',
            last_name='Prince',
            role='EMPLOYEE',
            department='Design',
            employee_id='EMP202'
        )
        self.emp2_token, _ = Token.objects.get_or_create(user=self.emp2)

        SystemSettings.objects.all().delete()
        SystemSettings.objects.create(
            company_name='Knowletive',
            workspace_name='Knowletive HQ',
            work_start_time='09:00',
            work_end_time='20:00',
            timezone='Asia/Kolkata'
        )

    def test_reports_date_range_validation_inverted_dates(self):
        """Invalid date ranges (start_date > end_date) must return 400 with a clear error message."""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/admin/reports/?start_date=2026-11-10&end_date=2026-11-01')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Start date cannot be after end date', res.data.get('error', ''))

        # Also for export endpoint
        res_exp = self.client.get('/api/admin/reports/export/?start_date=2026-11-10&end_date=2026-11-01&format=csv')
        self.assertEqual(res_exp.status_code, 400)
        self.assertIn('Start date cannot be after end date', res_exp.data.get('error', ''))

    def test_analytics_date_range_validation(self):
        """Analytics custom range with start_date > end_date must return 400."""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.get('/api/analytics/dashboard/?period=custom&start_date=2026-11-10&end_date=2026-11-01')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Start date cannot be after end date', res.data.get('error', ''))

    def test_reports_and_daily_tasks_multi_filter_and_logic(self):
        """
        Verify multiple filters work together with strict AND logic:
        Charlie works on 'Alpha Portal' on 2026-11-02.
        Diana works on 'Beta App' on 2026-11-02.
        Charlie works on 'Beta App' on 2026-11-03.
        """
        TaskLog.objects.create(
            task_id="t-c1",
            user_id=self.emp1.id,
            employee_id="EMP201",
            employee_name="Charlie Chaplin",
            date="2026-11-02",
            project_name="Alpha Portal",
            task_name="Backend API",
            status="COMPLETED",
            start_time="2026-11-02T04:30:00Z",
            end_time="2026-11-02T05:30:00Z",
            duration_seconds=3600
        )

        TaskLog.objects.create(
            task_id="t-d1",
            user_id=self.emp2.id,
            employee_id="EMP202",
            employee_name="Diana Prince",
            date="2026-11-02",
            project_name="Beta App",
            task_name="Figma Mockups",
            status="COMPLETED",
            start_time="2026-11-02T05:00:00Z",
            end_time="2026-11-02T06:00:00Z",
            duration_seconds=3600
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')

        # 1. Daily Task Report: Filter by date 2026-11-02 AND employee EMP201 -> only Charlie's task
        res1 = self.client.get(f'/api/admin/tasks/report/?date=2026-11-02&employee_id={self.emp1.id}')
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(len(res1.data['tasks']), 1)
        self.assertEqual(res1.data['tasks'][0]['employee_id'], 'EMP201')

        # 2. Daily Task Report: Filter by date 2026-11-02 AND project 'Beta' -> only Diana's task
        res2 = self.client.get('/api/admin/tasks/report/?date=2026-11-02&project=Beta')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(len(res2.data['tasks']), 1)
        self.assertEqual(res2.data['tasks'][0]['employee_id'], 'EMP202')

        # 3. Daily Task Report: Filter by date 2026-11-02 AND employee EMP201 AND project 'Beta' -> 0 tasks (AND logic verified!)
        res3 = self.client.get(f'/api/admin/tasks/report/?date=2026-11-02&employee_id={self.emp1.id}&project=Beta')
        self.assertEqual(res3.status_code, 200)
        self.assertEqual(len(res3.data['tasks']), 0)

        # 4. Whitespace trimming: Project with leading/trailing spaces '  Alpha  ' matches 'Alpha Portal'
        res4 = self.client.get(f'/api/admin/tasks/report/?date=2026-11-02&project=%20%20Alpha%20%20')
        self.assertEqual(res4.status_code, 200)
        self.assertEqual(len(res4.data['tasks']), 1)

    def test_hourly_task_report_eleven_slots_and_slot_filter(self):
        """
        Verify that the Hourly Task Report:
        - Covers all 11 one-hour slots (9 AM–8 PM)
        - Can filter by slot parameter (e.g. slot=14 for 2:00 PM–3:00 PM)
        - Rejects invalid slot indices (< 9 or > 19)
        """
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res_all = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-02')
        self.assertEqual(res_all.status_code, 200)
        self.assertEqual(len(res_all.data['slots']), 11)
        # Check start and end slot labels
        self.assertEqual(res_all.data['slots'][0]['slot_label'], '9:00 AM–10:00 AM')
        self.assertEqual(res_all.data['slots'][-1]['slot_label'], '7:00 PM–8:00 PM')

        # Single slot filter: slot=14 (2:00 PM–3:00 PM)
        res_slot14 = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-02&slot=14')
        self.assertEqual(res_slot14.status_code, 200)
        self.assertEqual(len(res_slot14.data['slots']), 1)
        self.assertEqual(res_slot14.data['slots'][0]['slot_label'], '2:00 PM–3:00 PM')

        # Invalid slot filter: slot=8 or slot=21
        res_invalid = self.client.get('/api/admin/tasks/hourly-report/?date=2026-11-02&slot=8')
        self.assertEqual(res_invalid.status_code, 400)
        self.assertIn('between 9 and 19', res_invalid.data.get('error', ''))









