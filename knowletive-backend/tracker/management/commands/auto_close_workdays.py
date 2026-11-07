from datetime import date
from django.core.management.base import BaseCommand
from tracker.auto_closure_service import (
    close_all_active_sessions_at_cutoff,
    get_current_ist_time,
    get_workday_cutoff_ist
)

class Command(BaseCommand):
    help = "Enforces the 7:30 PM Asia/Kolkata (IST) automatic workday closure across all employees."

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force closure of active sessions using the 7:30 PM cutoff even if executed before 7:30 PM IST.',
        )
        parser.add_argument(
            '--date',
            type=str,
            default=None,
            help='Specific target date (YYYY-MM-DD) to close sessions for. Defaults to today.',
        )

    def handle(self, *args, **options):
        force = options['force']
        target_date_str = options['date']
        target_date = date.fromisoformat(target_date_str) if target_date_str else None
        now_ist = get_current_ist_time()

        self.stdout.write(self.style.NOTICE("================================================================="))
        self.stdout.write(self.style.NOTICE(" TIMETRACKER 7:30 PM IST WORKDAY AUTO-CLOSURE PIPELINE"))
        self.stdout.write(self.style.NOTICE("================================================================="))
        self.stdout.write(f"Current Server Time (IST): {now_ist.strftime('%Y-%m-%d %I:%M:%S %p')}")

        result = close_all_active_sessions_at_cutoff(target_date=target_date, now_ist=now_ist, force=force)

        if result.get('reason') == 'before_cutoff':
            self.stdout.write(self.style.WARNING(
                f"Skipped: Current time ({now_ist.strftime('%I:%M:%S %p')}) is before the 7:30 PM IST cutoff ({result['cutoff_ist']})."
            ))
            self.stdout.write("Pass --force to close active sessions anyway using the 7:30 PM cutoff.")
            return

        closed_count = result.get('closed_count', 0)
        cutoff_utc = result.get('cutoff_utc', '')
        cutoff_ist = result.get('cutoff_ist', '')

        self.stdout.write(self.style.SUCCESS(
            f"Successfully verified & closed {closed_count} employee session(s) at cutoff."
        ))
        self.stdout.write(f"Cutoff Timestamp (IST): {cutoff_ist}")
        self.stdout.write(f"Cutoff Timestamp (UTC): {cutoff_utc}")
        if result.get('closed_users'):
            self.stdout.write(f"Affected User IDs: {result['closed_users']}")

