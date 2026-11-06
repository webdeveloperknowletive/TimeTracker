import os
import sys
import json
import hashlib
from datetime import datetime, timezone
from django.conf import settings
from django.apps import apps
from django.core import serializers
from django.core.cache import cache
from django.db import connection, transaction
from django.db.models import Q
from tracker.models import (
    User, TimeEvent, TaskLog, Project, ProjectTask, WorkSession,
    TaskProgressNote, ProjectAuditHistory, TimesheetEntry,
    EmployeeProjectStatus, AuditLog, SystemSettings, Invitation, Notification
)
from tracker.storage_adapter import storage

TRACKING_TABLES = [
    'tracker_worksession',
    'tracker_taskprogressnote',
    'tracker_projectaudithistory',
    'tracker_employeeprojectstatus',
    'tracker_projecttask',
    'tracker_project',
    'tracker_tasklog',
    'tracker_timeevent',
    'tracker_timesheetentry'
]

PRESERVED_TABLES = [
    'tracker_user',
    'tracker_systemsettings',
    'tracker_invitation',
    'tracker_notification',
    'tracker_authhandoff'
]

EXTERNAL_WEBSITE_TABLES = [
    'candidates', 'internships', 'job_roles', 'jobs', 'leads',
    'media_library', 'profiles', 'resume_keyword_matches',
    'role_keywords', 'testimonials'
]

def get_current_db_info():
    with connection.cursor() as cur:
        cur.execute("SELECT current_database(), current_user, inet_server_addr(), inet_server_port();")
        info = cur.fetchone()
        return {
            'database': info[0],
            'user': info[1],
            'server_addr': str(info[2]) if info[2] else 'local',
            'server_port': info[3]
        }

def get_table_counts():
    counts = {}
    with connection.cursor() as cur:
        # Check tracking tables
        for t in TRACKING_TABLES + PRESERVED_TABLES:
            try:
                cur.execute(f'SELECT COUNT(*) FROM "{t}"')
                counts[t] = cur.fetchone()[0]
            except Exception:
                counts[t] = None
        
        # Check external tables if they exist
        for t in EXTERNAL_WEBSITE_TABLES:
            try:
                cur.execute(f'SELECT COUNT(*) FROM "{t}"')
                counts[t] = cur.fetchone()[0]
            except Exception:
                counts[t] = 'Table not present in this DB'
    return counts

def create_restorable_backup(backup_base_dir):
    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_dir = os.path.join(backup_base_dir, f'pre_reset_backup_{timestamp_str}')
    os.makedirs(backup_dir, exist_ok=True)
    
    # 1. Django JSON Fixture Dump (direct query without server-side cursors for pooler safety)
    json_path = os.path.join(backup_dir, 'tracker_fixture_backup.json')
    all_serialized = []
    tracker_models = apps.get_app_config('tracker').get_models()
    for m in tracker_models:
        qs = list(m.objects.all())
        raw_json = serializers.serialize('json', qs)
        all_serialized.extend(json.loads(raw_json))
        
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(all_serialized, f, indent=2)
    json_size = os.path.getsize(json_path)

    # 2. Raw SQL Dump for all tracker tables
    sql_path = os.path.join(backup_dir, 'tracker_tables_backup.sql')
    target_sql_tables = TRACKING_TABLES + PRESERVED_TABLES + ['tracker_auditlog']
    with connection.cursor() as cur, open(sql_path, 'w', encoding='utf-8') as f:
        f.write(f"-- TimeTracker Production Database Backup\n-- Generated at: {datetime.now(timezone.utc).isoformat()}\n\n")
        f.write("BEGIN;\n\n")
        for table in target_sql_tables:
            try:
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
            except Exception as e:
                f.write(f"-- Error exporting {table}: {e}\n\n")
        f.write("COMMIT;\n")
    sql_size = os.path.getsize(sql_path)

    # 3. Checksums and Manifest
    with open(json_path, 'rb') as f:
        json_hash = hashlib.sha256(f.read()).hexdigest()
    with open(sql_path, 'rb') as f:
        sql_hash = hashlib.sha256(f.read()).hexdigest()

    manifest = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'database_info': get_current_db_info(),
        'total_objects_serialized': len(all_serialized),
        'backup_files': {
            'tracker_fixture_backup.json': {'size_bytes': json_size, 'sha256': json_hash},
            'tracker_tables_backup.sql': {'size_bytes': sql_size, 'sha256': sql_hash}
        },
        'initial_table_counts': get_table_counts()
    }
    manifest_path = os.path.join(backup_dir, 'manifest.json')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    # Integrity verification
    if json_size < 100 or sql_size < 100:
        raise RuntimeError("Backup generation failed: Backup file is empty or corrupted.")
    
    with open(json_path, 'r', encoding='utf-8') as f:
        verify_loaded = json.load(f)
        if len(verify_loaded) != len(all_serialized):
            raise RuntimeError("Backup verification failed: Serialized count mismatch.")

    return {
        'backup_dir': backup_dir,
        'json_path': json_path,
        'sql_path': sql_path,
        'manifest_path': manifest_path,
        'serialized_objects': len(all_serialized),
        'json_size': json_size,
        'sql_size': sql_size
    }

