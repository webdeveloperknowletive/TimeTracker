import os
import sys
import getpass
import re
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')
django.setup()

from tracker.models import User
from tracker.storage_adapter import storage
from rest_framework.authtoken.models import Token

def validate_password_complexity(pw):
    if not pw or len(pw) < 8:
        return False, "Password must be at least 8 characters long."
    if not re.search(r'[A-Z]', pw):
        return False, "Password must contain at least one uppercase letter (A-Z)."
    if not re.search(r'[a-z]', pw):
        return False, "Password must contain at least one lowercase letter (a-z)."
    if not re.search(r'[0-9]', pw):
        return False, "Password must contain at least one number (0-9)."
    if not re.search(r'[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\/`~]', pw):
        return False, "Password must contain at least one special character (!@#$%^&* etc.)."
    return True, ""

def create_admin_interactive(username=None, email=None, password=None, first_name=None, last_name=None):
    print("\n" + "=" * 55)
    print("   Knowletive Workspace - Primary Administrator Setup")
    print("=" * 55 + "\n")

    if not username:
        while True:
            username = input("Enter Admin Username: ").strip()
            if not username:
                print("Username cannot be empty.")
                continue
            if User.objects.filter(username__iexact=username).exists():
                print(f"Username '{username}' is already in use. Please enter another.")
                continue
            break

    if not email:
        email = input("Enter Admin Work Email (optional, press Enter to use default): ").strip().lower()
        if not email:
            email = f"{username}@knowletive.com"

    if not first_name:
        first_name = input("Enter First Name (optional, default 'Admin'): ").strip() or "Admin"
    if not last_name:
        last_name = input("Enter Last Name (optional): ").strip()

    if not password:
        while True:
            pw1 = getpass.getpass("Enter Secure Admin Password: ")
            valid, err_msg = validate_password_complexity(pw1)
            if not valid:
                print(f"Password Error: {err_msg}")
                continue
            pw2 = getpass.getpass("Confirm Secure Admin Password: ")
            if pw1 != pw2:
                print("Passwords do not match. Please try again.")
                continue
            password = pw1
            break
    else:
        valid, err_msg = validate_password_complexity(password)
        if not valid:
            raise ValueError(f"Password does not meet complexity requirements: {err_msg}")

    admin_user = User.objects.create_superuser(
        username=username,
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
        role='ADMIN',
        department='Administration',
        approval_status='APPROVED',
        is_active=True,
        is_staff=True,
        is_superuser=True
    )

    token, _ = Token.objects.get_or_create(user=admin_user)

    storage.log_audit(
        action="WORKSPACE_INITIALIZED",
        actor=admin_user.username,
        details={
            "action": "CREATE_PRIMARY_ADMIN",
            "admin_user_id": admin_user.id,
            "username": admin_user.username,
            "email": admin_user.email,
            "workspace": "Knowletive"
        }
    )

    print("\n" + "-" * 55)
    print(f"✓ Administrator account '{admin_user.username}' successfully created!")
    print(f"✓ Workspace Name: Knowletive")
    print(f"✓ Email: {admin_user.email}")
    print(f"✓ Role: ADMIN (Full workspace authority)")
    print("-" * 55 + "\n")
    return admin_user

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Secure Setup for Knowletive Primary Admin")
    parser.add_argument('--username', help="Admin username")
    parser.add_argument('--email', help="Admin email")
    parser.add_argument('--password', help="Admin password (complexity checked)")
    parser.add_argument('--first-name', help="First name")
    parser.add_argument('--last-name', help="Last name")
    args = parser.parse_args()

    try:
        create_admin_interactive(
            username=args.username,
            email=args.email,
            password=args.password,
            first_name=args.first_name,
            last_name=args.last_name
        )
    except Exception as e:
        print(f"Error initializing admin: {e}", file=sys.stderr)
        sys.exit(1)
