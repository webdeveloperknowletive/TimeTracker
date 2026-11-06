import os
import sys

# Ensure backend directory is in path whether invoked from root, subdirectory, or container
current_dir = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(os.path.join(current_dir, 'knowletive')):
    sys.path.insert(0, current_dir)
    os.chdir(current_dir)
elif os.path.exists(os.path.join(current_dir, 'knowletive-backend')):
    b_dir = os.path.join(current_dir, 'knowletive-backend')
    sys.path.insert(0, b_dir)
    os.chdir(b_dir)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')

import django
django.setup()

from tracker.reset_service import execute_safe_tracking_reset, get_table_counts, get_current_db_info

def main():
    print("=" * 65)
    print(" TIMETRACKER PRODUCTION TRACKING DATA RESET PIPELINE")
    print("=" * 65)
    info = get_current_db_info()
    print(f"Target Database: {info['database']}")
    print(f"Database User:   {info['user']}")
    print(f"Server Host:     {info['server_addr']}:{info['server_port']}")

    initial_counts = get_table_counts()
    print("\nInitial Tracking Table Counts:")
    for k, v in initial_counts.items():
        if k.startswith('tracker_'):
            print(f"  {k:<32}: {v}")

    print("\nCreating restorable backup and executing transactional deletion...")
    result = execute_safe_tracking_reset(actor_username="CLI_Administrator")
    print(f"\nRESET SUCCESSFUL! Total deleted: {result['total_deleted']} records.")
    print(f"Backup stored at: {result['backup_location']}")
    print(f"Preserved user accounts: {result['preserved_accounts_count']}")

if __name__ == '__main__':
    main()
