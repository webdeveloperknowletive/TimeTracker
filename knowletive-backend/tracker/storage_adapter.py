import os
import uuid
import threading
from datetime import datetime, timezone
import zoneinfo
from django.db.models import Q
from .models import TimeEvent, TaskLog, TimesheetEntry, AuditLog, SystemSettings

IST_TZ = zoneinfo.ZoneInfo("Asia/Kolkata")

class TimeEventStorage:
    def __init__(self):
        self._lock = threading.RLock()
        self.use_mock = False # Supabase migration complete

    def record_event(self, user_id, event_type, source='web', session_id=None):
        with self._lock:
            event_id = str(uuid.uuid4())
            now_utc = datetime.now(timezone.utc)
            timestamp = now_utc.isoformat().replace("+00:00", "Z")
            
            TimeEvent.objects.create(
                event_id=event_id,
                user_id=int(user_id),
                event_type=event_type,
                timestamp=timestamp,
                source=source,
                session_id=session_id or ''
            )
            
            self.log_audit(
                action=f"TIME_EVENT_{event_type}",
                actor=f"User ID {user_id}",
                details={"event_id": event_id, "source": source, "timestamp": timestamp}
            )
            return {'event_id': event_id, 'timestamp': timestamp}

    def log_audit(self, action, actor, details):
        with self._lock:
            log_id = str(uuid.uuid4())
            timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            AuditLog.objects.create(
                log_id=log_id,
                action=action,
                actor=actor,
                timestamp=timestamp,
                details=details
            )

    def get_events_for_user(self, user_id):
        with self._lock:
            return list(TimeEvent.objects.filter(user_id=int(user_id)).order_by('timestamp').values())

    def get_all_events(self):
        with self._lock:
            return list(TimeEvent.objects.all().order_by('timestamp').values())

    def correct_event(self, event_id, new_event_type, new_timestamp, admin_email, reason):
        with self._lock:
            if not reason or not reason.strip():
                raise ValueError("Correction reason is strictly mandatory.")
            ev = TimeEvent.objects.filter(event_id=event_id).first()
            if not ev:
                raise ValueError(f"Event with id {event_id} not found.")
            original_event = {'event_type': ev.event_type, 'timestamp': ev.timestamp}
            if new_event_type: ev.event_type = new_event_type
            if new_timestamp: ev.timestamp = new_timestamp
            ev.save()
            
            self.log_audit(
                action="ADMIN_CORRECTION",
                actor=admin_email,
                details={
                    "event_id": event_id,
                    "original_value": original_event,
                    "corrected_value": {"event_type": ev.event_type, "timestamp": ev.timestamp},
                    "reason": reason.strip(),
                    "admin": admin_email,
                    "correction_time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                }
            )
            return True

    def get_audit_logs(self):
        with self._lock:
            return list(AuditLog.objects.all().order_by('-timestamp').values())

    def get_settings(self):
        with self._lock:
            settings = SystemSettings.objects.first()
            if not settings:
                settings = SystemSettings.objects.create()
            return {
                'company_name': settings.company_name,
                'workspace_name': settings.workspace_name,
                'work_start_time': settings.work_start_time,
                'work_end_time': settings.work_end_time,
                'timezone': settings.timezone
            }

    def update_settings(self, new_settings, admin_email="admin"):
        with self._lock:
            settings = SystemSettings.objects.first()
            if not settings:
                settings = SystemSettings.objects.create()
            if 'company_name' in new_settings: settings.company_name = new_settings['company_name']
            if 'workspace_name' in new_settings: settings.workspace_name = new_settings['workspace_name']
            if 'work_start_time' in new_settings: settings.work_start_time = new_settings['work_start_time']
            if 'work_end_time' in new_settings: settings.work_end_time = new_settings['work_end_time']
            if 'timezone' in new_settings: settings.timezone = new_settings['timezone']
            settings.save()
            self.log_audit(action="UPDATE_SETTINGS", actor=admin_email, details=new_settings)
            return True

    def save_timesheet_entry(self, user_id, work_date, project_name, task_name, work_description, updated_by):
        with self._lock:
            user_id = int(user_id)
            entry_id = str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            entry = TimesheetEntry.objects.filter(user_id=user_id, date=work_date).first()
            if entry:
                entry.project_name = project_name
                entry.task_name = task_name
                entry.work_description = work_description
                entry.save()
                entry_id = entry.entry_id
            else:
                TimesheetEntry.objects.create(
                    entry_id=entry_id,
                    user_id=user_id,
                    date=work_date,
                    project_name=project_name,
                    task_name=task_name,
                    work_description=work_description
                )
            self.log_audit(
                action="TIMESHEET_ENTRY_SAVED", actor=updated_by,
                details={"user_id": user_id, "date": work_date, "project_name": project_name, "task_name": task_name}
            )
            return {
                'entry_id': entry_id, 'user_id': user_id, 'date': work_date,
                'project_name': project_name, 'task_name': task_name,
                'work_description': work_description, 'updated_at': now_iso
            }

    def get_timesheet_entries_for_month(self, user_id, year, month):
        with self._lock:
            prefix = f"{year:04d}-{month:02d}-"
            return list(TimesheetEntry.objects.filter(user_id=int(user_id), date__startswith=prefix).values())

    def calculate_task_duration(self, task, now_utc=None):
        if not task: return 0
        if now_utc is None: now_utc = datetime.now(timezone.utc)
        t_dict = task if isinstance(task, dict) else task.__dict__
        base_sec = int(t_dict.get('duration_seconds') or 0)
        if t_dict.get('status') == 'IN_PROGRESS' and t_dict.get('current_segment_start'):
            try:
                cleaned = str(t_dict['current_segment_start']).replace("Z", "+00:00")
                seg_start = datetime.fromisoformat(cleaned)
                base_sec += max(0, int((now_utc - seg_start).total_seconds()))
            except Exception: pass
        elif not t_dict.get('work_segments') and not t_dict.get('duration_seconds') and t_dict.get('start_time'):
            try:
                s_dt = datetime.fromisoformat(str(t_dict['start_time']).replace("Z", "+00:00"))
                e_dt = datetime.fromisoformat(str(t_dict['end_time']).replace("Z", "+00:00")) if t_dict.get('end_time') else now_utc
                base_sec = max(0, int((e_dt - s_dt).total_seconds()))
            except Exception: base_sec = 0
        return base_sec

    def start_task(self, user_id, project_name, task_name, description, user_email, employee_id='', employee_name=''):
        with self._lock:
            user_id = int(user_id)
            if not project_name or not project_name.strip(): raise ValueError("Project name is required.")
            if not task_name or not task_name.strip(): raise ValueError("Task name is required.")
            now_utc_dt = datetime.now(timezone.utc)
            now_utc = now_utc_dt.isoformat().replace("+00:00", "Z")
            today_ist = now_utc_dt.astimezone(IST_TZ).date().isoformat()
            
            active_existing = self.get_active_task_for_user(user_id)
            if active_existing:
                self.end_task(user_id=user_id, task_log_id=active_existing.get('task_log_id') if isinstance(active_existing, dict) else active_existing.task_id, user_email=user_email)
                
            task_log_id = str(uuid.uuid4())
            TaskLog.objects.create(
                task_id=task_log_id, user_id=user_id, employee_id=employee_id or '', employee_name=employee_name or '',
                date=today_ist, project_name=project_name.strip(), task_name=task_name.strip(),
                description=(description or '').strip(), start_time=now_utc, end_time=None,
                status='IN_PROGRESS', duration_seconds=0, current_segment_start=now_utc,
                work_segments=[], created_at=now_utc, updated_at=now_utc
            )
            new_task_dict = list(TaskLog.objects.filter(task_id=task_log_id).values())[0]
            new_task_dict['task_log_id'] = new_task_dict.pop('task_id')
            self.log_audit(action="TASK_STARTED", actor=user_email, details={"task_log_id": task_log_id, "project_name": project_name.strip(), "task_name": task_name.strip(), "start_time": now_utc})
            return new_task_dict

    def pause_active_task(self, user_id, pause_time_iso=None):
        with self._lock:
            user_id = int(user_id)
            now_utc_dt = datetime.now(timezone.utc)
            if not pause_time_iso: pause_time_iso = now_utc_dt.isoformat().replace("+00:00", "Z")
            else:
                try: now_utc_dt = datetime.fromisoformat(pause_time_iso.replace("Z", "+00:00"))
                except Exception: pass
            
            task = TaskLog.objects.filter(user_id=user_id, status='IN_PROGRESS').first()
            if task:
                seg_start_str = task.current_segment_start or task.start_time
                seg_sec = 0
                if seg_start_str:
                    try:
                        s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                        seg_sec = max(0, int((now_utc_dt - s_dt).total_seconds()))
                    except Exception: pass
                task.duration_seconds += seg_sec
                segments = list(task.work_segments) if task.work_segments else []
                segments.append({'start_time': seg_start_str, 'end_time': pause_time_iso, 'duration_seconds': seg_sec})
                task.work_segments = segments
                task.current_segment_start = None
                task.status = 'PAUSED'
                task.updated_at = pause_time_iso
                task.save()
                
                t_dict = list(TaskLog.objects.filter(task_id=task.task_id).values())[0]
                t_dict['task_log_id'] = t_dict.pop('task_id')
                return t_dict
            return None

    def resume_active_task(self, user_id, resume_time_iso=None):
        with self._lock:
            user_id = int(user_id)
            if not resume_time_iso: resume_time_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            task = TaskLog.objects.filter(user_id=user_id, status='PAUSED').first()
            if task:
                task.status = 'IN_PROGRESS'
                task.current_segment_start = resume_time_iso
                task.updated_at = resume_time_iso
                task.save()
                t_dict = list(TaskLog.objects.filter(task_id=task.task_id).values())[0]
                t_dict['task_log_id'] = t_dict.pop('task_id')
                return t_dict
            return None

    def end_task(self, user_id, task_log_id=None, user_email='employee'):
        with self._lock:
            user_id = int(user_id)
            now_utc_dt = datetime.now(timezone.utc)
            now_utc = now_utc_dt.isoformat().replace("+00:00", "Z")
            
            qs = TaskLog.objects.filter(user_id=user_id)
            if task_log_id: qs = qs.filter(task_id=task_log_id, status__in=['IN_PROGRESS', 'PAUSED'])
            else: qs = qs.filter(status__in=['IN_PROGRESS', 'PAUSED'])
            
            task = qs.first()
            if not task: return None
            
            if task.status == 'IN_PROGRESS':
                seg_start_str = task.current_segment_start or task.start_time
                seg_sec = 0
                if seg_start_str:
                    try:
                        s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                        seg_sec = max(0, int((now_utc_dt - s_dt).total_seconds()))
                    except Exception: pass
                task.duration_seconds += seg_sec
                segments = list(task.work_segments) if task.work_segments else []
                segments.append({'start_time': seg_start_str, 'end_time': now_utc, 'duration_seconds': seg_sec})
                task.work_segments = segments
                
            task.current_segment_start = None
            task.end_time = now_utc
            task.status = 'COMPLETED'
            task.updated_at = now_utc
            task.save()
            
            t_dict = list(TaskLog.objects.filter(task_id=task.task_id).values())[0]
            t_dict['task_log_id'] = t_dict.pop('task_id')
            self.log_audit(action="TASK_ENDED", actor=user_email, details={"task_log_id": task.task_id, "project_name": task.project_name, "task_name": task.task_name, "end_time": now_utc})
            return t_dict

    def end_any_active_task_for_user(self, user_id, end_time_iso=None):
        active_t = self.get_active_task_for_user(user_id)
        if active_t: return self.end_task(user_id=user_id, task_log_id=active_t.get('task_log_id'))
        return None

    def get_active_task_for_user(self, user_id):
        with self._lock:
            task = TaskLog.objects.filter(user_id=int(user_id), status__in=['IN_PROGRESS', 'PAUSED']).first()
            if task:
                t_dict = list(TaskLog.objects.filter(task_id=task.task_id).values())[0]
                t_dict['task_log_id'] = t_dict.pop('task_id')
                return t_dict
            return None

    def get_running_task_for_user(self, user_id):
        with self._lock:
            task = TaskLog.objects.filter(user_id=int(user_id), status='IN_PROGRESS').first()
            if task:
                t_dict = list(TaskLog.objects.filter(task_id=task.task_id).values())[0]
                t_dict['task_log_id'] = t_dict.pop('task_id')
                return t_dict
            return None

    def update_task_details(self, user_id, task_log_id, project_name=None, task_name=None, description=None, user_email='employee'):
        with self._lock:
            user_id = int(user_id)
            now_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            task = TaskLog.objects.filter(user_id=user_id, task_id=task_log_id).first()
            if not task: raise ValueError("Task log entry not found or unauthorized.")
            if project_name is not None and project_name.strip(): task.project_name = project_name.strip()
            if task_name is not None and task_name.strip(): task.task_name = task_name.strip()
            if description is not None: task.description = description.strip()
            task.updated_at = now_utc
            task.save()
            t_dict = list(TaskLog.objects.filter(task_id=task.task_id).values())[0]
            t_dict['task_log_id'] = t_dict.pop('task_id')
            self.log_audit(action="TASK_DETAILS_UPDATED", actor=user_email, details={"task_log_id": task_log_id})
            return t_dict

    def get_tasks_for_user_and_date(self, user_id, date_str):
        with self._lock:
            tasks = list(TaskLog.objects.filter(user_id=int(user_id), date=date_str).order_by('start_time').values())
            for t in tasks: t['task_log_id'] = t.pop('task_id')
            return tasks

    def get_all_tasks_for_date(self, date_str, filter_user_id=None, filter_project=None):
        with self._lock:
            qs = TaskLog.objects.filter(date=date_str)
            if filter_user_id: qs = qs.filter(user_id=int(filter_user_id))
            if filter_project: qs = qs.filter(project_name__icontains=filter_project)
            tasks = list(qs.order_by('start_time').values())
            for t in tasks: t['task_log_id'] = t.pop('task_id')
            return tasks

    def get_all_tasks(self, start_date=None, end_date=None, user_id=None, project=None):
        with self._lock:
            qs = TaskLog.objects.all()
            if start_date: qs = qs.filter(date__gte=start_date)
            if end_date: qs = qs.filter(date__lte=end_date)
            if user_id: qs = qs.filter(user_id=int(user_id))
            if project: qs = qs.filter(project_name__icontains=project)
            tasks = list(qs.order_by('start_time').values())
            for t in tasks: t['task_log_id'] = t.pop('task_id')
            return tasks

    def get_events_between_dates(self, start_date, end_date):
        with self._lock:
            return list(TimeEvent.objects.filter(timestamp__gte=start_date, timestamp__lte=end_date).order_by('timestamp').values())

    def delete_task_log(self, user_id, task_log_id, admin_email, reason):
        with self._lock:
            if not reason or not reason.strip(): raise ValueError("Deletion reason is mandatory.")
            task = TaskLog.objects.filter(task_id=task_log_id).first()
            if not task: raise ValueError(f"Task with id {task_log_id} not found.")
            task_dict = {
                "task_log_id": task.task_id, "user_id": task.user_id, "project": task.project_name,
                "task": task.task_name, "duration": task.duration_seconds
            }
            task.delete()
            self.log_audit(action="ADMIN_TASK_DELETION", actor=admin_email, details={"task_log_id": task_log_id, "deleted_task": task_dict, "reason": reason.strip(), "admin": admin_email})
            return True

storage = TimeEventStorage()
