"""
Auto-Closure Service for Knowletive TimeTracker.
Authoritative implementation of the 7:30 PM Asia/Kolkata (IST) workday cutoff.

Rules:
1. Office Schedule: 10:30 AM – 7:30 PM IST.
2. Grace Period: through 10:35:00 AM IST. Clock-in <= 10:35:00 AM is on-time; later is late.
3. Workday Cutoff: Exactly 19:30:00 IST (7:30:00 PM IST = 14:00:00 UTC).
4. Automatic Closure:
   - At or after 7:30 PM IST, any active attendance, open task work segment, and break segment
     for that workday are closed using the exact cutoff timestamp (19:30:00 IST = 14:00:00 UTC),
     NEVER the scheduler execution time.
   - Saves final durations and writes an END_WORK event stamped with 19:30:00 IST.
   - Status becomes 'Ended' ("Workday Ended").
   - Tasks and projects are NOT automatically marked COMPLETED; unfinished tasks stay IN_PROGRESS.
   - Manual End Workday and Sign Out before 7:30 PM are preserved with their actual timestamps.
5. Enforcement:
   - Idempotent and thread/worker-safe.
   - Runs via background scheduler AND just-in-time on tracking reads/writes.
   - Rejects stale browser/extension tracking requests attempting to restart closed sessions.
   - Blocks new tracking actions after 7:30 PM IST until the next scheduled workday (10:30 AM IST).
"""

import logging
import threading
import time as pytime
from datetime import datetime, date, time, timedelta, timezone
from zoneinfo import ZoneInfo
from django.db import transaction
from django.core.cache import cache

logger = logging.getLogger(__name__)

IST_TZ = ZoneInfo("Asia/Kolkata")
CUTOFF_TIME = time(19, 30, 0)       # 7:30:00 PM IST
OFFICE_START_TIME = time(10, 30, 0) # 10:30:00 AM IST
GRACE_CUTOFF_TIME = time(10, 35, 0) # 10:35:00 AM IST

# For deterministic testing overrides
_MOCK_NOW_OVERRIDE = None
_MOCK_NOW_LOCK = threading.Lock()


def set_mock_ist_time(dt):
    """Override current time for deterministic testing. Pass None to reset."""
    global _MOCK_NOW_OVERRIDE
    with _MOCK_NOW_LOCK:
        if dt is None:
            _MOCK_NOW_OVERRIDE = None
        elif isinstance(dt, datetime):
            if dt.tzinfo is None:
                _MOCK_NOW_OVERRIDE = dt.replace(tzinfo=IST_TZ)
            else:
                _MOCK_NOW_OVERRIDE = dt.astimezone(IST_TZ)


def get_current_ist_time():
    """Returns the current datetime in Asia/Kolkata (IST), respecting mock override if set."""
    with _MOCK_NOW_LOCK:
        if _MOCK_NOW_OVERRIDE is not None:
            return _MOCK_NOW_OVERRIDE
    return datetime.now(timezone.utc).astimezone(IST_TZ)


def get_workday_cutoff_ist(target_date):
    """Returns exactly 7:30:00 PM IST on the given date (as an aware datetime)."""
    if isinstance(target_date, str):
        target_date = date.fromisoformat(target_date)
    return datetime.combine(target_date, CUTOFF_TIME, tzinfo=IST_TZ)


def get_workday_cutoff_utc(target_date):
    """Returns the UTC equivalent of 7:30:00 PM IST on target_date (14:00:00 UTC)."""
    return get_workday_cutoff_ist(target_date).astimezone(timezone.utc)


def parse_iso_utc(ts_str):
    if not ts_str:
        return None
    cleaned = str(ts_str).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def is_tracking_action_allowed(user=None, now_ist=None):
    """
    Checks if time-tracking actions (START_WORK, START_BREAK, RESUME_WORK, task start/resume)
    are permitted at the given IST time.
    
    Returns: (is_allowed: bool, reason: str, code: str)
    """
    if now_ist is None:
        now_ist = get_current_ist_time()

    today_date = now_ist.date()
    cutoff_dt = get_workday_cutoff_ist(today_date)

    # 1. Block after 7:30 PM IST on that day
    if now_ist >= cutoff_dt:
        return False, "Workday ended at 7:30 PM IST. Tracking is closed until the next scheduled workday at 10:30 AM IST.", "WORKDAY_CUTOFF"

    # 2. Block if the employee has already concluded their workday for today
    if user and getattr(user, 'id', None):
        from .storage_adapter import storage
        from .views import calculate_day_metrics
        events = storage.get_events_for_user(user.id)
        today_events = [
            e for e in events
            if parse_iso_utc(e.get('timestamp')) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == today_date
        ]
        metrics = calculate_day_metrics(today_events, now_ist.astimezone(timezone.utc))
        if metrics.get('status') == 'Ended':
            return False, "Your workday has already ended for today. New tracking is closed until the next scheduled workday.", "WORKDAY_ENDED"

    return True, "", ""