def execute_safe_tracking_reset(actor_username="System Administrator", backup_base_dir=None):
    if backup_base_dir is None:
        backup_base_dir = os.path.join(getattr(settings, 'BASE_DIR', os.getcwd()), 'backups')
    
    # Pre-verification
    db_info = get_current_db_info()
    initial_counts = get_table_counts()

    # Step 1: Restorable Backup
    backup_result = create_restorable_backup(backup_base_dir)

    # Step 2: Atomic Deletion
    deleted_counts = {}
    with storage._lock:
        with transaction.atomic():
            deleted_counts['tracker_worksession'] = WorkSession.objects.all().delete()[0]
            deleted_counts['tracker_taskprogressnote'] = TaskProgressNote.objects.all().delete()[0]
            deleted_counts['tracker_projectaudithistory'] = ProjectAuditHistory.objects.all().delete()[0]
            deleted_counts['tracker_employeeprojectstatus'] = EmployeeProjectStatus.objects.all().delete()[0]
            deleted_counts['tracker_projecttask'] = ProjectTask.objects.all().delete()[0]
            deleted_counts['tracker_project'] = Project.objects.all().delete()[0]
            deleted_counts['tracker_tasklog'] = TaskLog.objects.all().delete()[0]
            deleted_counts['tracker_timeevent'] = TimeEvent.objects.all().delete()[0]
            deleted_counts['tracker_timesheetentry'] = TimesheetEntry.objects.all().delete()[0]
            
            # Tracking-specific audit logs
            deleted_counts['tracker_auditlog (tracking events)'] = AuditLog.objects.filter(
                Q(action__startswith='TIME_EVENT_') |
                Q(action__startswith='TASK_') |
                Q(action__startswith='TIMESHEET_') |
                Q(action__in=[
                    'EMPLOYEE_PROJECT_STATUS_UPDATED', 'ADMIN_CORRECTION',
                    'EXPORT_REPORT', 'EXPORT_TASK_REPORT', 'EXPORT_HOURLY_TASK_REPORT',
                    'EXPORT_TIMESHEET'
                ])
            ).delete()[0]

            # Invalidate any cached states
            try:
                cache.clear()
            except Exception:
                pass

            # Record permanent audit trail
            storage.log_audit(
                action="DATA_RESET_COMPLETED",
                actor=actor_username,
                details={
                    "deleted_records": deleted_counts,
                    "backup_location": backup_result['backup_dir'],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "db": db_info['database']
                }
            )

    # Step 3: Post-Reset Verification
    final_counts = get_table_counts()
    for t in TRACKING_TABLES:
        if final_counts.get(t, 0) != 0:
            raise RuntimeError(f"Post-reset verification failed: {t} still has {final_counts.get(t)} rows!")

    for t in PRESERVED_TABLES:
        if initial_counts.get(t) != final_counts.get(t):
            raise RuntimeError(f"Post-reset verification failed: Preserved table {t} count changed from {initial_counts.get(t)} to {final_counts.get(t)}!")

    return {
        'success': True,
        'database_info': db_info,
        'backup_location': backup_result['backup_dir'],
        'deleted_records': deleted_counts,
        'total_deleted': sum(deleted_counts.values()),
        'preserved_accounts_count': final_counts.get('tracker_user', 0),
        'initial_counts': initial_counts,
        'final_counts': final_counts
    }

