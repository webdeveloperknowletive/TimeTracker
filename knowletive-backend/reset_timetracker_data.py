import os
import sys
import json
import hashlib
from datetime import datetime, timezone

# Initialize Django environment
backend_dir = os.path.abspath('knowletive-backend')
sys.path.insert(0, backend_dir)
os.chdir(backend_dir)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')

import django
django.setup()

from django.apps import apps
from django.core import serializers
from django.db import connection, transaction
from django.db.models import Q
from tracker.models import (
    User, TimeEvent, TaskLog, Project, ProjectTask, WorkSession,
    TaskProgressNote, ProjectAuditHistory, TimesheetEntry,
    EmployeeProjectStatus, AuditLog, SystemSettings, Invitation, Notification
)
from tracker.storage_adapter import storage

def get_table_counts():
    counts = {}
    with connection.cursor() as cur:
        # Tracker application tables
        tables = [
            'tracker_timeevent', 'tracker_tasklog', 'tracker_project',
            'tracker_projecttask', 'tracker_worksession', 'tracker_taskprogressnote',
            'tracker_projectaudithistory', 'tracker_employeeprojectstatus',
            'tracker_timesheetentry', 'tracker_auditlog', 'tracker_user',
            'tracker_systemsettings', 'tracker_invitation', 'tracker_notification',
            'tracker_authhandoff'
        ]
        for t in tables:
            cur.execute(f'SELECT COUNT(*) FROM "{t}"')
            counts[t] = cur.fetchone()[0]
            
        # External website tables (must remain strictly untouched)
        external_tables = [
            'candidates', 'internships', 'job_roles', 'jobs', 'leads',
            'media_library', 'profiles', 'resume_keyword_matches',
            'role_keywords', 'testimonials'
        ]
        for t in external_tables:
            cur.execute(f'SELECT COUNT(*) FROM "{t}"')
            counts[t] = cur.fetchone()[0]
    return counts

def generate_json_fixture_backup(backup_dir):
    json_path = os.path.join(backup_dir, 'tracker_fixture_backup.json')
    all_serialized = []
    tracker_models = apps.get_app_config('tracker').get_models()
    for m in tracker_models:
        qs = list(m.objects.all())
        raw_json = serializers.serialize('json', qs)
        all_serialized.extend(json.loads(raw_json))
        
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_serialized, f, indent=2)
    return json_path, len(all_serialized)

def generate_sql_backup(backup_dir, target_tables):
    sql_path = os.path.join(backup_dir, 'tracker_tables_backup.sql')
    with connection.cursor() as cur, open(sql_path, 'w', encoding='utf-8') as f:
        f.write(f"-- TimeTracker Database Backup\n-- Generated at: {datetime.now(timezone.utc).isoformat()}\n\n")
        f.write("BEGIN;\n\n")
        
        for table in target_tables:
            cur.execute(f"""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = '{table}' 
                ORDER BY ordinal_position;
            """)
            cols = [col[0] for col in cur.fetchall()]
            if not cols:
                continue
            
            cur.execute(f'SELECT * FROM "{table}"')
            rows = cur.fetchall()
            f.write(f"-- Table: {table} ({len(rows)} rows)\n")
            
            for row in rows:
                col_names = ", ".join(f'"{c}"' for c in cols)
                val_strs = []
                for val in row:
                    if val is None:
                        val_strs.append("NULL")
                    elif isinstance(val, (int, float)):
                        val_strs.append(str(val))
                    elif isinstance(val, bool):
                        val_strs.append("TRUE" if val else "FALSE")
                    elif isinstance(val, (dict, list)):
                        val_json = json.dumps(val).replace("'", "''")
                        val_strs.append(f"'{val_json}'::jsonb")
                    else:
                        val_str = str(val).replace("'", "''")
                        val_strs.append(f"'{val_str}'")
                f.write(f'INSERT INTO "{table}" ({col_names}) VALUES ({", ".join(val_strs)});\n')
            f.write("\n")
            
        f.write("COMMIT;\n")
    return sql_path