def close_single_user_at_cutoff(user_id, target_date, cutoff_utc, source="auto_cutoff"):
    """
    Closes active attendance, active work sessions, and active task logs for user_id on target_date
    using the exact cutoff_utc timestamp.
    
    Guarantees:
    - Atomically executed with lock protection.
    - Idempotent: repeated calls do nothing if already closed at cutoff.
    - Preserves tasks/projects as IN_PROGRESS (does NOT mark them COMPLETED).
    - Writes END_WORK event stamped with cutoff_utc.
    """
    from .models import User, WorkSession, TaskLog, TimeEvent, ProjectAuditHistory
    from .storage_adapter import storage
    from .views import calculate_day_metrics

    user_id = int(user_id)
    cutoff_utc_str = cutoff_utc.isoformat().replace("+00:00", "Z")
    target_date_str = target_date.isoformat() if isinstance(target_date, date) else str(target_date)

    with storage._lock:
        with transaction.atomic():
            user = User.objects.filter(id=user_id).first()
            if not user or user.role != 'EMPLOYEE':
                return {'closed': False, 'reason': 'not_employee'}

            # Check if user already clocked out today
            events = storage.get_events_for_user(user_id)
            today_events = [
                e for e in events
                if parse_iso_utc(e.get('timestamp')) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == target_date
            ]
            today_events.sort(key=lambda x: x['timestamp'])
            metrics = calculate_day_metrics(today_events, cutoff_utc)

            is_already_ended = (metrics.get('status') == 'Ended')
            attendance_was_active = metrics.get('status') in ['Working', 'On Break']

            # 1. Close any running or paused Project WorkSessions for target_date
            active_sessions = WorkSession.objects.filter(
                user_id=user_id,
                date__lte=target_date_str,
                status__in=['IN_PROGRESS', 'PAUSED']
            ).select_related('task', 'task__project')

            for s in active_sessions:
                seg_sec = 0
                if s.status == 'IN_PROGRESS':
                    seg_start_str = s.current_segment_start or s.start_time
                    if seg_start_str:
                        s_dt = parse_iso_utc(seg_start_str)
                        if s_dt and s_dt < cutoff_utc:
                            seg_sec = max(0, int((cutoff_utc - s_dt).total_seconds()))
                        else:
                            seg_sec = 0

                    s.duration_seconds += seg_sec
                    if s.task:
                        s.task.total_duration_seconds += seg_sec
                        # Unfinished tasks remain IN_PROGRESS; cutoff must not mark them completed
                        if s.task.status != 'COMPLETED':
                            s.task.status = 'IN_PROGRESS'
                        s.task.save(update_fields=['total_duration_seconds', 'status', 'updated_at'])

                    segs = list(s.work_segments or [])
                    segs.append({
                        'start_time': seg_start_str,
                        'end_time': cutoff_utc_str,
                        'duration_seconds': seg_sec
                    })
                    s.work_segments = segs

                s.current_segment_start = None
                s.end_time = cutoff_utc_str
                s.status = 'ENDED'
                s.updated_at = cutoff_utc_str
                s.save()

                if s.task_log_id:
                    TaskLog.objects.filter(task_id=s.task_log_id).update(
                        duration_seconds=s.duration_seconds,
                        work_segments=s.work_segments,
                        current_segment_start=None,
                        end_time=cutoff_utc_str,
                        status='ENDED',
                        is_explicit_completed=False,
                        updated_at=cutoff_utc_str
                    )

                if s.task and s.task.project:
                    actor_name = f"{user.first_name} {user.last_name}".strip() or user.username
                    ProjectAuditHistory.objects.create(
                        project=s.task.project,
                        task=s.task,
                        action='SESSION_STOPPED',
                        actor=user,
                        actor_name=actor_name,
                        details={'reason': f'Automatic workday cutoff at 7:30 PM IST ({source})'}
                    )

            # 2. Close any lingering generic TaskLogs for target_date
            unclosed_tasklogs = TaskLog.objects.filter(
                user_id=user_id,
                status__in=['IN_PROGRESS', 'PAUSED']
            )
            for tl in unclosed_tasklogs:
                tl_date = None
                if tl.start_time:
                    tl_start_dt = parse_iso_utc(tl.start_time)
                    if tl_start_dt:
                        tl_date = tl_start_dt.astimezone(IST_TZ).date()

                if tl_date is None or tl_date <= target_date:
                    seg_sec = 0
                    if tl.status == 'IN_PROGRESS':
                        seg_start_str = tl.current_segment_start or tl.start_time
                        if seg_start_str:
                            s_dt = parse_iso_utc(seg_start_str)
                            if s_dt and s_dt < cutoff_utc:
                                seg_sec = max(0, int((cutoff_utc - s_dt).total_seconds()))
                            else:
                                seg_sec = 0
                        tl.duration_seconds += seg_sec
                        segs = list(tl.work_segments or [])
                        segs.append({
                            'start_time': seg_start_str,
                            'end_time': cutoff_utc_str,
                            'duration_seconds': seg_sec
                        })
                        tl.work_segments = segs

                    tl.current_segment_start = None
                    tl.end_time = cutoff_utc_str
                    tl.status = 'ENDED'
                    tl.is_explicit_completed = False
                    tl.updated_at = cutoff_utc_str
                    tl.save()

            # 3. Write attendance END_WORK event if attendance was active
            event_created = None
            if attendance_was_active:
                # Double-check no END_WORK exists on this date to prevent duplicate events
                existing_end = TimeEvent.objects.filter(
                    user_id=user_id,
                    event_type='END_WORK',
                    timestamp__gte=cutoff_utc_str[:10]  # Same day
                ).first()
                if not existing_end:
                    event_created = storage.record_event(
                        user_id=user_id,
                        event_type='END_WORK',
                        source=source,
                        timestamp=cutoff_utc
                    )
            elif not is_already_ended and today_events:
                # If there were events today but not marked Ended
                last_ev = today_events[-1]
                if last_ev.get('event_type') in ['START_WORK', 'START_BREAK', 'RESUME_WORK']:
                    event_created = storage.record_event(
                        user_id=user_id,
                        event_type='END_WORK',
                        source=source,
                        timestamp=cutoff_utc
                    )

            cache.clear()
            return {
                'closed': True,
                'user_id': user_id,
                'cutoff_utc': cutoff_utc_str,
                'event': event_created,
                'status': 'Ended'
            }


