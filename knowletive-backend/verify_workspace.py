import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')
django.setup()

from tracker.models import User
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from tracker.storage_adapter import storage

def verify_workspace_post_reset(admin_username, admin_password):
    client = APIClient()

    print("\n--- Step 1: Verify Admin Authentication ---")
    login_res = client.post('/api/auth/login/', {
        'username': admin_username,
        'password': admin_password
    })
    if login_res.status_code != 200:
        print(f"FAILED: Admin login returned status {login_res.status_code}: {login_res.data}")
        return False
    admin_token = login_res.data['token']
    print(f"PASS: Admin authenticated successfully. User: {login_res.data['user']['name']} ({login_res.data['user']['role']})")

    print("\n--- Step 2: Test Admin Access & Employee Creation ---")
    client.credentials(HTTP_AUTHORIZATION=f'Token {admin_token}')
    dash_res = client.get('/api/admin/dashboard/')
    if dash_res.status_code != 200:
        print(f"FAILED: Admin dashboard access failed: {dash_res.data}")
        return False
    print("PASS: Admin dashboard access verified.")

    # Create real employee account
    create_emp_res = client.post('/api/admin/users/', {
        'username': 'test_employee',
        'email': 'employee@knowletive.com',
        'first_name': 'Test',
        'last_name': 'Employee',
        'department': 'Operations',
        'role': 'EMPLOYEE',
        'password': 'EmployeeStrongPass123!'
    })
    if create_emp_res.status_code != 201:
        print(f"FAILED: Employee creation failed: {create_emp_res.data}")
        return False
    emp_data = create_emp_res.data['user']
    print(f"PASS: Created employee account: {emp_data['username']} (ID: {emp_data['employee_id']})")

    print("\n--- Step 3: Test Employee Authentication & Isolation ---")
    emp_client = APIClient()
    emp_login = emp_client.post('/api/auth/login/', {
        'username': 'test_employee',
        'password': 'EmployeeStrongPass123!'
    })
    if emp_login.status_code != 200:
        print(f"FAILED: Employee login failed: {emp_login.data}")
        return False
    emp_token = emp_login.data['token']
    emp_client.credentials(HTTP_AUTHORIZATION=f'Token {emp_token}')
    print("PASS: Employee logged in successfully.")

    # Check empty tracker status
    status_res = emp_client.get('/api/tracker/status/')
    if status_res.status_code != 200 or status_res.data['status'] != 'Not Started':
        print(f"FAILED: Unexpected tracker status: {status_res.data}")
        return False
    if len(status_res.data['today_events']) != 0:
        print(f"FAILED: Expected 0 events for new employee, found {len(status_res.data['today_events'])}")
        return False
    print("PASS: New employee sees clean, empty tracker status ('Not Started', 0 events).")

    # Verify employee CANNOT access admin endpoints
    admin_dash_attempt = emp_client.get('/api/admin/dashboard/')
    if admin_dash_attempt.status_code != 403:
        print(f"FAILED: Expected 403 Forbidden for employee accessing admin dashboard, got {admin_dash_attempt.status_code}")
        return False
    print("PASS: Employee denied access to Admin Dashboard (403 Forbidden).")

    admin_rep_attempt = emp_client.get('/api/admin/reports/')
    if admin_rep_attempt.status_code != 403:
        print(f"FAILED: Expected 403 Forbidden for employee accessing admin reports, got {admin_rep_attempt.status_code}")
        return False
    print("PASS: Employee denied access to Admin Reports (403 Forbidden).")

    # Clean up test employee
    User.objects.filter(username='test_employee').delete()
    print("\n--- Verification Complete: Clean Workspace Confirmed ---")
    return True

if __name__ == '__main__':
    import sys
    if len(sys.argv) < 3:
        print("Usage: python verify_workspace.py <admin_username> <admin_password>")
        sys.exit(1)
    success = verify_workspace_post_reset(sys.argv[1], sys.argv[2])
    sys.exit(0 if success else 1)
