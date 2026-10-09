import os
import sys
import getpass
from django.core.management.base import BaseCommand, CommandError
from tracker.models import User
from tracker.views import is_valid_email, validate_strong_password
from tracker.storage_adapter import storage


class Command(BaseCommand):
    help = (
        "Securely create or configure the initial Knowletive administrator account.\n"
        "Credentials can be supplied via command line options, environment variables, "
        "or secure interactive prompt."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--username',
            type=str,
            help='Admin username (or set ADMIN_USERNAME env var)',
        )
        parser.add_argument(
            '--email',
            type=str,
            help='Admin email address (or set ADMIN_EMAIL env var)',
        )
        parser.add_argument(
            '--password',
            type=str,
            help='Admin password (or set ADMIN_PASSWORD env var)',
        )
        parser.add_argument(
            '--first-name',
            type=str,
            default=None,
            help='Admin first name (or set ADMIN_FIRST_NAME env var)',
        )
        parser.add_argument(
            '--last-name',
            type=str,
            default=None,
            help='Admin last name (or set ADMIN_LAST_NAME env var)',
        )
        parser.add_argument(
            '--no-input',
            action='store_true',
            help='Do not prompt interactively; require flags or environment variables.',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("=== Knowletive Administrator Setup ==="))

        # 1. Resolve Username & Email
        username = options.get('username') or os.getenv('ADMIN_USERNAME')
        email = options.get('email') or os.getenv('ADMIN_EMAIL')

        if not username and not email:
            if options.get('no_input'):
                raise CommandError("Admin username or email is required. Provide --username / --email or set env vars.")
            prompt_user = input("Enter Administrator Username: ").strip()
            username = prompt_user if prompt_user else "admin"

        if not username:
            username = email.split('@')[0] if email else "admin"
        if not email:
            email = f"{username}@knowletive.local"

        # 2. Resolve Names
        first_name = options.get('first_name') or os.getenv('ADMIN_FIRST_NAME')
        if not first_name:
            if options.get('no_input'):
                first_name = "Admin"
            else:
                prompt_first = input("Enter First Name [Admin]: ").strip()
                first_name = prompt_first if prompt_first else "Admin"

        last_name = options.get('last_name') or os.getenv('ADMIN_LAST_NAME')
        if not last_name:
            if options.get('no_input'):
                last_name = "User"
            else:
                prompt_last = input("Enter Last Name [User]: ").strip()
                last_name = prompt_last if prompt_last else "User"

        # 3. Resolve Password
        password = options.get('password') or os.getenv('ADMIN_PASSWORD')
        if not password:
            if options.get('no_input'):
                raise CommandError("Admin password is required. Provide --password or set ADMIN_PASSWORD.")
            while not password:
                pwd1 = getpass.getpass("Enter Secure Admin Password: ")
                if not pwd1:
                    self.stderr.write("Password cannot be empty.")
                    continue
                is_valid, err_msg = validate_strong_password(pwd1)
                if not is_valid:
                    self.stderr.write(f"Password error: {err_msg}")
                    continue
                pwd2 = getpass.getpass("Confirm Password: ")
                if pwd1 != pwd2:
                    self.stderr.write("Passwords do not match. Please try again.")
                    continue
                password = pwd1
        else:
            is_valid, err_msg = validate_strong_password(password)
            if not is_valid:
                raise CommandError(f"Admin password does not meet security criteria: {err_msg}")

        # 4. Create or Update Admin in Database
        user = User.objects.filter(username__iexact=username).first()
        if not user:
            user = User.objects.filter(email__iexact=email).first()

        if user:
            self.stdout.write(f"User account '{user.username}' already exists. Updating to Administrator status...")
            user.role = 'ADMIN'
            user.approval_status = 'APPROVED'
            user.is_active = True
            user.is_staff = True
            user.is_superuser = True
            user.first_name = first_name
            user.last_name = last_name
            user.set_password(password)
            user.save()
            action_type = "UPDATE_EXISTING_USER_TO_ADMIN"
            self.stdout.write(self.style.SUCCESS(f"Successfully configured '{user.username}' as Administrator."))
        else:
            user = User.objects.create_superuser(
                username=username,
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name,
                role='ADMIN',
                approval_status='APPROVED',
                is_active=True
            )
            action_type = "CREATE_INITIAL_ADMIN"
            self.stdout.write(self.style.SUCCESS(f"Successfully created Administrator account: '{username}'."))

        # 5. Audit Log
        try:
            storage.log_audit(
                action=action_type,
                actor=email,
                details={
                    "user_id": user.id,
                    "email": email,
                    "role": "ADMIN",
                    "approval_status": "APPROVED",
                    "method": "setup_admin_command"
                }
            )
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Audit log notice: {e}"))

        self.stdout.write(self.style.SUCCESS(
            "\nInitial Administrator setup completed.\n"
            f"You can now sign in at the login page using: {email}\n"
            "From the Admin Console, you can invite new employees, manage invitations, and approve accounts."
        ))