def enforce_user_workday_cutoff(user_id, now_ist=None):
    """
    Checks if user_id has any unclosed sessions that are past their 7:30 PM IST cutoff.
    Closes them immediately and deterministically at 7:30:00 PM IST of that workday.
    """
    if now_ist is None:
        now_ist = get_current_ist_time()

    today_date = now_ist.date()
    cutoff_dt_today = get_workday_cutoff_ist(today_date)
    cutoff_utc_today = cutoff_dt_today.astimezone(timezone.utc)

    from .models import WorkSession, TaskLog, TimeEvent
    from .storage_adapter import storage
    from .views import calculate_day_metrics

    # Check for past unclosed dates
    events = storage.get_events_for_user(user_id)
    if events:
        first_dt = parse_iso_utc(events[0]['timestamp'])
        last_dt = parse_iso_utc(events[-1]['timestamp'])
        if last_dt:
            last_date = last_dt.astimezone(IST_TZ).date()
            if last_date < today_date:
                # Old unclosed session from yesterday or earlier
                old_cutoff_utc = get_workday_cutoff_utc(last_date)
                close_single_user_at_cutoff(user_id, last_date, old_cutoff_utc, source="past_cutoff_sync")

    # Check if today is past 7:30 PM IST
    if now_ist >= cutoff_dt_today:
        close_single_user_at_cutoff(user_id, today_date, cutoff_utc_today, source="auto_cutoff")


