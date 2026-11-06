from django.core.management.base import BaseCommand, CommandError
from tracker.reset_service import execute_safe_tracking_reset, get_table_counts, get_current_db_info

class Command(BaseCommand):
    help = 'Safely backs up and resets all TimeTracker attendance, task, and project records in the active database.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Confirm and execute the reset.',
        )

    def handle(self, *args, **options):
        db_info = get_current_db_info()
        self.stdout.write(self.style.WARNING("=" * 65))
        self.stdout.write(self.style.WARNING(" TIMETRACKER PRODUCTION TRACKING DATA RESET PIPELINE"))
        self.stdout.write(self.style.WARNING("=" * 65))
        self.stdout.write(f"Target Database: {db_info['database']}")
        self.stdout.write(f"Database User:   {db_info['user']}")
        self.stdout.write(f"Server Host:     {db_info['server_addr']}:{db_info['server_port']}")

        counts = get_table_counts()
        self.stdout.write("\nCurrent Tracking Record Counts:")
        for tbl in ['tracker_timeevent', 'tracker_tasklog', 'tracker_project', 'tracker_projecttask', 'tracker_worksession']:
            self.stdout.write(f"  {tbl:<28}: {counts.get(tbl, 0)}")

        if not options['confirm']:
            self.stdout.write(self.style.ERROR("\n[DRY RUN ONLY] Pass --confirm to perform restorable backup and deletion."))
            return

        self.stdout.write("\nCreating restorable backup and executing transactional deletion...")
        try:
            res = execute_safe_tracking_reset(actor_username="CLI_Admin")
            self.stdout.write(self.style.SUCCESS(f"\nRESET SUCCESSFUL! Total deleted: {res['total_deleted']} records."))
            self.stdout.write(self.style.SUCCESS(f"Backup stored at: {res['backup_location']}"))
            self.stdout.write(f"Preserved user accounts: {res['preserved_accounts_count']}")
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"\nRESET FAILED: {str(e)}"))
            raise CommandError(str(e))