def main():
    print("=" * 60)
    print(" TIMETRACKER RESET & RESTORABLE BACKUP PIPELINE")
    print("=" * 60)
    
    with connection.cursor() as cur:
        cur.execute("SELECT current_database(), current_user, inet_server_addr(), inet_server_port();")
        db_info = cur.fetchone()
        print(f"Target Database: {db_info[0]}")
        print(f"Database User:   {db_info[1]}")
        print(f"Server Host:     aws-0-ap-northeast-1.pooler.supabase.com:6543")

    initial_counts = get_table_counts()
    print("\n[STEP 1] Current Table Counts Before Reset:")
    print("--- TimeTracker Tracking Tables (To be reset) ---")
    tracking_tables = [
        'tracker_timeevent', 'tracker_tasklog', 'tracker_project',
        'tracker_projecttask', 'tracker_worksession', 'tracker_taskprogressnote',
        'tracker_projectaudithistory', 'tracker_employeeprojectstatus',
        'tracker_timesheetentry'
    ]
    for t in tracking_tables:
        print(f"  {t:<32}: {initial_counts.get(t, 0)} rows")
        
    print("--- TimeTracker Preserved Tables ---")
    preserved_tables = [
        'tracker_user', 'tracker_systemsettings', 'tracker_invitation',
        'tracker_notification', 'tracker_authhandoff'
    ]
    for t in preserved_tables:
        print(f"  {t:<32}: {initial_counts.get(t, 0)} rows")
        
    print("--- External Website Tables (Strictly Untouched) ---")
    external_tables = [
        'candidates', 'internships', 'job_roles', 'jobs', 'leads',
        'media_library', 'profiles', 'resume_keyword_matches',
        'role_keywords', 'testimonials'
    ]
    for t in external_tables:
        print(f"  {t:<32}: {initial_counts.get(t, 0)} rows")

    # STEP 2: Create Backup
    print("\n[STEP 2] Creating Restorable Backup...")
    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_dir = os.path.join(backend_dir, 'backups', f'pre_reset_backup_{timestamp_str}')
    os.makedirs(backup_dir, exist_ok=True)
    
    # 2a. Django JSON Fixture Dump (direct query without server-side cursors)
    json_path, serialized_count = generate_json_fixture_backup(backup_dir)
    json_size = os.path.getsize(json_path)
    print(f"  Django fixture dump created: {json_path} ({json_size:,} bytes, {serialized_count} objects)")
    
    # 2b. Raw SQL Dump for all tracker tables
    all_tracker_tables = tracking_tables + preserved_tables + ['tracker_auditlog']
    sql_path = generate_sql_backup(backup_dir, all_tracker_tables)
    sql_size = os.path.getsize(sql_path)
    print(f"  Raw SQL dump created:        {sql_path} ({sql_size:,} bytes)")
    
    # 2c. Backup Manifest and Integrity Check
    with open(json_path, 'rb') as f:
        json_hash = hashlib.sha256(f.read()).hexdigest()
    with open(sql_path, 'rb') as f:
        sql_hash = hashlib.sha256(f.read()).hexdigest()
        
    manifest = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'database': db_info[0],
        'user': db_info[1],
        'total_objects_serialized': serialized_count,
        'backup_files': {
            'tracker_fixture_backup.json': {'size_bytes': json_size, 'sha256': json_hash},
            'tracker_tables_backup.sql': {'size_bytes': sql_size, 'sha256': sql_hash}
        },
        'table_counts': initial_counts
    }
    manifest_path = os.path.join(backup_dir, 'manifest.json')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    print(f"  Manifest written:            {manifest_path}")

    # VERIFY BACKUP INTEGRITY
    if json_size < 1000 or sql_size < 1000:
        raise RuntimeError("FATAL: Backup files appear too small or empty. Aborting deletion!")
    if serialized_count < 500:
        raise RuntimeError(f"FATAL: Serialized count too low ({serialized_count}). Aborting deletion!")
    with open(json_path, 'r', encoding='utf-8') as f:
        parsed_data = json.load(f)
        if len(parsed_data) != serialized_count:
            raise RuntimeError("FATAL: Fixture backup validation failed. Aborting deletion!")
    print("  Backup integrity verified successfully! Proceeding to atomic deletion.")

    # STEP 3: Atomic Reset in Transaction
    print("\n[STEP 3] Performing Transactional Deletion of Tracking Data...")
    deleted_counts = {}
    with storage._lock:
        with transaction.atomic():
            # 1. Work sessions
            deleted_counts['tracker_worksession'] = WorkSession.objects.all().delete()[0]
            # 2. Task progress notes
            deleted_counts['tracker_taskprogressnote'] = TaskProgressNote.objects.all().delete()[0]
            # 3. Project audit history
            deleted_counts['tracker_projectaudithistory'] = ProjectAuditHistory.objects.all().delete()[0]
            # 4. Employee project status contributions
            deleted_counts['tracker_employeeprojectstatus'] = EmployeeProjectStatus.objects.all().delete()[0]
            # 5. Project tasks
            deleted_counts['tracker_projecttask'] = ProjectTask.objects.all().delete()[0]
            # 6. Employee projects
            deleted_counts['tracker_project'] = Project.objects.all().delete()[0]
            # 7. Task logs (legacy & active timers)
            deleted_counts['tracker_tasklog'] = TaskLog.objects.all().delete()[0]
            # 8. Time events (attendance clock-in/out, breaks)
            deleted_counts['tracker_timeevent'] = TimeEvent.objects.all().delete()[0]
            # 9. Timesheet entries
            deleted_counts['tracker_timesheetentry'] = TimesheetEntry.objects.all().delete()[0]
            # 10. Tracking-specific audit logs
            deleted_counts['tracker_auditlog (tracking)'] = AuditLog.objects.filter(
                Q(action__startswith='TIME_EVENT_') |
                Q(action__startswith='TASK_') |
                Q(action__startswith='TIMESHEET_') |
                Q(action__in=['EMPLOYEE_PROJECT_STATUS_UPDATED', 'ADMIN_CORRECTION', 'EXPORT_REPORT', 'EXPORT_TASK_REPORT', 'EXPORT_HOURLY_TASK_REPORT', 'EXPORT_TIMESHEET'])
            ).delete()[0]
            
            # Log reset in AuditLog
            storage.log_audit(
                action="DATA_RESET_COMPLETED",
                actor="System Administrator",
                details={
                    "deleted_records": deleted_counts,
                    "backup_location": backup_dir,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            )

    print("Deletion completed atomically within transaction.")
    for table, count in deleted_counts.items():
        print(f"  Deleted from {table:<32}: {count} records")

    # STEP 4: Post-Reset Verification
    print("\n[STEP 4] Verifying Post-Reset State...")
    final_counts = get_table_counts()
    
    print("--- TimeTracker Tracking Tables (Must be 0) ---")
    all_zero = True
    for t in tracking_tables:
        cnt = final_counts.get(t, 0)
        print(f"  {t:<32}: {cnt} rows")
        if cnt != 0:
            all_zero = False
            
    print("\n--- Preserved Account & System Tables (Must match initial) ---")
    preserved_ok = True
    for t in preserved_tables:
        init_c = initial_counts.get(t, 0)
        final_c = final_counts.get(t, 0)
        match = "MATCH" if init_c == final_c else "MISMATCH!"
        print(f"  {t:<32}: {final_c} rows (Initial: {init_c}) [{match}]")
        if init_c != final_c:
            preserved_ok = False
            
    print("\n--- External Website Tables (Must match initial exactly) ---")
    external_ok = True
    for t in external_tables:
        init_c = initial_counts.get(t, 0)
        final_c = final_counts.get(t, 0)
        match = "MATCH" if init_c == final_c else "MISMATCH!"
        print(f"  {t:<32}: {final_c} rows (Initial: {init_c}) [{match}]")
        if init_c != final_c:
            external_ok = False

    if not all_zero:
        raise RuntimeError("Verification failed: Some tracking tables still contain rows!")
    if not preserved_ok:
        raise RuntimeError("Verification failed: Preserved user/system tables changed!")
    if not external_ok:
        raise RuntimeError("Verification failed: External website tables changed!")

    # STEP 5: Functional Verification (Test accounts & new attendance recording)
    print("\n[STEP 5] Functional Verification...")
    test_user = User.objects.filter(is_active=True).first()
    if test_user:
        print(f"  Active user found: {test_user.username} ({test_user.email}), Role: {test_user.role}")
        # Test creating a fresh clock-in
        ev = storage.record_event(test_user.id, 'START_WORK', source='test_verification')
        print(f"  Successfully recorded test START_WORK event: id={ev['event_id']}")
        events = storage.get_events_for_user(test_user.id)
        assert len(events) == 1, "Expected exactly 1 test event"
        # Now clean up test event
        TimeEvent.objects.filter(event_id=ev['event_id']).delete()
        AuditLog.objects.filter(action='TIME_EVENT_START_WORK', actor=f"User ID {test_user.id}").delete()
        print("  Test event cleaned up. System left in pristine clean state.")

    total_deleted = sum(deleted_counts.values())
    print("\n" + "=" * 60)
    print(f" RESET SUCCESSFUL! Total records deleted: {total_deleted}")
    print(f" Backup stored safely at: {backup_dir}")
    print("=" * 60)

if __name__ == '__main__':
    main()