def close_all_active_sessions_at_cutoff(target_date=None, now_ist=None, force=False):
    """
    Iterates over all employee accounts and closes any sessions active at or past the 7:30 PM cutoff.
    If target_date is not specified, defaults to today_date if now_ist >= 7:30 PM IST.
    """
    if now_ist is None:
        now_ist = get_current_ist_time()

    today_date = now_ist.date()
    effective_date = target_date or today_date
    cutoff_dt = get_workday_cutoff_ist(effective_date)
    cutoff_utc = cutoff_dt.astimezone(timezone.utc)

    if not force and now_ist < cutoff_dt and effective_date == today_date:
        # Not yet 7:30 PM on effective_date
        return {'closed_count': 0, 'reason': 'before_cutoff', 'cutoff_ist': cutoff_dt.isoformat()}

    from .models import User, WorkSession, TaskLog, TimeEvent
    from .storage_adapter import storage
    from .views import calculate_day_metrics

    employees = User.objects.filter(role='EMPLOYEE', is_active=True)
    closed_users = []

    for emp in employees:
        events = storage.get_events_for_user(emp.id)
        day_events = [
            e for e in events
            if parse_iso_utc(e.get('timestamp')) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == effective_date
        ]
        metrics = calculate_day_metrics(day_events, cutoff_utc)
        has_active_attendance = metrics.get('status') in ['Working', 'On Break']
        has_active_work_sessions = WorkSession.objects.filter(
            user_id=emp.id,
            status__in=['IN_PROGRESS', 'PAUSED']
        ).exists()
        has_active_task_logs = TaskLog.objects.filter(
            user_id=emp.id,
            status__in=['IN_PROGRESS', 'PAUSED']
        ).exists()

        if has_active_attendance or has_active_work_sessions or has_active_task_logs:
            res = close_single_user_at_cutoff(emp.id, effective_date, cutoff_utc, source="scheduler")
            if res.get('closed'):
                closed_users.append(emp.id)

    return {
        'closed_count': len(closed_users),
        'closed_users': closed_users,
        'cutoff_ist': cutoff_dt.isoformat(),
        'cutoff_utc': cutoff_utc.isoformat().replace("+00:00", "Z")
    }


# Background Scheduler Thread Management
_SCHEDULER_THREAD = None
_SCHEDULER_RUNNING = False
_SCHEDULER_LOCK = threading.Lock()


def _background_scheduler_loop():
    """
    Background daemon loop that checks every 30 seconds.
    If current IST time is at or past 7:30 PM (19:30:00 IST),
    runs close_all_active_sessions_at_cutoff().
    """
    global _SCHEDULER_RUNNING
    logger.info("TimeTracker Workday Auto-Cutoff Background Scheduler started.")
    while _SCHEDULER_RUNNING:
        try:
            now_ist = get_current_ist_time()
            today_date = now_ist.date()
            cutoff_dt = get_workday_cutoff_ist(today_date)
            # Only trigger if within the window after 7:30 PM IST (e.g. 19:30 to 23:59 IST)
            if now_ist >= cutoff_dt:
                # Use a lightweight cache lock so multiple server workers / threads don't collide
                lock_acquired = cache.add(f"auto_cutoff_lock_{today_date.isoformat()}", "locked", timeout=45)
                if lock_acquired:
                    try:
                        result = close_all_active_sessions_at_cutoff(target_date=today_date, now_ist=now_ist)
                        if result.get('closed_count', 0) > 0:
                            logger.info(f"Auto-Cutoff Scheduler closed {result['closed_count']} employee workdays at 7:30 PM IST: {result['closed_users']}")
                    finally:
                        pass
        except Exception as e:
            logger.error(f"Error in auto-cutoff scheduler loop: {e}", exc_info=True)
        pytime.sleep(30)


def start_background_scheduler():
    """Starts the in-process background daemon scheduler if not already running."""
    global _SCHEDULER_THREAD, _SCHEDULER_RUNNING
    with _SCHEDULER_LOCK:
        if _SCHEDULER_RUNNING:
            return
        _SCHEDULER_RUNNING = True
        _SCHEDULER_THREAD = threading.Thread(target=_background_scheduler_loop, daemon=True, name="AutoCutoffScheduler")
        _SCHEDULER_THREAD.start()


def stop_background_scheduler():
    """Stops the in-process background daemon scheduler."""
    global _SCHEDULER_RUNNING
    with _SCHEDULER_LOCK:
        _SCHEDULER_RUNNING = False

