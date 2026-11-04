import csv
import io
import re
import uuid
import math
import secrets
import calendar
import zoneinfo
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date
from django.db import models
from django.core.cache import cache
from django.contrib.auth import authenticate
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.authtoken.models import Token
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

from .models import (
    User, Invitation, Notification, TaskLog, generate_unique_employee_id,
    Project, ProjectTask, WorkSession, TaskProgressNote, ProjectAuditHistory,
    TimesheetEntry, TimeEvent,
    generate_project_id, generate_task_id, generate_session_id
)
from .storage_adapter import storage

IST_TZ = zoneinfo.ZoneInfo("Asia/Kolkata")


def is_valid_email(email_str):
    if not email_str or '@' not in email_str:
        return False
    # RFC 5322 simplified email regex pattern
    pattern = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    return bool(re.match(pattern, email_str))


def validate_strong_password(pw):
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


def parse_iso_utc(ts_str):
    if not ts_str:
        return None
    cleaned = ts_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None


def calculate_day_metrics(events_for_day, now_utc=None):
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    
    events_sorted = sorted(events_for_day, key=lambda x: x['timestamp'])
    
    if not events_sorted:
        return {
            'status': 'Not Started',
            'tracker_state': 'IDLE',
            'start_time': None,
            'end_time': None,
            'total_work_seconds': 0,
            'total_break_seconds': 0,
            'completed_work_seconds': 0,
            'completed_break_seconds': 0,
            'work_duration': '00:00:00',
            'break_duration': '00:00:00',
            'total_daily_seconds': 0,
            'total_daily_duration': '00:00:00',
            'break_segments': [],
            'current_segment_start': None,
            'events': []
        }
    
    start_time = events_sorted[0]['timestamp']
    end_time = None
    total_work_seconds = 0
    total_break_seconds = 0
    
    current_state = 'Not Started'
    state_start_dt = None
    break_segments = []
    
    for ev in events_sorted:
        ev_dt = parse_iso_utc(ev['timestamp'])
        ev_type = ev['event_type']
        
        if current_state == 'Working':
            if state_start_dt and ev_dt:
                total_work_seconds += max(0, (ev_dt - state_start_dt).total_seconds())
        elif current_state == 'On Break':
            if state_start_dt and ev_dt:
                dur = max(0, (ev_dt - state_start_dt).total_seconds())
                total_break_seconds += dur
                break_segments.append({
                    'start_time': state_start_dt,
                    'end_time': ev_dt,
                    'duration_seconds': int(dur)
                })
                
        if ev_type in ['START_WORK', 'RESUME_WORK']:
            current_state = 'Working'
            state_start_dt = ev_dt
        elif ev_type == 'START_BREAK':
            current_state = 'On Break'
            state_start_dt = ev_dt
        elif ev_type == 'END_WORK':
            current_state = 'Ended'
            end_time = ev['timestamp']
            state_start_dt = None

    completed_work_sec = int(total_work_seconds)
    completed_break_sec = int(total_break_seconds)

    # If currently active, add duration up to now
    if current_state == 'Working' and state_start_dt:
        total_work_seconds += max(0, (now_utc - state_start_dt).total_seconds())
    elif current_state == 'On Break' and state_start_dt:
        dur = max(0, (now_utc - state_start_dt).total_seconds())
        total_break_seconds += dur
        break_segments.append({
            'start_time': state_start_dt,
            'end_time': None,
            'duration_seconds': int(dur)
        })

    # Format break details (start - end in IST)
    break_detail_items = []
    for b in break_segments:
        s_ist = b['start_time'].astimezone(IST_TZ).strftime('%I:%M:%S %p') if b['start_time'] else ''
        e_ist = b['end_time'].astimezone(IST_TZ).strftime('%I:%M:%S %p') if b['end_time'] else 'In progress'
        break_detail_items.append(f"{s_ist} - {e_ist}")
    break_details_str = "; ".join(break_detail_items) if break_detail_items else '-'

    # Format durations as HH:MM:SS
    total_b_sec = int(total_break_seconds)
    b_h = total_b_sec // 3600
    b_m = (total_b_sec % 3600) // 60
    b_s = total_b_sec % 60
    break_duration_formatted = f"{b_h:02d}:{b_m:02d}:{b_s:02d}"

    total_w_sec = int(total_work_seconds)
    w_h = total_w_sec // 3600
    w_m = (total_w_sec % 3600) // 60
    w_s = total_w_sec % 60
    work_duration_formatted = f"{w_h:02d}:{w_m:02d}:{w_s:02d}"

    # Calculate Total Daily Time: Clock-Out (or now_utc) - Clock-In
    total_daily_seconds = 0
    if start_time:
        start_dt_iso = parse_iso_utc(start_time)
        if start_dt_iso:
            if current_state in ['Working', 'On Break']:
                # currently in progress, use now_utc
                total_daily_seconds = max(0, (now_utc - start_dt_iso).total_seconds())
            elif end_time:
                end_dt_iso = parse_iso_utc(end_time)
                if end_dt_iso:
                    total_daily_seconds = max(0, (end_dt_iso - start_dt_iso).total_seconds())

    td_sec = int(total_daily_seconds)
    td_h = td_sec // 3600
    td_m = (td_sec % 3600) // 60
    td_s = td_sec % 60
    total_daily_duration_formatted = f"{td_h:02d}:{td_m:02d}:{td_s:02d}"

    tracker_state = 'WORKING' if current_state == 'Working' else ('BREAK' if current_state == 'On Break' else 'IDLE')

    return {
        'status': current_state,
        'tracker_state': tracker_state,
        'start_time': start_time,
        'end_time': end_time,
        'total_work_seconds': total_w_sec,
        'total_break_seconds': total_b_sec,
        'completed_work_seconds': completed_work_sec,
        'completed_break_seconds': completed_break_sec,
        'work_duration': work_duration_formatted,
        'break_duration': break_duration_formatted,
        'total_daily_seconds': td_sec,
        'total_daily_duration': total_daily_duration_formatted,
        'break_segments': [
            {
                'start_time': b['start_time'].isoformat() if b['start_time'] else None,
                'end_time': b['end_time'].isoformat() if b['end_time'] else None,
                'duration_seconds': b['duration_seconds']
            } for b in break_segments
        ],
        'current_segment_start': state_start_dt.isoformat().replace("+00:00", "Z") if state_start_dt else None,
        'events': events_sorted
    }


# ==========================================
# AUTHENTICATION
# ==========================================

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = (request.data.get('username') or request.data.get('email') or '').strip()
    password = request.data.get('password')
    
    if not username or not password:
        return Response({'error': 'Username and password are required.'}, status=400)
    
    # Authenticate by username, email, employee ID, or domain typo fallback
    user = User.objects.filter(username__iexact=username).first()
    if not user:
        user = User.objects.filter(email__iexact=username).first()
    if not user:
        user = User.objects.filter(employee_id__iexact=username).first()
    if not user and '@' in username:
        alt_email = username.replace('@gamil.com', '@gmail.com') if '@gamil.com' in username else username.replace('@gmail.com', '@gamil.com')
        user = User.objects.filter(email__iexact=alt_email).first()
        
    if not user or not user.check_password(password):
        return Response({'error': 'Invalid username or password.'}, status=400)
        
    if not user.is_active:
        return Response({'error': 'Your account has been deactivated. Please contact an administrator.'}, status=403)
        
    token, _ = Token.objects.get_or_create(user=user)
    storage.log_audit(
        action="USER_LOGIN",
        actor=user.username,
        details={"user_id": user.id, "role": user.role}
    )
    return Response({
        'token': token.key,
        'user': {
            'id': user.id,
            'username': user.username,
            'employee_id': user.employee_id or '',
            'name': f"{user.first_name} {user.last_name}".strip() or user.username,
            'email': user.email or '',
            'role': user.role,
            'department': user.department or 'General',
            'employment_status': user.employment_status,
            'approval_status': user.approval_status
        }
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def signup_view(request):
    username = (request.data.get('username') or '').strip()
    password = request.data.get('password') or ''

    if not username:
        return Response({'error': 'Username is required.'}, status=400)

    if len(username) < 3:
        return Response({'error': 'Username must be at least 3 characters long.'}, status=400)

    if not re.match(r'^[a-zA-Z0-9_.-]+$', username):
        return Response({'error': 'Username can only contain letters, numbers, dots, hyphens, and underscores.'}, status=400)

    if not password:
        return Response({'error': 'Password is required.'}, status=400)

    if len(password) < 6:
        return Response({'error': 'Password must be at least 6 characters long.'}, status=400)

    # Check for duplicate username
    if User.objects.filter(username__iexact=username).exists():
        return Response({'error': f'The username "{username}" is already taken. Please choose another username.'}, status=400)

    # Security requirement: ALL public signups are strictly assigned EMPLOYEE role.
    # Public visitors and signups CANNOT create or request an Admin account.
    emp_id = generate_unique_employee_id(username)
    user = User.objects.create_user(
        username=username,
        password=password,
        role='EMPLOYEE',
        employee_id=emp_id,
        approval_status='APPROVED',
        is_active=True,
        is_staff=False,
        is_superuser=False
    )

    token, _ = Token.objects.get_or_create(user=user)

    storage.log_audit(
        action="USER_SIGNUP",
        actor=user.username,
        details={
            "user_id": user.id,
            "username": user.username,
            "employee_id": user.employee_id,
            "role": "EMPLOYEE"
        }
    )

    return Response({
        'message': 'Account created successfully! You can now sign in.',
        'token': token.key,
        'user': {
            'id': user.id,
            'username': user.username,
            'employee_id': user.employee_id,
            'name': user.username,
            'role': 'EMPLOYEE',
            'approval_status': user.approval_status
        }
    }, status=201)


@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password_view(request):
    email = (request.data.get('email') or '').strip().lower()
    if not email:
        return Response({'error': 'Please enter your work email address.'}, status=400)
    if not is_valid_email(email):
        return Response({'error': 'Please enter a valid email address.'}, status=400)

    user = User.objects.filter(email__iexact=email).first()
    if user:
        Notification.objects.create(
            title="Password Reset Request",
            message=f"User {user.first_name} {user.last_name} ({user.email}) requested a password reset.",
            notification_type="PASSWORD_RESET",
            related_user=user
        )
        storage.log_audit(
            action="PASSWORD_RESET_REQUEST",
            actor=email,
            details={"user_id": user.id, "email": email}
        )

    return Response({
        'message': (
            'If your email is registered with Knowletive, an administrator notification has been recorded. '
            'Because direct email delivery is restricted for internal workspace security, '
            'please contact your workspace administrator to set or reset your credentials.'
        )
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def verify_invitation_view(request):
    code = (request.GET.get('code') or '').strip().upper()
    if not code:
        return Response({'valid': False, 'error': 'Invitation code is required.'}, status=400)
    
    invitation = Invitation.objects.filter(code__iexact=code).first()
    if not invitation:
        return Response({'valid': False, 'error': 'Invalid invitation code.'}, status=404)
    if invitation.is_revoked:
        return Response({'valid': False, 'error': 'This invitation code has been revoked.'}, status=400)
    if invitation.is_used:
        return Response({'valid': False, 'error': 'This invitation code has already been used.'}, status=400)
    if invitation.expires_at and datetime.now(timezone.utc) > invitation.expires_at:
        return Response({'valid': False, 'error': 'This invitation code has expired.'}, status=400)

    return Response({
        'valid': True,
        'code': invitation.code,
        'recipient_email': invitation.recipient_email or '',
        'expires_at': invitation.expires_at.isoformat() if invitation.expires_at else None,
        'notes': invitation.notes
    })


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def logout_view(request):
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    logged_out_user = None
    if auth_header.startswith('Token '):
        token_key = auth_header.split(' ')[1].strip()
        try:
            tok = Token.objects.select_related('user').get(key=token_key)
            logged_out_user = tok.user
            tok.delete()
        except Token.DoesNotExist:
            pass
    elif request.user and request.user.is_authenticated:
        logged_out_user = request.user
        try:
            request.user.auth_token.delete()
        except Exception:
            pass

    if logged_out_user:
        storage.log_audit(
            action="USER_LOGOUT",
            actor=logged_out_user.email or logged_out_user.username,
            details={"user_id": logged_out_user.id}
        )
    return Response({'message': 'Logged out successfully.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    if not user.is_active:
        return Response({'error': 'Account has been deactivated. Please contact an administrator.'}, status=403)
    if user.role == 'EMPLOYEE' and user.approval_status != 'APPROVED':
        return Response({'error': 'Your account is pending administrator approval.'}, status=403)
        
    return Response({
        'user': {
            'id': user.id,
            'username': user.username,
            'employee_id': user.employee_id or (f"EMP{user.id:03d}" if user.role == 'EMPLOYEE' else ''),
            'name': f"{user.first_name} {user.last_name}".strip() or user.username,
            'email': user.email or '',
            'role': user.role,
            'department': user.department or 'General',
            'employment_status': user.employment_status,
            'approval_status': user.approval_status
        }
    })


# ==========================================
# EMPLOYEE TRACKER
# ==========================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def status_view(request):
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist_date = now_ist.date()
    
    events = storage.get_events_for_user(request.user.id)
    
    # Filter today's events in IST
    today_events = []
    for ev in events:
        dt = parse_iso_utc(ev['timestamp'])
        if dt and dt.astimezone(IST_TZ).date() == today_ist_date:
            today_events.append(ev)
            
    today_metrics = calculate_day_metrics(today_events, now_utc)

    # Active or paused task details
    raw_active = storage.get_active_task_for_user(request.user.id)
    active_task = None
    if raw_active:
        dur_sec = storage.calculate_task_duration(raw_active, now_utc)
        active_task = {
            'task_log_id': raw_active['task_log_id'],
            'employee_id': raw_active.get('employee_id') or getattr(request.user, 'employee_id', '') or f"EMP{request.user.id:03d}",
            'employee_name': raw_active.get('employee_name') or f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
            'project_name': raw_active['project_name'],
            'task_name': raw_active['task_name'],
            'description': raw_active.get('description', ''),
            'start_time': raw_active['start_time'],
            'end_time': raw_active.get('end_time'),
            'status': raw_active.get('status', 'IN_PROGRESS'),
            'duration_seconds': dur_sec,
            'duration_seconds_base': int(raw_active.get('duration_seconds') or 0),
            'current_segment_start': raw_active.get('current_segment_start'),
            'work_segments': raw_active.get('work_segments', [])
        }
    
    # Weekly history (past 7 days in IST)
    weekly_history = []
    for i in range(7):
        target_date = today_ist_date - timedelta(days=i)
        day_events = [
            e for e in events 
            if parse_iso_utc(e['timestamp']) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == target_date
        ]
        metrics = calculate_day_metrics(day_events, now_utc if target_date == today_ist_date else None)
        weekly_history.append({
            'date': target_date.isoformat(),
            'status': metrics['status'],
            'start_time': metrics['start_time'],
            'end_time': metrics['end_time'],
            'total_work_seconds': metrics['total_work_seconds'],
            'total_break_seconds': metrics['total_break_seconds']
        })

    settings = storage.get_settings()
    
    return Response({
        'status': today_metrics['status'],
        'tracker_state': today_metrics['tracker_state'],
        'start_time': today_metrics['start_time'],
        'end_time': today_metrics['end_time'],
        'total_work_seconds': today_metrics['total_work_seconds'],
        'total_break_seconds': today_metrics['total_break_seconds'],
        'completed_work_seconds': today_metrics['completed_work_seconds'],
        'completed_break_seconds': today_metrics['completed_break_seconds'],
        'current_segment_start': today_metrics['current_segment_start'],
        'active_task': active_task,
        'today_events': today_metrics['events'],
        'weekly_history': weekly_history,
        'user_role': request.user.role,
        'settings': settings
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def action_view(request):
    if request.user.role != 'EMPLOYEE':
        return Response({'error': 'Only employee accounts can track work time. Admin accounts cannot record employee work logs.'}, status=403)

    action = request.data.get('action')
    source = request.data.get('source', 'web')
    valid_actions = ['START_WORK', 'START_BREAK', 'RESUME_WORK', 'END_WORK']
    
    if action not in valid_actions:
        return Response({'error': f'Invalid action: {action}.'}, status=400)

    now_utc = datetime.now(timezone.utc)
    now_utc_str = now_utc.isoformat().replace("+00:00", "Z")
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist_date = now_ist.date()
    
    # Fetch events & lock checks
    events = storage.get_events_for_user(request.user.id)
    today_events = [
        e for e in events 
        if parse_iso_utc(e['timestamp']) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == today_ist_date
    ]
    today_events.sort(key=lambda x: x['timestamp'])

    # Determine current status
    metrics = calculate_day_metrics(today_events, now_utc)
    current_status = metrics['status']

    # State machine transition validation
    if action == 'START_WORK':
        if current_status == 'Working':
            return Response({'error': 'Workday is already active.'}, status=400)
        if current_status == 'On Break':
            return Response({'error': 'You are currently on a break. Please use Resume Work.'}, status=400)
        if current_status == 'Ended':
            return Response({'error': 'Workday has already ended for today. Contact admin for corrections.'}, status=400)
            
    elif action == 'START_BREAK':
        if current_status != 'Working':
            return Response({'error': 'You must be actively working to start a break.'}, status=400)
            
    elif action == 'RESUME_WORK':
        if current_status != 'On Break':
            return Response({'error': 'You are not currently on a break.'}, status=400)
            
    elif action == 'END_WORK':
        if current_status not in ['Working', 'On Break']:
            return Response({'error': 'Cannot end workday because it is not active.'}, status=400)

    # Deduplication check: if action is identical to last event within 2 seconds, ignore to protect against rapid double clicks
    if today_events:
        last_ev = today_events[-1]
        last_dt = parse_iso_utc(last_ev['timestamp'])
        if last_ev['event_type'] == action and (now_utc - last_dt).total_seconds() < 2:
            return Response({'error': 'Duplicate request ignored.'}, status=429)

    # CASE 2: When starting break, immediately PAUSE active task and freeze its work duration
    if action == 'START_BREAK':
        storage.pause_active_task(request.user.id, now_utc_str)
        active_session = WorkSession.objects.filter(user_id=request.user.id, status='IN_PROGRESS').first()
        if active_session:
            seg_start_str = active_session.current_segment_start or active_session.start_time
            seg_sec = 0
            if seg_start_str:
                try:
                    s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                    seg_sec = max(0, int((now_utc - s_dt).total_seconds()))
                except Exception:
                    pass
            active_session.duration_seconds += seg_sec
            active_session.task.total_duration_seconds += seg_sec
            active_session.task.save(update_fields=['total_duration_seconds', 'updated_at'])
            segs = list(active_session.work_segments or [])
            segs.append({'start_time': seg_start_str, 'end_time': now_utc_str, 'duration_seconds': seg_sec})
            active_session.work_segments = segs
            active_session.current_segment_start = None
            active_session.status = 'PAUSED'
            active_session.updated_at = now_utc_str
            active_session.save()
            ProjectAuditHistory.objects.create(
                project=active_session.task.project,
                task=active_session.task,
                action='SESSION_PAUSED',
                actor=request.user,
                actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
                details={'reason': 'Workday break started'}
            )

    # CASE 3: When resuming work from break, immediately RESUME the paused task
    elif action == 'RESUME_WORK':
        storage.resume_active_task(request.user.id, now_utc_str)
        paused_session = WorkSession.objects.filter(user_id=request.user.id, status='PAUSED').first()
        if paused_session:
            paused_session.status = 'IN_PROGRESS'
            paused_session.current_segment_start = now_utc_str
            paused_session.updated_at = now_utc_str
            paused_session.save()
            ProjectAuditHistory.objects.create(
                project=paused_session.task.project,
                task=paused_session.task,
                action='SESSION_RESUMED',
                actor=request.user,
                actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
                details={'reason': 'Workday resumed from break'}
            )

    # When ending workday, close any active or paused task without marking task completed
    elif action == 'END_WORK':
        storage.end_any_active_task_for_user(request.user.id, now_utc_str)
        active_sessions = WorkSession.objects.filter(user_id=request.user.id, status__in=['IN_PROGRESS', 'PAUSED'])
        for s in active_sessions:
            if s.status == 'IN_PROGRESS':
                seg_start_str = s.current_segment_start or s.start_time
                seg_sec = 0
                if seg_start_str:
                    try:
                        s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                        seg_sec = max(0, int((now_utc - s_dt).total_seconds()))
                    except Exception:
                        pass
                s.duration_seconds += seg_sec
                s.task.total_duration_seconds += seg_sec
                s.task.save(update_fields=['total_duration_seconds', 'updated_at'])
                segs = list(s.work_segments or [])
                segs.append({'start_time': seg_start_str, 'end_time': now_utc_str, 'duration_seconds': seg_sec})
                s.work_segments = segs
            s.current_segment_start = None
            s.end_time = now_utc_str
            s.status = 'ENDED'
            s.updated_at = now_utc_str
            s.save()
            if s.task_log_id:
                TaskLog.objects.filter(task_id=s.task_log_id).update(
                    end_time=now_utc_str, status='ENDED', is_explicit_completed=False, updated_at=now_utc_str
                )
            ProjectAuditHistory.objects.create(
                project=s.task.project,
                task=s.task,
                action='SESSION_STOPPED',
                actor=request.user,
                actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
                details={'reason': 'Workday ended (clock-out)'}
            )

    # Server writes timestamp, ignores any client timestamp
    res = storage.record_event(request.user.id, action, source=source)
    return Response({'success': True, 'event': res})


# ==========================================
# ADMIN DASHBOARD & ATTENDANCE
# ==========================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_dashboard(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    users = User.objects.filter(role='EMPLOYEE').order_by('first_name', 'last_name')
    all_events = storage.get_all_events()
    settings = storage.get_settings()
    
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist_date = now_ist.date()

    # Parse office hours for late/early comparison
    work_start_h, work_start_m = map(int, settings.get('work_start_time', '10:00').split(':'))
    work_end_h, work_end_m = map(int, settings.get('work_end_time', '19:00').split(':'))
    
    office_start_dt = now_ist.replace(hour=work_start_h, minute=work_start_m, second=0, microsecond=0)
    office_end_dt = now_ist.replace(hour=work_end_h, minute=work_end_m, second=0, microsecond=0)

    user_data = []
    active_count = 0
    late_count = 0
    missing_clockout_count = 0

    for u in users:
        u_events = [
            e for e in all_events 
            if int(e.get('user_id', -1)) == u.id and parse_iso_utc(e['timestamp']) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == today_ist_date
        ]
        metrics = calculate_day_metrics(u_events, now_utc)
        
        status = metrics['status']
        if status in ['Working', 'On Break']:
            active_count += 1

        is_late_start = False
        if metrics['start_time']:
            start_dt = parse_iso_utc(metrics['start_time']).astimezone(IST_TZ)
            if start_dt > office_start_dt + timedelta(minutes=5):
                is_late_start = True
                late_count += 1

        is_early_finish = False
        if metrics['end_time']:
            end_dt = parse_iso_utc(metrics['end_time']).astimezone(IST_TZ)
            if end_dt < office_end_dt - timedelta(minutes=10):
                is_early_finish = True

        is_missing_clockout = False
        if status in ['Working', 'On Break'] and now_ist > office_end_dt + timedelta(hours=1):
            is_missing_clockout = True
            missing_clockout_count += 1

        user_data.append({
            'id': u.id,
            'employee_id': u.employee_id or f"EMP{u.id:03d}",
            'name': f"{u.first_name} {u.last_name}".strip() or u.username,
            'email': u.email,
            'department': u.department or 'Unassigned',
            'role': u.role,
            'employment_status': u.employment_status,
            'is_active': u.is_active,
            'status': status,
            'start_time': metrics['start_time'],
            'end_time': metrics['end_time'],
            'total_work_seconds': metrics['total_work_seconds'],
            'total_break_seconds': metrics['total_break_seconds'],
            'is_late_start': is_late_start,
            'is_early_finish': is_early_finish,
            'is_missing_clockout': is_missing_clockout
        })
        
    return Response({
        'overview': {
            'total_employees': users.count(),
            'active_now': active_count,
            'late_today': late_count,
            'missing_clockouts': missing_clockout_count
        },
        'users': user_data,
        'settings': settings
    })


# ==========================================
# USER MANAGEMENT (CRUD)
# ==========================================

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def user_management(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    if request.method == 'GET':
        users = User.objects.all().order_by('id')
        data = [{
            'id': u.id,
            'employee_id': u.employee_id or (f"EMP{u.id:03d}" if u.role == 'EMPLOYEE' else ''),
            'name': f"{u.first_name} {u.last_name}".strip() or u.username,
            'first_name': u.first_name,
            'last_name': u.last_name,
            'email': u.email,
            'department': u.department,
            'role': u.role,
            'employment_status': u.employment_status,
            'approval_status': u.approval_status,
            'is_active': u.is_active,
            'date_joined': u.date_joined.isoformat() if u.date_joined else None
        } for u in users]
        return Response({'users': data})

    elif request.method == 'POST':
        username = (request.data.get('username') or request.data.get('email') or '').strip()
        email = (request.data.get('email') or '').strip().lower()
        full_name_input = (request.data.get('name') or '').strip()
        first_name = (request.data.get('first_name') or '').strip()
        last_name = (request.data.get('last_name') or '').strip()
        if full_name_input and not first_name:
            parts = full_name_input.split(' ', 1)
            first_name = parts[0]
            if len(parts) > 1 and not last_name:
                last_name = parts[1]

        department = (request.data.get('department') or '').strip()
        role = request.data.get('role', 'EMPLOYEE')
        password = request.data.get('password')
        approval_status = request.data.get('approval_status', 'APPROVED')
        
        if not username:
            return Response({'error': 'Username is required.'}, status=400)
            
        if User.objects.filter(username__iexact=username).exists():
            return Response({'error': f'A user with username "{username}" already exists.'}, status=400)

        if email:
            if not is_valid_email(email):
                return Response({'error': 'Please provide a valid work email address.'}, status=400)
            if User.objects.filter(email__iexact=email).exists():
                return Response({'error': f'The email "{email}" is already used by another account.'}, status=400)
            
        if password:
            if len(password) < 6:
                return Response({'error': 'Password must be at least 6 characters long.'}, status=400)
        else:
            password = f"K{secrets.token_urlsafe(8)}!9a"

        assigned_role = role if role in ['ADMIN', 'EMPLOYEE'] else 'EMPLOYEE'
        emp_id = None
        if assigned_role == 'EMPLOYEE':
            emp_id = generate_unique_employee_id(first_name or full_name_input or username)

        user = User.objects.create_user(
            username=username,
            email=email if email else f"{username}@knowletive.local",
            first_name=first_name,
            last_name=last_name,
            department=department,
            role=assigned_role,
            employee_id=emp_id,
            approval_status='APPROVED',
            is_active=True,
            is_staff=(assigned_role == 'ADMIN'),
            is_superuser=(assigned_role == 'ADMIN'),
            password=password
        )
        storage.log_audit(
            action="CREATE_USER",
            actor=request.user.username,
            details={"created_user_id": user.id, "username": username, "employee_id": user.employee_id, "role": user.role}
        )
        return Response({
            'message': 'User created successfully.',
            'user': {
                'id': user.id,
                'employee_id': user.employee_id or '',
                'username': user.username,
                'email': user.email,
                'name': f"{user.first_name} {user.last_name}".strip() or user.username,
                'role': user.role,
                'department': user.department,
                'approval_status': user.approval_status
            }
        }, status=201)


@api_view(['PATCH', 'PUT'])
@permission_classes([IsAuthenticated])
def user_detail_manage(request, user_id):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=404)
        
    data = request.data
    previous_role = user.role

    if 'first_name' in data:
        user.first_name = data['first_name']
    if 'last_name' in data:
        user.last_name = data['last_name']
    if 'email' in data:
        new_email = (data.get('email') or '').strip().lower()
        if not new_email:
            return Response({'error': 'Work email cannot be blank.'}, status=400)
        if not is_valid_email(new_email):
            return Response({'error': 'Please provide a valid work email address.'}, status=400)
        if User.objects.filter(email__iexact=new_email).exclude(id=user.id).exists():
            return Response({'error': f'The email "{new_email}" is already used by another account.'}, status=400)
        
        old_email = (user.email or '').strip().lower()
        user.email = new_email
        # If user was using old email as username, sync username if available
        if old_email and user.username.lower() == old_email:
            if not User.objects.filter(username__iexact=new_email).exclude(id=user.id).exists():
                user.username = new_email

    if 'username' in data:
        new_username = (data.get('username') or '').strip()
        if new_username and new_username.lower() != user.username.lower():
            if User.objects.filter(username__iexact=new_username).exclude(id=user.id).exists():
                return Response({'error': f'The username "{new_username}" is already taken.'}, status=400)
            user.username = new_username

    if 'department' in data:
        user.department = data['department']
    if 'role' in data and data['role'] in ['ADMIN', 'EMPLOYEE']:
        new_role = data['role']
        if previous_role != new_role:
            storage.log_audit(
                action="ADMIN_ROLE_CHANGE",
                actor=request.user.email or request.user.username,
                details={
                    "target_user_id": user.id,
                    "target_email": user.email,
                    "previous_role": previous_role,
                    "new_role": new_role,
                    "changed_by": request.user.email or request.user.username
                }
            )
        user.role = new_role
        user.is_staff = (new_role == 'ADMIN')
        user.is_superuser = (new_role == 'ADMIN')
    if 'employment_status' in data:
        user.employment_status = data['employment_status']
    if 'approval_status' in data and data['approval_status'] in ['PENDING', 'APPROVED', 'REJECTED']:
        user.approval_status = data['approval_status']
    if 'is_active' in data:
        val = data['is_active']
        is_active_bool = val if isinstance(val, bool) else str(val).lower() in ['true', '1', 't']
        if not is_active_bool and user.role == 'ADMIN':
            return Response({'error': 'Administrator accounts cannot be deactivated.'}, status=400)
        user.is_active = is_active_bool
    if 'password' in data and data['password']:
        is_valid, pw_err = validate_strong_password(data['password'])
        if not is_valid:
            return Response({'error': f'Password does not meet complexity requirements: {pw_err}'}, status=400)
        user.set_password(data['password'])
        storage.log_audit(
            action="ADMIN_PASSWORD_RESET",
            actor=request.user.email or request.user.username,
            details={"target_user_id": user.id, "target_email": user.email}
        )
        
    # Keep employee_id permanent and generated if employee role has no id
    if user.role == 'EMPLOYEE' and not user.employee_id:
        user.employee_id = generate_unique_employee_id(user.first_name or user.username)
        
    user.save()
    storage.log_audit(
        action="UPDATE_USER",
        actor=request.user.email or request.user.username,
        details={
            "updated_user_id": user.id,
            "employee_id": user.employee_id,
            "email": user.email,
            "role": user.role,
            "approval_status": user.approval_status,
            "is_active": user.is_active
        }
    )
    return Response({
        'message': 'User updated successfully.',
        'user': {
            'id': user.id,
            'employee_id': user.employee_id or '',
            'name': f"{user.first_name} {user.last_name}".strip() or user.username,
            'email': user.email,
            'role': user.role
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def approve_user_view(request, user_id):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=404)

    user.approval_status = 'APPROVED'
    user.is_active = True
    user.save()
    storage.log_audit(
        action="APPROVE_USER",
        actor=request.user.email,
        details={"approved_user_id": user.id, "email": user.email}
    )
    return Response({'message': f'User {user.email} has been approved successfully.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reject_user_view(request, user_id):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=404)

    user.approval_status = 'REJECTED'
    user.save()
    storage.log_audit(
        action="REJECT_USER",
        actor=request.user.email,
        details={"rejected_user_id": user.id, "email": user.email}
    )
    return Response({'message': f'User {user.email} has been rejected.'})


# ==========================================
# INVITATION MANAGEMENT
# ==========================================

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def admin_invitations_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    if request.method == 'GET':
        invitations = Invitation.objects.all().order_by('-created_at')
        now_dt = datetime.now(timezone.utc)
        data = []
        for inv in invitations:
            status_str = 'Active'
            if inv.is_revoked:
                status_str = 'Revoked'
            elif inv.is_used:
                status_str = 'Used'
            elif inv.expires_at and now_dt > inv.expires_at:
                status_str = 'Expired'

            data.append({
                'id': inv.id,
                'code': inv.code,
                'recipient_email': inv.recipient_email or '',
                'created_at': inv.created_at.isoformat() if inv.created_at else None,
                'expires_at': inv.expires_at.isoformat() if inv.expires_at else None,
                'is_used': inv.is_used,
                'used_by': f"{inv.used_by.first_name} {inv.used_by.last_name} ({inv.used_by.email})".strip() if inv.used_by else None,
                'used_at': inv.used_at.isoformat() if inv.used_at else None,
                'is_revoked': inv.is_revoked,
                'status': status_str,
                'notes': inv.notes or ''
            })
        return Response({'invitations': data})

    elif request.method == 'POST':
        recipient_email = (request.data.get('recipient_email') or '').strip().lower()
        days_valid = int(request.data.get('days_valid') or 7)
        notes = (request.data.get('notes') or '').strip()
        custom_code = (request.data.get('code') or '').strip().upper()

        if recipient_email and not is_valid_email(recipient_email):
            return Response({'error': 'Invalid recipient email format.'}, status=400)

        if custom_code:
            if Invitation.objects.filter(code__iexact=custom_code).exists():
                return Response({'error': 'An invitation with this code already exists.'}, status=400)
            code = custom_code
        else:
            code = f"KNOW-{secrets.token_hex(4).upper()}"
            while Invitation.objects.filter(code=code).exists():
                code = f"KNOW-{secrets.token_hex(4).upper()}"

        expires_at = datetime.now(timezone.utc) + timedelta(days=days_valid) if days_valid > 0 else None

        inv = Invitation.objects.create(
            code=code,
            created_by=request.user,
            recipient_email=recipient_email if recipient_email else None,
            expires_at=expires_at,
            notes=notes
        )

        storage.log_audit(
            action="CREATE_INVITATION",
            actor=request.user.email,
            details={
                "code": code,
                "recipient_email": recipient_email,
                "expires_at": expires_at.isoformat() if expires_at else None,
                "notes": notes
            }
        )

        return Response({
            'message': 'Invitation created successfully.',
            'invitation': {
                'id': inv.id,
                'code': inv.code,
                'recipient_email': inv.recipient_email or '',
                'expires_at': inv.expires_at.isoformat() if inv.expires_at else None,
                'status': 'Active',
                'notes': inv.notes
            }
        }, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def revoke_invitation_view(request, inv_id):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
    try:
        inv = Invitation.objects.get(id=inv_id)
    except Invitation.DoesNotExist:
        return Response({'error': 'Invitation not found.'}, status=404)

    inv.is_revoked = True
    inv.save()
    storage.log_audit(
        action="REVOKE_INVITATION",
        actor=request.user.email,
        details={"invitation_id": inv.id, "code": inv.code}
    )
    return Response({'message': f'Invitation {inv.code} revoked successfully.'})


# ==========================================
# ADMIN NOTIFICATIONS
# ==========================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_notifications_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
    notifications = Notification.objects.all().order_by('-created_at')[:40]
    data = [{
        'id': n.id,
        'title': n.title,
        'message': n.message,
        'notification_type': n.notification_type,
        'related_user_id': n.related_user_id,
        'created_at': n.created_at.isoformat(),
        'is_read': n.is_read
    } for n in notifications]
    unread_count = Notification.objects.filter(is_read=False).count()
    return Response({'notifications': data, 'unread_count': unread_count})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notifications_read_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
    notif_id = request.data.get('notification_id')
    if notif_id:
        Notification.objects.filter(id=notif_id).update(is_read=True)
    else:
        Notification.objects.filter(is_read=False).update(is_read=True)
    return Response({'message': 'Notifications marked as read.'})


# ==========================================
# ADMIN CORRECTIONS & AUDIT LOGS
# ==========================================

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_correction(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    event_id = request.data.get('event_id')
    new_event_type = request.data.get('new_event_type')
    new_timestamp = request.data.get('new_timestamp')
    reason = (request.data.get('reason') or '').strip()
    
    if not event_id:
        return Response({'error': 'Event ID is required.'}, status=400)
    if not reason:
        return Response({'error': 'A detailed reason for correction is strictly required for audit compliance.'}, status=400)

    try:
        storage.correct_event(
            event_id=event_id,
            new_event_type=new_event_type,
            new_timestamp=new_timestamp,
            admin_email=request.user.email,
            reason=reason
        )
        return Response({'message': 'Correction applied and audit logged successfully.'})
    except ValueError as e:
        return Response({'error': str(e)}, status=400)
    except Exception as e:
        return Response({'error': f'Failed to apply correction: {str(e)}'}, status=500)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def audit_logs_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    logs = storage.get_audit_logs()
    return Response({'audit_logs': logs})


# ==========================================
# REPORTS & EXPORTS (CSV / XLSX)
# ==========================================

def get_filtered_report_data(request):
    mode = request.GET.get('mode', '').strip().lower()
    start_date = request.GET.get('start_date', '').strip() or None
    end_date = request.GET.get('end_date', '').strip() or None
    month = request.GET.get('month', '').strip() or None
    year = request.GET.get('year', '').strip() or None
    employee_id = (request.GET.get('employee_id') or request.GET.get('user_id') or '').strip() or None
    department = request.GET.get('department', '').strip() or None
    filter_project = request.GET.get('project', '').strip() or None
    filter_task = request.GET.get('task', '').strip() or None
    filter_status = request.GET.get('status', '').strip() or None
    
    users = User.objects.filter(role='EMPLOYEE')
    if employee_id:
        if str(employee_id).isdigit():
            users = users.filter(models.Q(id=int(employee_id)) | models.Q(employee_id=employee_id))
        else:
            users = users.filter(employee_id=employee_id)
    if department:
        users = users.filter(department__icontains=department)
        
    all_events = storage.get_all_events()
    report_rows = []
    
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist_date = now_ist.date()
    
    # Gather dates:
    # In Date Range mode, use the selected start/end dates and ignore Specific Month parameters.
    # In Specific Month mode, ignore stale date-range values.
    if mode == 'month':
        try:
            m_val = int(month) if month else today_ist_date.month
            y_val = int(year) if year else today_ist_date.year
            num_days = calendar.monthrange(y_val, m_val)[1]
            d_start = date(y_val, m_val, 1)
            d_end = date(y_val, m_val, num_days)
        except (ValueError, TypeError):
            d_start = today_ist_date - timedelta(days=6)
            d_end = today_ist_date
    elif mode == 'range' or (start_date or end_date):
        if start_date and end_date:
            try:
                d_start = datetime.strptime(start_date, '%Y-%m-%d').date()
                d_end = datetime.strptime(end_date, '%Y-%m-%d').date()
                if d_start > d_end:
                    return {'error': 'Invalid date range: Start date cannot be after end date.'}, None, None, None
            except ValueError:
                return {'error': 'Invalid date format. Expected YYYY-MM-DD.'}, None, None, None
        elif start_date:
            try:
                d_start = datetime.strptime(start_date, '%Y-%m-%d').date()
                d_end = d_start
            except ValueError:
                d_start = today_ist_date - timedelta(days=6)
                d_end = today_ist_date
        elif end_date:
            try:
                d_end = datetime.strptime(end_date, '%Y-%m-%d').date()
                d_start = d_end
            except ValueError:
                d_start = today_ist_date - timedelta(days=6)
                d_end = today_ist_date
        else:
            d_start = today_ist_date - timedelta(days=6)
            d_end = today_ist_date
    elif month:
        try:
            m_val = int(month)
            y_val = int(year) if year else today_ist_date.year
            num_days = calendar.monthrange(y_val, m_val)[1]
            d_start = date(y_val, m_val, 1)
            d_end = date(y_val, m_val, num_days)
        except (ValueError, TypeError):
            d_start = today_ist_date - timedelta(days=6)
            d_end = today_ist_date
    else:
        d_start = today_ist_date - timedelta(days=6)
        d_end = today_ist_date

    # Pre-cache timesheet entries for users in date range in a single batch query
    entries_map = {}
    user_ids = [u.id for u in users]
    if user_ids and d_start and d_end:
        batch_entries = TimesheetEntry.objects.filter(
            user_id__in=user_ids,
            date__gte=d_start.isoformat(),
            date__lte=d_end.isoformat()
        )
        for entry in batch_entries:
            entries_map[(entry.user_id, entry.date)] = {
                'project_name': entry.project_name or '',
                'task_name': entry.task_name or '',
                'description': entry.work_description or '',
                'date': entry.date
            }

    # Iterate each day and each user
    curr = d_start
    while curr <= d_end:
        curr_str = curr.isoformat()
        for u in users:
            u_events = [
                e for e in all_events 
                if int(e.get('user_id', -1)) == u.id and parse_iso_utc(e['timestamp']) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == curr
            ]

            # Retrieve project, task, description
            saved_entry = entries_map.get((u.id, curr_str), {})
            proj_val = saved_entry.get('project_name', '')
            task_val = saved_entry.get('task_name', '')
            desc_val = saved_entry.get('description') or saved_entry.get('work_description', '')

            day_tasks = []
            if not proj_val and not task_val:
                day_tasks = storage.get_tasks_for_user_and_date(u.id, curr_str)
                if day_tasks:
                    proj_val = ", ".join(dict.fromkeys(t['project_name'] for t in day_tasks if t.get('project_name')))
                    task_val = ", ".join(dict.fromkeys(t['task_name'] for t in day_tasks if t.get('task_name')))
                    desc_val = "; ".join(t['description'] for t in day_tasks if t.get('description'))

            # Check if this employee genuinely has an attendance or task record on this day.
            # Do NOT create dummy attendance or count inactive employees as workday records,
            # unless a specific user_id query explicitly asks for continuous date range calendar rows.
            has_attendance = bool(u_events)
            has_tasks = bool(day_tasks) or bool(saved_entry.get('project_name') or saved_entry.get('task_name'))
            if not has_attendance and not has_tasks and not request.GET.get('user_id'):
                continue

            metrics = calculate_day_metrics(u_events, now_utc if curr == today_ist_date else None)

            # Optional status filter
            if filter_status and filter_status.lower() != metrics['status'].lower():
                continue

            # Format times to IST
            start_str = '-'
            if metrics['start_time']:
                start_str = parse_iso_utc(metrics['start_time']).astimezone(IST_TZ).strftime('%I:%M:%S %p')
                
            end_str = '-'
            if metrics['end_time']:
                end_str = parse_iso_utc(metrics['end_time']).astimezone(IST_TZ).strftime('%I:%M:%S %p')
                
            work_hours = round(metrics['total_work_seconds'] / 3600.0, 2)
            break_hours = round(metrics['total_break_seconds'] / 3600.0, 2)

            if filter_project and filter_project.lower() not in proj_val.lower():
                continue
            if filter_task and filter_task.lower() not in task_val.lower():
                continue

            report_rows.append({
                'date': curr_str,
                'user_id': u.id,
                'employee_id': u.employee_id or f"EMP{u.id:03d}",
                'employee_name': f"{u.first_name} {u.last_name}".strip() or u.username,
                'email': u.email or '',
                'department': u.department or 'Unassigned',
                'project': proj_val or '-',
                'task': task_val or '-',
                'description': desc_val or '-',
                'status': metrics['status'],
                'start_time': start_str,
                'end_time': end_str,
                'total_work_seconds': metrics['total_work_seconds'],
                'total_break_seconds': metrics['total_break_seconds'],
                'work_hours': work_hours,
                'work_duration': metrics['work_duration'],
                'break_hours': break_hours,
                'break_duration': metrics['break_duration'],
                'total_daily_seconds': metrics.get('total_daily_seconds', 0),
                'total_daily_duration': metrics.get('total_daily_duration', '00:00:00')
            })
        curr += timedelta(days=1)
        
    return report_rows, d_start, d_end, users


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def reports_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    result = get_filtered_report_data(request)
    if isinstance(result[0], dict) and 'error' in result[0]:
        return Response({'error': result[0]['error']}, status=400)
    data, d_start, d_end, users = result
    total_work_hours = round(sum(r['work_hours'] for r in data), 2)
    total_break_hours = round(sum(r['break_hours'] for r in data), 2)
    total_work_seconds = sum(r['total_work_seconds'] for r in data)
    total_break_seconds = sum(r['total_break_seconds'] for r in data)

    tw_h = total_work_seconds // 3600
    tw_m = (total_work_seconds % 3600) // 60
    tw_s = total_work_seconds % 60
    total_work_dur = f"{tw_h:02d}:{tw_m:02d}:{tw_s:02d}"

    tb_h = total_break_seconds // 3600
    tb_m = (total_break_seconds % 3600) // 60
    tb_s = total_break_seconds % 60
    total_break_dur = f"{tb_h:02d}:{tb_m:02d}:{tb_s:02d}"

    total_daily_seconds = sum(r.get('total_daily_seconds', 0) for r in data)
    td_h = total_daily_seconds // 3600
    td_m = (total_daily_seconds % 3600) // 60
    td_s = total_daily_seconds % 60
    total_daily_dur = f"{td_h:02d}:{td_m:02d}:{td_s:02d}"

    return Response({
        'reports': data,
        'summary': {
            'total_records': len(data),
            'total_work_hours': total_work_hours,
            'total_break_hours': total_break_hours,
            'total_work_seconds': total_work_seconds,
            'total_break_seconds': total_break_seconds,
            'total_daily_seconds': total_daily_seconds,
            'total_work_duration': total_work_dur,
            'total_break_duration': total_break_dur,
            'total_daily_duration': total_daily_dur
        }
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def export_reports_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    export_format = request.GET.get('format', 'csv').lower()
    result = get_filtered_report_data(request)
    if isinstance(result[0], dict) and 'error' in result[0]:
        return Response({'error': result[0]['error']}, status=400)
    data, d_start, d_end, users = result
    total_work_hours = round(sum(r['work_hours'] for r in data), 2)
    total_break_hours = round(sum(r['break_hours'] for r in data), 2)
    total_work_seconds = sum(r['total_work_seconds'] for r in data)
    total_break_seconds = sum(r['total_break_seconds'] for r in data)

    tw_h = total_work_seconds // 3600
    tw_m = (total_work_seconds % 3600) // 60
    tw_s = total_work_seconds % 60
    total_work_dur = f"{tw_h:02d}:{tw_m:02d}:{tw_s:02d}"

    tb_h = total_break_seconds // 3600
    tb_m = (total_break_seconds % 3600) // 60
    tb_s = total_break_seconds % 60
    total_break_dur = f"{tb_h:02d}:{tb_m:02d}:{tb_s:02d}"
    
    total_daily_seconds_sum = sum(r.get('total_daily_seconds', 0) for r in data)
    td_h = total_daily_seconds_sum // 3600
    td_m = (total_daily_seconds_sum % 3600) // 60
    td_s = total_daily_seconds_sum % 60
    total_daily_dur = f"{td_h:02d}:{td_m:02d}:{td_s:02d}"
    
    # Audit export
    storage.log_audit(
        action="EXPORT_REPORT",
        actor=request.user.email,
        details={"format": export_format, "rows_count": len(data), "total_work_hours": total_work_hours}
    )

    # Determine filename
    start_str = d_start.strftime('%Y-%m-%d')
    end_str = d_end.strftime('%Y-%m-%d')
    date_range_str = f"{start_str}_to_{end_str}"
    
    employee_id_param = request.GET.get('employee_id')
    if employee_id_param and users.exists():
        emp_obj = users.first()
        raw_name = f"{emp_obj.first_name} {emp_obj.last_name}".strip() or emp_obj.username
        emp_name = re.sub(r'[^A-Za-z0-9]+', '_', raw_name).strip('_') or 'Employee'
    elif users.count() == 1:
        emp_obj = users.first()
        raw_name = f"{emp_obj.first_name} {emp_obj.last_name}".strip() or emp_obj.username
        emp_name = re.sub(r'[^A-Za-z0-9]+', '_', raw_name).strip('_') or 'Employee'
    else:
        emp_name = "All_Employees"

    filename = f"{emp_name}_Time_Report_{date_range_str}"

    headers = [
        'Date (IST)', 'Employee ID', 'Employee Name', 'Email', 
        'Department', 'Project', 'Task Name', 'Work Description', 'Status', 
        'Clock-In (IST)', 'Clock-Out (IST)', 
        'Work Duration', 'Break Duration', 'Total Daily Time'
    ]

    if export_format == 'csv':
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename}.csv"'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition, X-Suggested-Filename'
        response['X-Suggested-Filename'] = f"{filename}.csv"
        
        writer = csv.writer(response)
        writer.writerow(['KNOWLETIVE EMPLOYEE ATTENDANCE & TIME REPORT'])
        writer.writerow([
            'Total Records:', len(data), 
            'Total Work Duration:', total_work_dur, 
            'Total Break Duration:', total_break_dur
        ])
        writer.writerow([])
        writer.writerow(headers)
        for r in data:
            writer.writerow([
                r['date'], r['employee_id'], r['employee_name'], r['email'],
                r['department'], r['project'], r['task'], r['description'], r['status'], 
                r['start_time'], r['end_time'],
                r['work_duration'], r['break_duration'], r['total_daily_duration']
            ])
        writer.writerow([])
        writer.writerow([
            'TOTALS', '', '', '', '', '', '', '', '', '', '',
            total_work_dur, 
            total_break_dur, 
            total_daily_dur
        ])
        return response

    elif export_format in ['xlsx', 'excel']:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Time Report"
        
        title_font = Font(name="Arial", size=14, bold=True, color="1E3A8A")
        ws.append(['KNOWLETIVE EMPLOYEE ATTENDANCE & TIME REPORT'])
        ws['A1'].font = title_font
        ws.append([
            f"Total Records: {len(data)}", 
            f"Total Work Duration: {total_work_dur}", 
            f"Total Break Duration: {total_break_dur}"
        ])
        ws.append([])

        ws.append(headers)
        
        # Style headers
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
        for cell in ws[4]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            
        for r in data:
            ws.append([
                r['date'], r['employee_id'], r['employee_name'], r['email'],
                r['department'], r['project'], r['task'], r['description'], r['status'], 
                r['start_time'], r['end_time'],
                r['work_duration'], r['break_duration'], r['total_daily_duration']
            ])

        # Totals row (use numeric values for Excel formatting)
        total_row = [
            'TOTALS', '', '', '', '', '', '', '', '', '', '',
            total_work_seconds / 86400.0, 
            total_break_seconds / 86400.0, 
            total_daily_seconds_sum / 86400.0
        ]
        ws.append(total_row)
        total_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
        total_font = Font(name="Arial", size=10, bold=True, color="0F172A")
        for i, cell in enumerate(ws[ws.max_row], start=1):
            cell.fill = total_fill
            cell.font = total_font
            if i in [12, 13, 14]:
                cell.number_format = '[h]:mm:ss'
            
        # Adjust column widths
        for col in ws.columns:
            max_len = 0
            for cell in col:
                val = str(cell.value or '')
                if len(val) > max_len:
                    max_len = len(val)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(min(max_len + 3, 40), 12)
            
        stream = io.BytesIO()
        wb.save(stream)
        stream.seek(0)
        
        response = HttpResponse(
            stream.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}.xlsx"'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition, X-Suggested-Filename'
        response['X-Suggested-Filename'] = f"{filename}.xlsx"
        return response

    return Response({'error': 'Invalid format. Use csv or xlsx.'}, status=400)


# ==========================================
# SETTINGS
# ==========================================

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def settings_view(request):
    if request.method == 'GET':
        return Response(storage.get_settings())
        
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)
        
    start_time = request.data.get('work_start_time')
    end_time = request.data.get('work_end_time')
    tz = request.data.get('timezone', 'Asia/Kolkata')
    
    updates = {}
    if start_time:
        updates['work_start_time'] = start_time
    if end_time:
        updates['work_end_time'] = end_time
    if tz:
        updates['timezone'] = tz
        
    storage.update_settings(updates, admin_email=request.user.email)
    return Response({'message': 'Settings updated successfully.', 'settings': storage.get_settings()})


# ==========================================
# MONTHLY TIMESHEET (EMPLOYEE & ADMIN)
# ==========================================

def get_monthly_timesheet_data(target_user, year, month, filter_project=None, filter_task=None):
    num_days = calendar.monthrange(year, month)[1]
    
    all_events = storage.get_events_for_user(target_user.id)
    timesheet_entries = storage.get_timesheet_entries_for_month(target_user.id, year, month)
    entries_by_date = {e['date']: e for e in timesheet_entries}
    
    settings = storage.get_settings()
    work_start_h, work_start_m = map(int, settings.get('work_start_time', '10:00').split(':'))
    work_end_h, work_end_m = map(int, settings.get('work_end_time', '19:00').split(':'))

    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist_date = now_ist.date()

    days_data = []
    total_work_seconds = 0
    total_break_seconds = 0
    days_worked_count = 0
    late_starts_count = 0
    missing_clockouts_count = 0

    sr_no = 1
    for day_num in range(1, num_days + 1):
        day_date = date(year, month, day_num)
        date_str = day_date.isoformat()
        day_of_week = day_date.strftime('%A')
        date_formatted = day_date.strftime('%d-%b-%Y')
        is_weekend = day_date.weekday() >= 5

        # Filter events for this day
        day_events = [
            e for e in all_events
            if parse_iso_utc(e['timestamp']) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == day_date
        ]

        metrics = calculate_day_metrics(day_events, now_utc if day_date == today_ist_date else None)
        
        # Timesheet manual entry
        saved_entry = entries_by_date.get(date_str, {})
        project_name = saved_entry.get('project_name', '')
        task_name = saved_entry.get('task_name', '')
        work_description = saved_entry.get('work_description', '')

        # Filter check if searching by project or task
        if filter_project and filter_project.lower() not in project_name.lower():
            continue
        if filter_task and filter_task.lower() not in task_name.lower():
            continue

        # Determine status
        is_late = False
        is_missing = False

        if day_events:
            start_dt = parse_iso_utc(metrics['start_time']).astimezone(IST_TZ)
            office_start_dt = start_dt.replace(hour=work_start_h, minute=work_start_m, second=0, microsecond=0)
            if start_dt > office_start_dt + timedelta(minutes=5):
                is_late = True
                late_starts_count += 1

            if metrics['end_time']:
                day_status = 'Completed'
                days_worked_count += 1
            else:
                if day_date == today_ist_date:
                    day_status = 'In Progress'
                    days_worked_count += 1
                else:
                    day_status = 'Missing Clock-out'
                    is_missing = True
                    missing_clockouts_count += 1
                    days_worked_count += 1
        else:
            if is_weekend:
                day_status = 'Weekend'
            elif day_date > today_ist_date:
                day_status = 'Upcoming'
            else:
                day_status = 'No Record'

        total_work_seconds += metrics['total_work_seconds']
        total_break_seconds += metrics['total_break_seconds']

        start_time_str = '-'
        if metrics['start_time']:
            start_time_str = parse_iso_utc(metrics['start_time']).astimezone(IST_TZ).strftime('%I:%M:%S %p')

        end_time_str = '-'
        if metrics['end_time']:
            end_time_str = parse_iso_utc(metrics['end_time']).astimezone(IST_TZ).strftime('%I:%M:%S %p')

        work_hours = round(metrics['total_work_seconds'] / 3600.0, 2)
        break_hours = round(metrics['total_break_seconds'] / 3600.0, 2)
        
        # Formatted duration string hh:mm:ss
        b_h = metrics['total_break_seconds'] // 3600
        b_m = (metrics['total_break_seconds'] % 3600) // 60
        b_s = metrics['total_break_seconds'] % 60
        break_duration_str = f"{b_h:02d}:{b_m:02d}:{b_s:02d}"

        w_h = metrics['total_work_seconds'] // 3600
        w_m = (metrics['total_work_seconds'] % 3600) // 60
        w_s = metrics['total_work_seconds'] % 60
        work_duration_str = f"{w_h:02d}:{w_m:02d}:{w_s:02d}"

        total_day_seconds = 0
        now_utc = datetime.now(timezone.utc)
        if metrics['start_time']:
            s_dt = parse_iso_utc(metrics['start_time'])
            if metrics['end_time']:
                e_dt = parse_iso_utc(metrics['end_time'])
                total_day_seconds = max(0, int((e_dt - s_dt).total_seconds()))
            elif day_status != 'Not Started':
                total_day_seconds = max(0, int((now_utc - s_dt).total_seconds()))

        required_seconds = 32400  # 9 hours
        is_completed = total_day_seconds >= required_seconds
        completion_status = 'Completed' if is_completed else 'Not Completed'
        diff_sec = max(0, required_seconds - total_day_seconds) if not is_completed else max(0, total_day_seconds - required_seconds)

        td_h = total_day_seconds // 3600
        td_m = (total_day_seconds % 3600) // 60
        td_s = total_day_seconds % 60
        total_day_duration_str = f"{td_h:02d}:{td_m:02d}:{td_s:02d}"

        req_h = required_seconds // 3600
        required_hours_str = f"{req_h:02d}:00:00"

        diff_h = diff_sec // 3600
        diff_m = (diff_sec % 3600) // 60
        diff_s = diff_sec % 60
        diff_str = f"{diff_h:02d}:{diff_m:02d}:{diff_s:02d}"

        days_data.append({
            'sr_no': sr_no,
            'date': date_str,
            'date_formatted': date_formatted,
            'day_of_week': day_of_week,
            'start_time': start_time_str,
            'end_time': end_time_str,
            'start_time_iso': metrics['start_time'],
            'end_time_iso': metrics['end_time'],
            'total_day_seconds': total_day_seconds,
            'total_day_duration_str': total_day_duration_str,
            'total_work_seconds': metrics['total_work_seconds'],
            'work_hours': work_hours,
            'work_duration_str': work_duration_str,
            'total_break_seconds': metrics['total_break_seconds'],
            'break_hours': break_hours,
            'break_duration_str': break_duration_str,
            'required_hours_str': required_hours_str,
            'completion_status': completion_status,
            'diff_duration_str': diff_str,
            'project_name': project_name,
            'task_name': task_name,
            'work_description': work_description,
            'status': day_status,
            'is_late_start': is_late,
            'is_missing_clockout': is_missing,
            'is_weekend': is_weekend,
            'updated_at': saved_entry.get('updated_at', '')
        })
        sr_no += 1

    summary = {
        'total_working_hours': round(total_work_seconds / 3600.0, 2),
        'total_break_hours': round(total_break_seconds / 3600.0, 2),
        'total_work_seconds': total_work_seconds,
        'total_break_seconds': total_break_seconds,
        'days_worked': days_worked_count,
        'late_starts': late_starts_count,
        'missing_clockouts': missing_clockouts_count
    }

    return {
        'employee': {
            'id': target_user.id,
            'employee_id': target_user.employee_id or f"EMP{target_user.id:03d}",
            'name': f"{target_user.first_name} {target_user.last_name}".strip() or target_user.username,
            'email': target_user.email,
            'department': target_user.department or 'Unassigned',
            'role': target_user.role
        },
        'year': year,
        'month': month,
        'month_name': calendar.month_name[month],
        'days': days_data,
        'summary': summary
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def monthly_timesheet_view(request):
    now_ist = datetime.now(timezone.utc).astimezone(IST_TZ)
    try:
        year = int(request.GET.get('year', now_ist.year))
        month = int(request.GET.get('month', now_ist.month))
    except (ValueError, TypeError):
        year = now_ist.year
        month = now_ist.month

    if month < 1 or month > 12:
        return Response({'error': 'Month must be between 1 and 12.'}, status=400)

    requested_user_id = request.GET.get('user_id')
    
    # Permission verification: Employee cannot view other users' timesheets
    if request.user.role != 'ADMIN':
        if requested_user_id and int(requested_user_id) != request.user.id:
            return Response({'error': 'Access denied. Employees can view only their own timesheets.'}, status=403)
        target_user = request.user
    else:
        if requested_user_id:
            try:
                target_user = User.objects.get(id=int(requested_user_id), role='EMPLOYEE')
            except User.DoesNotExist:
                return Response({'error': 'Employee not found.'}, status=404)
        else:
            first_emp = User.objects.filter(role='EMPLOYEE', is_active=True).first()
            if not first_emp:
                first_emp = User.objects.filter(role='EMPLOYEE').first()
            if first_emp:
                target_user = first_emp
            else:
                return Response({'error': 'No employees found in the system.'}, status=404)

    filter_project = request.GET.get('project')
    filter_task = request.GET.get('task')

    data = get_monthly_timesheet_data(target_user, year, month, filter_project, filter_task)
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_timesheet_entry_view(request):
    work_date = request.data.get('date')
    project_name = (request.data.get('project_name') or '').strip()
    task_name = (request.data.get('task_name') or '').strip()
    work_description = (request.data.get('work_description') or '').strip()
    
    if not work_date:
        return Response({'error': 'Date is required (YYYY-MM-DD).'}, status=400)

    try:
        datetime.strptime(work_date, '%Y-%m-%d')
    except ValueError:
        return Response({'error': 'Invalid date format. Expected YYYY-MM-DD.'}, status=400)

    requested_user_id = request.data.get('user_id')

    # Permission check: Employee can edit only their own timesheet entries
    if request.user.role != 'ADMIN':
        if requested_user_id and int(requested_user_id) != request.user.id:
            return Response({'error': 'Access denied. Employees can only update their own timesheet entries.'}, status=403)
        target_user_id = request.user.id
    else:
        if requested_user_id:
            if not User.objects.filter(id=int(requested_user_id), role='EMPLOYEE').exists():
                return Response({'error': 'Target user is not an employee.'}, status=400)
            target_user_id = int(requested_user_id)
        else:
            first_emp = User.objects.filter(role='EMPLOYEE').first()
            if not first_emp:
                return Response({'error': 'No employee found to save timesheet entry.'}, status=400)
            target_user_id = first_emp.id

    entry = storage.save_timesheet_entry(
        user_id=target_user_id,
        work_date=work_date,
        project_name=project_name,
        task_name=task_name,
        work_description=work_description,
        updated_by=request.user.email
    )
    return Response({'message': 'Timesheet entry saved successfully.', 'entry': entry})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def export_timesheet_view(request):
    now_ist = datetime.now(timezone.utc).astimezone(IST_TZ)
    try:
        year = int(request.GET.get('year', now_ist.year))
        month = int(request.GET.get('month', now_ist.month))
    except (ValueError, TypeError):
        year = now_ist.year
        month = now_ist.month

    requested_user_id = request.GET.get('user_id')
    if request.user.role != 'ADMIN':
        if requested_user_id and int(requested_user_id) != request.user.id:
            return Response({'error': 'Access denied. Employees can only export their own timesheets.'}, status=403)
        target_user = request.user
    else:
        if requested_user_id:
            try:
                target_user = User.objects.get(id=int(requested_user_id), role='EMPLOYEE')
            except User.DoesNotExist:
                return Response({'error': 'Employee not found.'}, status=404)
        else:
            first_emp = User.objects.filter(role='EMPLOYEE', is_active=True).first()
            if not first_emp:
                first_emp = User.objects.filter(role='EMPLOYEE').first()
            if first_emp:
                target_user = first_emp
            else:
                return Response({'error': 'No employees found in the system.'}, status=404)

    filter_project = request.GET.get('project')
    filter_task = request.GET.get('task')
    export_format = request.GET.get('format', 'csv').lower()

    data = get_monthly_timesheet_data(target_user, year, month, filter_project, filter_task)
    emp = data['employee']
    summary = data['summary']
    days = data['days']

    storage.log_audit(
        action="EXPORT_TIMESHEET",
        actor=request.user.email,
        details={"target_user_id": emp['id'], "year": year, "month": month, "format": export_format}
    )

    filename_prefix = f"timesheet_{emp['name'].replace(' ', '_')}_{year}_{month:02d}"

    if export_format == 'csv':
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename_prefix}.csv"'
        
        writer = csv.writer(response)
        # Summary Header (based on Reference Image 2)
        writer.writerow(['KNOWLETIVE MONTHLY EMPLOYEE TIMESHEET'])
        writer.writerow(['Employee ID:', emp.get('employee_id', ''), 'Employee:', emp['name'], 'Email:', emp['email'], 'Department:', emp['department']])
        writer.writerow(['Month & Year:', f"{data['month_name']} {year}"])
        writer.writerow(['Total Working Hrs:', f"{summary['total_working_hours']} hrs", 'Total Break Time:', f"{summary['total_break_hours']} hrs", 'Days Worked:', summary['days_worked']])
        writer.writerow([]) # blank line

        # Table Header (based on Reference Image 1)
        writer.writerow([
            'Sr. No.', 'Date (IST)', 'Day', 'Project', 'Task Name', 'Description', 
            'Clock In', 'Clock Out', 'Total Day Time', 'Actual Work Time', 'Break Time',
            'Required Hours', 'Completed Hours Status', 'Shortfall / Extra Time', 'Status'
        ])
        for r in days:
            writer.writerow([
                r['sr_no'], r['date_formatted'], r['day_of_week'], r['project_name'], 
                r['task_name'], r['work_description'], r['start_time'], r['end_time'],
                r['total_day_duration_str'], r['work_duration_str'], r['break_duration_str'],
                r['required_hours_str'], r['completion_status'], r['diff_duration_str'], r['status']
            ])
        return response

    elif export_format in ['xlsx', 'excel']:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"{data['month_name'][:3]} {year} Timesheet"

        # Summary Block (Reference Image 2 styling)
        title_font = Font(name="Arial", size=14, bold=True, color="1E3A8A")
        ws.append(['KNOWLETIVE MONTHLY EMPLOYEE TIMESHEET'])
        ws['A1'].font = title_font

        ws.append([f"Employee ID: {emp.get('employee_id', '')}", f"Employee: {emp['name']}", f"Email: {emp['email']}", f"Department: {emp['department']}"])
        ws.append([f"Period: {data['month_name']} {year}"])
        ws.append([])

        summary_header = ['Total Break Time', 'Total Working Hrs.', 'Productive Days']
        summary_values = [f"{summary['total_break_hours']} hrs", f"{summary['total_working_hours']} hrs", f"{summary['days_worked']} days"]
        
        ws.append(summary_header)
        ws.append(summary_values)
        
        # Color summary cards
        header_fill_pink = PatternFill(start_color="FCE7F3", end_color="FCE7F3", fill_type="solid")
        for col_idx in range(1, 4):
            cell = ws.cell(row=5, column=col_idx)
            cell.fill = header_fill_pink
            cell.font = Font(name="Arial", size=10, bold=True, color="9D174D")
            cell.alignment = Alignment(horizontal="center")
            
            val_cell = ws.cell(row=6, column=col_idx)
            val_cell.font = Font(name="Arial", size=12, bold=True, color="111827")
            val_cell.alignment = Alignment(horizontal="center")

        ws.append([])

        # Table Header (Reference Image 1 pink/dark table header)
        table_headers = [
            'Sr. No.', 'Project', 'Task Name', 'Description', 'Clock In', 'Clock Out', 
            'Total Day Time', 'Actual Work Time', 'Break Time', 'Required Hours', 'Completed Hours Status', 'Shortfall / Extra Time', 'Status'
        ]
        ws.append(table_headers)
        
        table_header_fill = PatternFill(start_color="FBCFE8", end_color="FBCFE8", fill_type="solid")
        for cell in ws[8]:
            cell.fill = table_header_fill
            cell.font = Font(name="Arial", size=11, bold=True, color="831843")
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for r in days:
            ws.append([
                r['sr_no'],
                r['project_name'] or '-',
                r['task_name'] or '-',
                r['work_description'] or '-',
                f"{r['date_formatted']} {r['start_time']}" if r['start_time'] != '-' else '-',
                f"{r['date_formatted']} {r['end_time']}" if r['end_time'] != '-' else '-',
                r['total_day_duration_str'],
                r['work_duration_str'],
                r['break_duration_str'],
                r['required_hours_str'],
                r['completion_status'],
                r['diff_duration_str'],
                r['status']
            ])

        # Formatting widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        stream = io.BytesIO()
        wb.save(stream)
        stream.seek(0)

        response = HttpResponse(
            stream.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = f'attachment; filename="{filename_prefix}.xlsx"'
        return response

    return Response({'error': 'Invalid format. Use csv or xlsx.'}, status=400)


# ==========================================
# TIME-WISE TASK & PROJECT LOGS
# ==========================================

def format_task_seconds(sec):
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    
    if h > 0:
        if m > 0 and s > 0:
            return f"{h} hr {m} min {s} sec"
        elif m > 0:
            return f"{h} hr {m} min"
        elif s > 0:
            return f"{h} hr {s} sec"
        else:
            return f"{h} hr"
    elif m > 0:
        if s > 0:
            return f"{m} min {s} sec"
        else:
            return f"{m} min"
    else:
        return f"{s} sec"


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def daily_tasks_view(request):
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    target_date = request.GET.get('date', now_ist.date().isoformat())

    requested_user_id = request.GET.get('user_id')
    if request.user.role != 'ADMIN':
        if requested_user_id and int(requested_user_id) != request.user.id:
            return Response({'error': 'Access denied. You can only view your own task log.'}, status=403)
        target_user = request.user
    else:
        if requested_user_id:
            try:
                target_user = User.objects.get(id=int(requested_user_id), role='EMPLOYEE')
            except User.DoesNotExist:
                return Response({'error': 'Employee not found.'}, status=404)
        else:
            first_emp = User.objects.filter(role='EMPLOYEE', is_active=True).first()
            if not first_emp:
                first_emp = User.objects.filter(role='EMPLOYEE').first()
            if first_emp:
                target_user = first_emp
            else:
                return Response({'error': 'No employees found in the system.'}, status=404)

    filter_project = request.GET.get('project')
    raw_tasks = storage.get_tasks_for_user_and_date(target_user.id, target_date)
    if filter_project and filter_project.strip():
        raw_tasks = [t for t in raw_tasks if (t.get('project_name') or '').strip().lower() == filter_project.strip().lower()]

    processed_tasks = []
    total_task_seconds = 0
    project_totals = {}
    active_task = None

    for idx, t in enumerate(raw_tasks, start=1):
        start_dt = parse_iso_utc(t['start_time'])
        end_dt = parse_iso_utc(t['end_time']) if t['end_time'] else None

        dur_sec = storage.calculate_task_duration(t, now_utc)
        total_task_seconds += dur_sec

        proj = t['project_name'] or 'Unassigned'
        if proj not in project_totals:
            project_totals[proj] = {'total_seconds': 0, 'count': 0}
        project_totals[proj]['total_seconds'] += dur_sec
        project_totals[proj]['count'] += 1

        start_time_ist = start_dt.astimezone(IST_TZ).strftime('%I:%M:%S %p') if start_dt else '-'
        end_time_ist = end_dt.astimezone(IST_TZ).strftime('%I:%M:%S %p') if end_dt else ('Paused (Break)' if t.get('status') == 'PAUSED' else 'In progress')

        task_item = {
            'sr_no': idx,
            'task_log_id': t['task_log_id'],
            'employee_id': t.get('employee_id') or target_user.employee_id or f"EMP{target_user.id:03d}",
            'employee_name': t.get('employee_name') or f"{target_user.first_name} {target_user.last_name}".strip() or target_user.username,
            'project_name': t['project_name'],
            'task_name': t['task_name'],
            'description': t['description'],
            'start_time': t['start_time'],
            'end_time': t['end_time'],
            'start_time_formatted': start_time_ist,
            'end_time_formatted': end_time_ist,
            'duration_seconds': dur_sec,
            'duration_seconds_base': int(t.get('duration_seconds') or 0),
            'current_segment_start': t.get('current_segment_start'),
            'work_segments': t.get('work_segments', []),
            'duration_hours': round(dur_sec / 3600.0, 2),
            'duration_formatted': format_task_seconds(dur_sec),
            'status': t['status']
        }
        processed_tasks.append(task_item)

        if t['status'] in ['IN_PROGRESS', 'PAUSED']:
            active_task = task_item

    project_breakdown = [
        {
            'project_name': p_name,
            'total_seconds': data['total_seconds'],
            'total_hours': round(data['total_seconds'] / 3600.0, 2),
            'duration_formatted': format_task_seconds(data['total_seconds']),
            'count': data['count']
        }
        for p_name, data in sorted(project_totals.items(), key=lambda x: x[1]['total_seconds'], reverse=True)
    ]

    active_count = sum(1 for t in processed_tasks if t['status'] == 'IN_PROGRESS')
    completed_count = sum(1 for t in processed_tasks if t['status'] != 'IN_PROGRESS')
    emp_code = target_user.employee_id or f"EMP{target_user.id:03d}"
    emp_name = f"{target_user.first_name} {target_user.last_name}".strip() or target_user.username

    summary = {
        'total_tasks': len(processed_tasks),
        'active_in_progress': active_count,
        'completed': completed_count,
        'total_seconds': total_task_seconds,
        'total_hours': round(total_task_seconds / 3600.0, 2)
    }

    by_employee = [{
        'user_id': target_user.id,
        'employee_id': emp_code,
        'employee_name': emp_name,
        'email': target_user.email,
        'department': target_user.department or 'General',
        'total_seconds': total_task_seconds,
        'total_hours': round(total_task_seconds / 3600.0, 2),
        'duration_formatted': format_task_seconds(total_task_seconds),
        'tasks_count': len(processed_tasks)
    }] if processed_tasks else []

    by_project_and_employee = [
        {
            'project_name': p['project_name'],
            'employee_name': emp_name,
            'total_seconds': p['total_seconds'],
            'total_hours': p['total_hours'],
            'duration_formatted': p['duration_formatted'],
            'tasks_count': p['count']
        }
        for p in project_breakdown
    ]

    return Response({
        'date': target_date,
        'employee': {
            'id': target_user.id,
            'employee_id': emp_code,
            'name': emp_name,
            'email': target_user.email,
            'department': target_user.department
        },
        'tasks': processed_tasks,
        'active_task': active_task,
        'total_task_seconds': total_task_seconds,
        'total_task_hours': round(total_task_seconds / 3600.0, 2),
        'total_task_formatted': format_task_seconds(total_task_seconds),
        'project_breakdown': project_breakdown,
        'summary': summary,
        'by_employee': by_employee,
        'by_project_and_employee': by_project_and_employee
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def start_task_view(request):
    if request.user.role != 'EMPLOYEE':
        return Response({'error': 'Only employee accounts can log tasks.'}, status=403)

    project_name = (request.data.get('project_name') or '').strip()
    task_name = (request.data.get('task_name') or '').strip()
    description = (request.data.get('description') or '').strip()

    if not project_name:
        return Response({'error': 'Project name is required to start a task.'}, status=400)
    if not task_name:
        return Response({'error': 'Task name is required to start a task.'}, status=400)

    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist_date = now_ist.date()

    events = storage.get_events_for_user(request.user.id)
    today_events = [
        e for e in events 
        if parse_iso_utc(e['timestamp']) and parse_iso_utc(e['timestamp']).astimezone(IST_TZ).date() == today_ist_date
    ]
    today_events.sort(key=lambda x: x['timestamp'])

    metrics = calculate_day_metrics(today_events, now_utc)
    current_status = metrics['status']

    if current_status == 'Ended':
        return Response({'error': 'Workday has already ended for today. Contact admin for corrections.'}, status=400)

    # CASE 4: USER ADDS / STARTS A NEW TASK DURING BREAK
    # If employee is currently on BREAK and adds/starts a new task:
    # 1. Close current break session -> automatically record RESUME_WORK
    # 2. Transition state to WORKING
    # 3. New task timer starts, break timer stops
    if current_status == 'On Break':
        storage.record_event(request.user.id, 'RESUME_WORK', source='web')
    elif current_status == 'Not Started':
        storage.record_event(request.user.id, 'START_WORK', source='web')

    # Attach permanent Employee ID and saved employee name from authenticated profile
    emp_id = getattr(request.user, 'employee_id', '') or f"EMP{request.user.id:03d}"
    emp_name = f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username

    try:
        new_task = storage.start_task(
            user_id=request.user.id,
            project_name=project_name,
            task_name=task_name,
            description=description,
            user_email=request.user.email,
            employee_id=emp_id,
            employee_name=emp_name,
            project_task_id=request.data.get('project_task_id')
        )
        return Response({'message': 'Task started successfully.', 'task': new_task}, status=201)
    except ValueError as e:
        return Response({'error': str(e)}, status=400)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def end_task_view(request):
    if request.user.role != 'EMPLOYEE':
        return Response({'error': 'Only employee accounts can log tasks.'}, status=403)

    task_log_id = request.data.get('task_log_id')
    is_completed = bool(request.data.get('is_completed', False))
    try:
        ended_task = storage.end_task(
            user_id=request.user.id,
            task_log_id=task_log_id,
            user_email=request.user.email,
            is_explicit_completed=is_completed
        )
        return Response({'message': 'Task ended successfully.', 'task': ended_task})
    except ValueError as e:
        return Response({'error': str(e)}, status=400)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_task_view(request, task_log_id):
    if request.user.role != 'EMPLOYEE':
        return Response({'error': 'Only employee accounts can update tasks.'}, status=403)

    project_name = request.data.get('project_name')
    task_name = request.data.get('task_name')
    description = request.data.get('description')

    try:
        updated = storage.update_task_details(
            user_id=request.user.id,
            task_log_id=str(task_log_id),
            project_name=project_name,
            task_name=task_name,
            description=description,
            user_email=request.user.email
        )
        return Response({'message': 'Task details updated.', 'task': updated})
    except ValueError as e:
        return Response({'error': str(e)}, status=400)


def get_tasks_earliest_starts_map():
    """
    Returns a dictionary mapping stable task IDs (project_task_id or task_id)
    to the earliest recorded start datetime (UTC) across all TaskLog, ProjectTask,
    and WorkSession records.
    """
    earliest_starts = {}
    for tl in TaskLog.objects.all().only('task_id', 'project_task_id', 'start_time'):
        tid = tl.project_task_id or tl.task_id
        if tl.start_time:
            s_dt = safe_parse_utc(tl.start_time)
            if s_dt and (tid not in earliest_starts or s_dt < earliest_starts[tid]):
                earliest_starts[tid] = s_dt

    for pt in ProjectTask.objects.all().only('task_id', 'first_started_at'):
        if pt.first_started_at:
            tid = pt.task_id
            if tid not in earliest_starts or pt.first_started_at < earliest_starts[tid]:
                earliest_starts[tid] = pt.first_started_at

    return earliest_starts


def get_admin_task_report_data(request):
    now_ist = datetime.now(timezone.utc).astimezone(IST_TZ)
    target_date = request.GET.get('date', '').strip() or now_ist.date().isoformat()
    employee_id = request.GET.get('employee_id', '').strip() or None
    project = request.GET.get('project', '').strip() or None

    try:
        target_date_obj = datetime.strptime(target_date, "%Y-%m-%d").date()
    except Exception:
        target_date_obj = now_ist.date()

    employee_users = User.objects.filter(role='EMPLOYEE')
    employee_ids = set(employee_users.values_list('id', flat=True))
    users_map = {u.id: u for u in employee_users}

    target_uid = None
    if employee_id:
        matched_users = employee_users
        if str(employee_id).isdigit():
            matched_users = matched_users.filter(models.Q(id=int(employee_id)) | models.Q(employee_id=employee_id))
        else:
            matched_users = matched_users.filter(employee_id=employee_id)
        matched_emp = matched_users.first()
        target_uid = matched_emp.id if matched_emp else None
        if not target_uid:
            all_tasks = []
        else:
            all_tasks = storage.get_all_tasks_for_date(
                date_str=target_date,
                filter_user_id=target_uid,
                filter_project=project
            )
            all_tasks = [t for t in all_tasks if t.get('user_id') in employee_ids]
    else:
        all_tasks = storage.get_all_tasks_for_date(
            date_str=target_date,
            filter_user_id=None,
            filter_project=project
        )
        all_tasks = [t for t in all_tasks if t.get('user_id') in employee_ids]

    now_utc = datetime.now(timezone.utc)
    earliest_starts = get_tasks_earliest_starts_map()

    task_rows = []
    emp_aggregates = {}
    proj_emp_aggregates = {}

    distinct_tasks = {}

    for idx, t in enumerate(all_tasks, start=1):
        u = users_map.get(t['user_id'])
        emp_code = u.employee_id if (u and u.employee_id) else (t.get('employee_id') or (f"EMP{u.id:03d}" if u else f"EMP{t['user_id']:03d}"))
        emp_name = f"{u.first_name} {u.last_name}".strip() if u else (t.get('employee_name') or f"User {t['user_id']}")
        emp_email = u.email if u else '-'
        emp_dept = u.department if u else '-'

        dur_sec = storage.calculate_task_duration(t, now_utc)
        start_dt = parse_iso_utc(t.get('start_time'))
        end_dt = parse_iso_utc(t.get('end_time')) if t.get('end_time') else None

        stable_id = t.get('project_task_id') or t.get('task_log_id') or t.get('task_id')
        first_s = earliest_starts.get(stable_id)
        is_just_started = bool(first_s and first_s.astimezone(IST_TZ).date() == target_date_obj)
        is_completed = bool(t.get('status') == 'COMPLETED' or t.get('is_explicit_completed'))
        is_in_progress = not is_completed

        if stable_id not in distinct_tasks:
            distinct_tasks[stable_id] = {
                'stable_id': stable_id,
                'is_completed': is_completed,
                'is_in_progress': is_in_progress,
                'is_just_started': is_just_started,
            }
        else:
            if is_completed:
                distinct_tasks[stable_id]['is_completed'] = True
                distinct_tasks[stable_id]['is_in_progress'] = False
            if is_just_started:
                distinct_tasks[stable_id]['is_just_started'] = True

        # Group by employee
        if t['user_id'] not in emp_aggregates:
            emp_aggregates[t['user_id']] = {
                'user_id': t['user_id'],
                'employee_id': emp_code,
                'employee_name': emp_name,
                'email': emp_email,
                'department': emp_dept,
                'total_seconds': 0,
                'tasks_count': 0
            }
        emp_aggregates[t['user_id']]['total_seconds'] += dur_sec
        emp_aggregates[t['user_id']]['tasks_count'] += 1

        # Group by project & employee
        proj_key = f"{t['project_name']}::{emp_name}"
        if proj_key not in proj_emp_aggregates:
            proj_emp_aggregates[proj_key] = {
                'project_name': t['project_name'],
                'employee_name': emp_name,
                'total_seconds': 0,
                'tasks_count': 0
            }
        proj_emp_aggregates[proj_key]['total_seconds'] += dur_sec
        proj_emp_aggregates[proj_key]['tasks_count'] += 1

        start_str = start_dt.astimezone(IST_TZ).strftime('%I:%M:%S %p') if start_dt else '-'
        end_str = end_dt.astimezone(IST_TZ).strftime('%I:%M:%S %p') if end_dt else 'In progress'

        task_rows.append({
            'sr_no': idx,
            'task_log_id': t['task_log_id'],
            'stable_task_id': stable_id,
            'user_id': t['user_id'],
            'employee_id': emp_code,
            'employee_name': emp_name,
            'email': emp_email,
            'department': emp_dept,
            'project_name': t['project_name'],
            'task_name': t['task_name'],
            'description': t['description'],
            'start_time': start_str,
            'end_time': end_str,
            'duration_seconds': dur_sec,
            'duration_hours': round(dur_sec / 3600.0, 2),
            'duration_formatted': format_task_seconds(dur_sec),
            'status': t['status'],
            'is_just_started': is_just_started,
            'is_completed': is_completed,
            'is_in_progress': is_in_progress,
            'is_pending': False
        })

    # Retrieve Pending Tasks for this date
    pending_qs = ProjectTask.objects.filter(status='NOT_STARTED')
    if target_uid:
        pending_qs = pending_qs.filter(assigned_to_id=target_uid)
    else:
        pending_qs = pending_qs.filter(assigned_to_id__in=employee_ids)
    if project:
        pending_qs = pending_qs.filter(project__name__icontains=project)

    pending_tasks_list = []
    for pt in pending_qs:
        sched_date = None
        if pt.deadline:
            sched_date = pt.deadline.astimezone(IST_TZ).date()
        elif pt.created_at:
            sched_date = pt.created_at.astimezone(IST_TZ).date()
        if sched_date == target_date_obj:
            pending_tasks_list.append(pt)

    # Add pending tasks to task_rows for complete visibility
    for pt in pending_tasks_list:
        u = users_map.get(pt.assigned_to_id)
        emp_code = u.employee_id if (u and u.employee_id) else (f"EMP{u.id:03d}" if u else '-')
        emp_name = f"{u.first_name} {u.last_name}".strip() if u else (u.username if u else 'Unassigned')
        emp_email = u.email if u else '-'
        emp_dept = u.department if u else '-'

        cur_idx = len(task_rows) + 1
        task_rows.append({
            'sr_no': cur_idx,
            'task_log_id': pt.task_id,
            'stable_task_id': pt.task_id,
            'user_id': pt.assigned_to_id or 0,
            'employee_id': emp_code,
            'employee_name': emp_name,
            'email': emp_email,
            'department': emp_dept,
            'project_name': pt.project.name if pt.project else 'General',
            'task_name': pt.title,
            'description': pt.description,
            'start_time': '-',
            'end_time': '-',
            'duration_seconds': 0,
            'duration_hours': 0,
            'duration_formatted': '00:00:00',
            'status': 'NOT_STARTED',
            'is_just_started': False,
            'is_completed': False,
            'is_in_progress': False,
            'is_pending': True
        })

    # Summary lifecycle counts
    pending_count = len(pending_tasks_list)
    completed_ids = [tid for tid, inf in distinct_tasks.items() if inf['is_completed']]
    in_progress_ids = [tid for tid, inf in distinct_tasks.items() if inf['is_in_progress']]
    just_started_ids = [tid for tid, inf in distinct_tasks.items() if inf['is_just_started']]
    pending_ids = [pt.task_id for pt in pending_tasks_list]

    completed_count = len(completed_ids)
    in_progress_count = len(in_progress_ids)
    just_started_count = len(just_started_ids)
    total_distinct_count = pending_count + in_progress_count + completed_count

    task_counts = {
        'total_tasks': total_distinct_count,
        'pending_tasks': pending_count,
        'pending_is_na': False,
        'just_started_tasks': just_started_count,
        'in_progress_tasks': in_progress_count,
        'completed_tasks': completed_count,
        'matching_task_ids': {
            'total': pending_ids + in_progress_ids + completed_ids,
            'pending': pending_ids,
            'just_started': just_started_ids,
            'in_progress': in_progress_ids,
            'completed': completed_ids,
        }
    }

    by_employee = [
        {
            'user_id': d['user_id'],
            'employee_id': d['employee_id'],
            'employee_name': d['employee_name'],
            'email': d['email'],
            'department': d['department'],
            'total_seconds': d['total_seconds'],
            'total_hours': round(d['total_seconds'] / 3600.0, 2),
            'duration_formatted': format_task_seconds(d['total_seconds']),
            'tasks_count': d['tasks_count']
        }
        for d in sorted(emp_aggregates.values(), key=lambda x: x['total_seconds'], reverse=True)
    ]

    by_project_and_employee = [
        {
            'project_name': d['project_name'],
            'employee_name': d['employee_name'],
            'total_seconds': d['total_seconds'],
            'total_hours': round(d['total_seconds'] / 3600.0, 2),
            'duration_formatted': format_task_seconds(d['total_seconds']),
            'tasks_count': d['tasks_count']
        }
        for d in sorted(proj_emp_aggregates.values(), key=lambda x: x['total_seconds'], reverse=True)
    ]

    return {
        'date': target_date,
        'tasks': task_rows,
        'by_employee': by_employee,
        'by_project_and_employee': by_project_and_employee,
        'summary': {
            'total_tasks': total_distinct_count,
            'active_in_progress': in_progress_count,
            'completed': completed_count,
            'total_seconds': sum(r['duration_seconds'] for r in task_rows),
            'total_hours': round(sum(r['duration_seconds'] for r in task_rows) / 3600.0, 2),
            'task_counts': task_counts
        },
        'task_counts': task_counts
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_tasks_report_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)

    data = get_admin_task_report_data(request)
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_tasks_export_view(request):
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)

    export_format = request.GET.get('format', 'csv').lower()
    data = get_admin_task_report_data(request)
    date_str = data['date']
    tasks = data['tasks']
    summary = data['summary']

    storage.log_audit(
        action="EXPORT_TASK_REPORT",
        actor=request.user.email,
        details={"date": date_str, "format": export_format, "tasks_count": len(tasks)}
    )

    filename_prefix = f"daily_tasks_report_{date_str}"

    if export_format == 'csv':
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename_prefix}.csv"'

        writer = csv.writer(response)
        writer.writerow(['KNOWLETIVE DAILY TIME-WISE TASK REPORT', f"Date: {date_str}"])
        writer.writerow([
            'Total Tasks:', summary['total_tasks'], 
            'Active in Progress:', summary['active_in_progress'], 
            'Total Time:', format_task_seconds(summary['total_seconds'])
        ])
        writer.writerow([])
        writer.writerow([
            'Sr. No.', 'Employee ID', 'Employee Name', 'Department', 'Project Name', 
            'Task Name', 'Work Description', 'Start Time (IST)', 'End Time (IST)', 
            'Duration (Hours)', 'Duration', 'Status'
        ])
        for t in tasks:
            writer.writerow([
                t['sr_no'], t['employee_id'], t['employee_name'], t['department'], t['project_name'],
                t['task_name'], t['description'], t['start_time'], t['end_time'],
                t['duration_hours'], t['duration_formatted'], t['status']
            ])
        return response

    elif export_format in ['xlsx', 'excel']:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"Tasks {date_str}"

        # Header block
        title_font = Font(name="Arial", size=14, bold=True, color="1E3A8A")
        ws.append(['KNOWLETIVE DAILY TIME-WISE TASK REPORT'])
        ws['A1'].font = title_font
        ws.append([f"Date (IST): {date_str}", f"Total Tasks: {summary['total_tasks']}", f"Total Time: {format_task_seconds(summary['total_seconds'])}"])
        ws.append([])

        headers = [
            'Sr. No.', 'Employee ID', 'Employee Name', 'Department', 'Project Name', 
            'Task Name', 'Work Description', 'Start Time (IST)', 'End Time (IST)', 
            'Duration (Hours)', 'Duration', 'Status'
        ]
        ws.append(headers)

        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
        for cell in ws[4]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for t in tasks:
            ws.append([
                t['sr_no'], t['employee_id'], t['employee_name'], t['department'], t['project_name'],
                t['task_name'], t['description'], t['start_time'], t['end_time'],
                t['duration_hours'], t['duration_formatted'], t['status']
            ])

        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        stream = io.BytesIO()
        wb.save(stream)
        stream.seek(0)

        response = HttpResponse(
            stream.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = f'attachment; filename="{filename_prefix}.xlsx"'
        return response

    return Response({'error': 'Invalid format. Use csv or xlsx.'}, status=400)


def safe_parse_utc(ts_str):
    """
    Safely parses an ISO timestamp string into a timezone-aware UTC datetime.
    Guarantees that returned datetimes are always timezone-aware (UTC).
    """
    if not ts_str:
        return None
    cleaned = str(ts_str).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def get_admin_hourly_task_report_data(request):
    """
    Aggregates task activity into 24 one-hour intervals for a specific target date
    in the configured workspace timezone (defaulting to Asia/Kolkata).
    
    Adheres strictly to hourly calculation rules:
    - Splits task time across every hour slot it overlaps.
    - Excludes breaks and pause periods using recorded work_segments.
    - Counts each task once per slot when worked on in that slot.
    - Counts completion only in the slot containing the completion timestamp and status COMPLETED.
    - Start-inclusive, end-exclusive boundaries: [slot_start, slot_end).
    - Distinguishes exact vs. estimated timing accuracy for historical fallback.
    - Keeps 'tasks_worked_count' and 'tasks_completed_count' as separate counts.
    """
    try:
        settings_tz_str = storage.get_settings().get('timezone') or 'Asia/Kolkata'
        ws_tz = zoneinfo.ZoneInfo(settings_tz_str)
    except Exception:
        settings_tz_str = 'Asia/Kolkata'
        ws_tz = IST_TZ

    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(ws_tz)

    date_str = request.GET.get('date', '').strip()
    if not date_str:
        date_str = now_local.date().isoformat()
    else:
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            return {'error': 'Invalid date format. Expected YYYY-MM-DD.'}

    target_date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
    earliest_starts = get_tasks_earliest_starts_map()

    # Determine 24-hour day boundary in workspace timezone converted to UTC
    day_start_local = datetime(target_date_obj.year, target_date_obj.month, target_date_obj.day, 0, 0, 0, tzinfo=ws_tz)
    day_end_local = day_start_local + timedelta(days=1)
    day_start_utc = day_start_local.astimezone(timezone.utc)
    day_end_utc = day_end_local.astimezone(timezone.utc)

    day_start_iso = day_start_utc.isoformat().replace("+00:00", "Z")
    day_end_iso = day_end_utc.isoformat().replace("+00:00", "Z")

    # Scope users
    employee_users = User.objects.filter(role='EMPLOYEE')
    employee_ids = set(employee_users.values_list('id', flat=True))
    users_map = {u.id: u for u in employee_users}

    emp_filter_val = request.GET.get('employee_id', '').strip()
    filter_user_id = None
    if emp_filter_val:
        if emp_filter_val.isdigit():
            matched_emp = employee_users.filter(models.Q(id=int(emp_filter_val)) | models.Q(employee_id=emp_filter_val)).first()
        else:
            matched_emp = employee_users.filter(employee_id=emp_filter_val).first()
        if matched_emp:
            filter_user_id = matched_emp.id
        else:
            filter_user_id = -999999

    project_filter = request.GET.get('project', '').strip() or None

    slot_filter_param = request.GET.get('slot', 'all').strip().lower()
    filter_slot_idx = None
    if slot_filter_param not in ['', 'all']:
        try:
            filter_slot_idx = int(slot_filter_param)
            if not (9 <= filter_slot_idx <= 19):
                return {'error': 'Slot index must be between 9 and 19 (9:00 AM–8:00 PM), or "all".'}
        except ValueError:
            return {'error': 'Invalid slot parameter. Expected integer 9-19 or "all".'}

    # Efficient single DB query for all tasks that could overlap with the target day
    tasks_qs = TaskLog.objects.filter(
        models.Q(date=date_str) |
        (models.Q(start_time__lt=day_end_iso) & (models.Q(end_time__isnull=True) | models.Q(end_time__gte=day_start_iso)))
    )

    if filter_user_id is not None:
        tasks_qs = tasks_qs.filter(user_id=filter_user_id)
    else:
        tasks_qs = tasks_qs.filter(user_id__in=employee_ids)

    if project_filter:
        tasks_qs = tasks_qs.filter(project_name__icontains=project_filter)

    all_tasks = list(tasks_qs.order_by('start_time'))

    # Prepare parsed task intervals for fast memory-based slot distribution
    prepared_tasks = []
    for t in all_tasks:
        u = users_map.get(t.user_id)
        emp_code = u.employee_id if (u and u.employee_id) else (t.employee_id or (f"EMP{u.id:03d}" if u else f"EMP{t.user_id:03d}"))
        emp_name = f"{u.first_name} {u.last_name}".strip() if u else (t.employee_name or f"User {t.user_id}")
        emp_dept = u.department if u else '-'
        emp_email = u.email if u else '-'

        # Collect active work intervals
        work_intervals = []
        raw_segments = t.work_segments if isinstance(t.work_segments, list) else []
        for seg in raw_segments:
            if isinstance(seg, dict):
                s_dt = safe_parse_utc(seg.get('start_time'))
                e_dt = safe_parse_utc(seg.get('end_time'))
                if s_dt and e_dt and e_dt > s_dt:
                    work_intervals.append({
                        'start': s_dt,
                        'end': e_dt,
                        'accuracy': 'exact',
                        'note': 'Recorded work segment',
                        'ratio': 1.0
                    })

        if t.status == 'IN_PROGRESS':
            cur_start_str = t.current_segment_start or t.start_time
            cur_start_dt = safe_parse_utc(cur_start_str)
            if cur_start_dt:
                cur_end_dt = max(cur_start_dt, now_utc)
                work_intervals.append({
                    'start': cur_start_dt,
                    'end': cur_end_dt,
                    'accuracy': 'exact',
                    'note': 'Live in-progress work session',
                    'ratio': 1.0
                })

        # Historical fallback if no segments recorded
        if not work_intervals:
            s_dt = safe_parse_utc(t.start_time)
            e_dt = safe_parse_utc(t.end_time) if t.end_time else (now_utc if t.status == 'IN_PROGRESS' else None)
            if s_dt and e_dt and e_dt > s_dt:
                total_span = (e_dt - s_dt).total_seconds()
                dur_sec = t.duration_seconds or 0
                if dur_sec > 0 and abs(dur_sec - total_span) > 60 and dur_sec < total_span:
                    ratio = dur_sec / total_span
                    work_intervals.append({
                        'start': s_dt,
                        'end': e_dt,
                        'accuracy': 'estimated',
                        'note': f"Estimated: Recorded {dur_sec}s work distributed across span",
                        'ratio': ratio
                    })
                else:
                    work_intervals.append({
                        'start': s_dt,
                        'end': e_dt,
                        'accuracy': 'estimated',
                        'note': 'Estimated from start and end times (no segment breaks recorded)',
                        'ratio': 1.0
                    })
            elif s_dt:
                work_intervals.append({
                    'start': s_dt,
                    'end': s_dt,
                    'accuracy': 'unavailable',
                    'note': 'Historical task lacks completion timestamp or duration details',
                    'ratio': 0.0
                })

        # Completion timestamp and status check:
        # Uses explicit completion timestamp; ignores timer-stops on non-completed tasks
        is_completed = False
        comp_dt = None
        if t.completed_at:
            comp_dt = safe_parse_utc(t.completed_at)
            is_completed = bool(t.is_explicit_completed or t.status == 'COMPLETED')
        elif t.status == 'COMPLETED' and not t.project_task_id:
            # Compatible fallback for synthetic/legacy records where end_time was recorded as completion
            comp_dt = safe_parse_utc(t.end_time) if t.end_time else None
            is_completed = bool(comp_dt)

        stable_id = t.project_task_id or t.task_id
        first_s = earliest_starts.get(stable_id)

        prepared_tasks.append({
            'model': t,
            'stable_id': stable_id,
            'first_started_dt': first_s,
            'user': u,
            'user_id': t.user_id,
            'employee_id': emp_code,
            'employee_name': emp_name,
            'department': emp_dept,
            'email': emp_email,
            'work_intervals': work_intervals,
            'is_completed': is_completed,
            'completion_dt': comp_dt
        })

    # Retrieve Pending tasks matching scope
    pending_qs = ProjectTask.objects.filter(status='NOT_STARTED')
    if filter_user_id is not None:
        pending_qs = pending_qs.filter(assigned_to_id=filter_user_id)
    else:
        pending_qs = pending_qs.filter(assigned_to_id__in=employee_ids)
    if project_filter:
        pending_qs = pending_qs.filter(project__name__icontains=project_filter)
    all_pending = list(pending_qs)

    # Build 11 one-hour slots from 9:00 AM to 8:00 PM (hours 9 to 19 inclusive)
    slots_data = []
    total_day_worked_seconds = 0
    distinct_tasks_worked_today = set()
    total_tasks_completed_today = 0
    active_employees_today = set()

    def format_slot_hour(hr):
        v = hr % 12
        if v == 0:
            v = 12
        ap = 'AM' if (hr < 12 or hr == 24) else 'PM'
        return f"{v}:00 {ap}"

    for h in range(9, 20):
        slot_start_local = datetime(target_date_obj.year, target_date_obj.month, target_date_obj.day, h, 0, 0, tzinfo=ws_tz)
        slot_end_local = slot_start_local + timedelta(hours=1)
        slot_start_utc = slot_start_local.astimezone(timezone.utc)
        slot_end_utc = slot_end_local.astimezone(timezone.utc)

        slot_label = f"{format_slot_hour(h)}–{format_slot_hour(h + 1)}"

        slot_worked_seconds = 0
        slot_distinct_tasks_worked = set()
        slot_completed_tasks = set()
        slot_just_started_tasks = set()
        slot_in_progress_tasks = set()
        slot_tasks_completed_count = 0
        slot_active_employees = set()

        slot_task_items = []
        slot_employee_groups = {}

        for pt in prepared_tasks:
            t = pt['model']
            task_slot_seconds = 0
            task_accuracy = 'exact'
            task_notes = []

            for iv in pt['work_intervals']:
                iv_s, iv_e = iv['start'], iv['end']
                if iv_s and iv_e:
                    ov_s = max(iv_s, slot_start_utc)
                    ov_e = min(iv_e, slot_end_utc)
                    if ov_e > ov_s:
                        overlap_dur = (ov_e - ov_s).total_seconds() * iv['ratio']
                        task_slot_seconds += int(overlap_dur)
                        if iv['accuracy'] != 'exact':
                            task_accuracy = iv['accuracy']
                        if iv.get('note'):
                            task_notes.append(iv['note'])

            # Start-inclusive, end-exclusive completion check
            is_completed_in_slot = False
            completed_at_local = None
            if pt['is_completed'] and pt['completion_dt']:
                if slot_start_utc <= pt['completion_dt'] < slot_end_utc:
                    is_completed_in_slot = True
                    completed_at_local = pt['completion_dt'].astimezone(ws_tz).strftime('%I:%M:%S %p')

            # First-ever work start check for this slot
            first_s = pt.get('first_started_dt')
            is_just_started_in_slot = bool(first_s and slot_start_utc <= first_s < slot_end_utc)

            # In progress check for this slot
            is_in_progress_in_slot = bool(task_slot_seconds > 0 and not is_completed_in_slot)

            if task_slot_seconds > 0 or is_completed_in_slot or is_just_started_in_slot:
                task_distinct_id = pt['stable_id']
                slot_distinct_tasks_worked.add(task_distinct_id)
                distinct_tasks_worked_today.add(task_distinct_id)

                if is_completed_in_slot:
                    slot_completed_tasks.add(task_distinct_id)
                    slot_tasks_completed_count += 1
                    total_tasks_completed_today += 1

                if is_just_started_in_slot:
                    slot_just_started_tasks.add(task_distinct_id)

                if is_in_progress_in_slot:
                    slot_in_progress_tasks.add(task_distinct_id)

                slot_worked_seconds += task_slot_seconds
                slot_active_employees.add(pt['user_id'])
                active_employees_today.add(pt['user_id'])

                t_start_dt = safe_parse_utc(t.start_time)
                t_end_dt = safe_parse_utc(t.end_time)

                task_obj = {
                    'task_id': t.task_id,
                    'stable_task_id': task_distinct_id,
                    'user_id': pt['user_id'],
                    'employee_id': pt['employee_id'],
                    'employee_name': pt['employee_name'],
                    'department': pt['department'],
                    'email': pt['email'],
                    'project_name': t.project_name or 'General',
                    'task_name': t.task_name or 'Untitled Task',
                    'description': t.description or '',
                    'status': t.status,
                    'worked_seconds_in_slot': task_slot_seconds,
                    'worked_duration_formatted': format_task_seconds(task_slot_seconds),
                    'is_completed_in_slot': is_completed_in_slot,
                    'is_just_started': is_just_started_in_slot,
                    'is_completed': is_completed_in_slot,
                    'is_in_progress': is_in_progress_in_slot,
                    'is_pending': False,
                    'completed_at': completed_at_local,
                    'overall_start_time': t_start_dt.astimezone(ws_tz).strftime('%I:%M:%S %p') if t_start_dt else '-',
                    'overall_end_time': t_end_dt.astimezone(ws_tz).strftime('%I:%M:%S %p') if t_end_dt else ('In progress' if t.status == 'IN_PROGRESS' else ('Paused' if t.status == 'PAUSED' else '-')),
                    'overall_duration_seconds': t.duration_seconds,
                    'overall_duration_formatted': format_task_seconds(t.duration_seconds),
                    'timing_accuracy': task_accuracy,
                    'accuracy_note': "; ".join(set(task_notes)) if task_notes else "Exact recorded work interval"
                }

                slot_task_items.append(task_obj)

                # Group by employee within this slot
                uid = pt['user_id']
                if uid not in slot_employee_groups:
                    slot_employee_groups[uid] = {
                        'user_id': uid,
                        'employee_id': pt['employee_id'],
                        'employee_name': pt['employee_name'],
                        'department': pt['department'],
                        'email': pt['email'],
                        'total_seconds': 0,
                        'tasks_worked_count': 0,
                        'tasks_completed_count': 0,
                        'tasks': []
                    }

                slot_employee_groups[uid]['total_seconds'] += task_slot_seconds
                if task_slot_seconds > 0:
                    slot_employee_groups[uid]['tasks_worked_count'] += 1
                if is_completed_in_slot:
                    slot_employee_groups[uid]['tasks_completed_count'] += 1
                slot_employee_groups[uid]['tasks'].append(task_obj)

        total_day_worked_seconds += slot_worked_seconds

        emp_summary_list = []
        for eg in slot_employee_groups.values():
            eg['duration_formatted'] = format_task_seconds(eg['total_seconds'])
            emp_summary_list.append(eg)

        # Slot Pending tasks check: scheduled by hour?
        slot_pending_tasks = [
            p for p in all_pending
            if p.deadline and slot_start_utc <= p.deadline < slot_end_utc
        ]
        slot_has_pending = len(slot_pending_tasks) > 0
        slot_pending_is_na = not slot_has_pending
        slot_pending_val = len(slot_pending_tasks) if slot_has_pending else "N/A"

        slot_total_distinct = len(slot_in_progress_tasks) + len(slot_completed_tasks)
        if not slot_pending_is_na:
            slot_total_distinct += slot_pending_val

        slot_task_counts = {
            'total_tasks': slot_total_distinct,
            'pending_tasks': slot_pending_val,
            'pending_is_na': slot_pending_is_na,
            'just_started_tasks': len(slot_just_started_tasks),
            'in_progress_tasks': len(slot_in_progress_tasks),
            'completed_tasks': len(slot_completed_tasks),
            'matching_task_ids': {
                'total': list(slot_distinct_tasks_worked) + [p.task_id for p in slot_pending_tasks],
                'pending': [p.task_id for p in slot_pending_tasks],
                'just_started': list(slot_just_started_tasks),
                'in_progress': list(slot_in_progress_tasks),
                'completed': list(slot_completed_tasks),
            }
        }

        has_activity = (slot_worked_seconds > 0 or slot_tasks_completed_count > 0 or len(slot_distinct_tasks_worked) > 0 or len(slot_pending_tasks) > 0)

        slot_item = {
            'slot_index': h,
            'slot_label': slot_label,
            'slot_start_iso': slot_start_local.isoformat(),
            'slot_end_iso': slot_end_local.isoformat(),
            'start_time_display': slot_start_local.strftime('%I:%M %p'),
            'end_time_display': slot_end_local.strftime('%I:%M %p'),
            'has_activity': has_activity,
            'total_seconds': slot_worked_seconds,
            'total_hours': round(slot_worked_seconds / 3600.0, 2),
            'duration_formatted': format_task_seconds(slot_worked_seconds),
            'tasks_worked_count': len(slot_distinct_tasks_worked),
            'tasks_completed_count': slot_tasks_completed_count,
            'employees_count': len(slot_active_employees),
            'by_employee': sorted(emp_summary_list, key=lambda x: x['employee_name']),
            'tasks': slot_task_items,
            'task_counts': slot_task_counts
        }

        slots_data.append(slot_item)

    # Overview for quick slot navigation / indicator badges
    slots_overview = [
        {
            'slot_index': s['slot_index'],
            'slot_label': s['slot_label'],
            'has_activity': s['has_activity'],
            'total_seconds': s['total_seconds'],
            'duration_formatted': s['duration_formatted'],
            'tasks_worked_count': s['tasks_worked_count'],
            'tasks_completed_count': s['tasks_completed_count'],
            'employees_count': s['employees_count']
        }
        for s in slots_data
    ]

    # Filter slots if a single slot was requested
    filtered_slots = slots_data
    if filter_slot_idx is not None:
        filtered_slots = [s for s in slots_data if s['slot_index'] == filter_slot_idx]

    if filter_slot_idx is not None and filtered_slots:
        target_slot = filtered_slots[0]
        summary_payload = {
            'total_slots_with_activity': 1 if target_slot['has_activity'] else 0,
            'total_slots_count': 1,
            'total_work_seconds': target_slot['total_seconds'],
            'total_work_hours': target_slot['total_hours'],
            'total_work_duration_formatted': target_slot['duration_formatted'],
            'total_tasks_worked': target_slot['tasks_worked_count'],
            'total_tasks_completed': target_slot['tasks_completed_count'],
            'total_active_employees': target_slot['employees_count'],
            'task_counts': target_slot['task_counts']
        }
    else:
        all_slot_completed_ids = set()
        all_slot_just_started_ids = set()
        all_slot_in_progress_ids = set()
        for s in slots_data:
            all_slot_completed_ids.update(s['task_counts']['matching_task_ids']['completed'])
            all_slot_just_started_ids.update(s['task_counts']['matching_task_ids']['just_started'])
            all_slot_in_progress_ids.update(s['task_counts']['matching_task_ids']['in_progress'])

        day_in_progress_ids = all_slot_in_progress_ids - all_slot_completed_ids
        day_pending_tasks = [
            p for p in all_pending
            if (p.deadline and p.deadline.astimezone(ws_tz).date() == target_date_obj) or (p.created_at and p.created_at.astimezone(ws_tz).date() == target_date_obj)
        ]
        day_pending_ids = [p.task_id for p in day_pending_tasks]
        day_total_tasks = len(day_pending_ids) + len(day_in_progress_ids) + len(all_slot_completed_ids)

        day_task_counts = {
            'total_tasks': day_total_tasks,
            'pending_tasks': len(day_pending_ids),
            'pending_is_na': False,
            'just_started_tasks': len(all_slot_just_started_ids),
            'in_progress_tasks': len(day_in_progress_ids),
            'completed_tasks': len(all_slot_completed_ids),
            'matching_task_ids': {
                'total': day_pending_ids + list(day_in_progress_ids) + list(all_slot_completed_ids),
                'pending': day_pending_ids,
                'just_started': list(all_slot_just_started_ids),
                'in_progress': list(day_in_progress_ids),
                'completed': list(all_slot_completed_ids),
            }
        }

        summary_payload = {
            'total_slots_with_activity': sum(1 for s in slots_data if s['has_activity']),
            'total_slots_count': len(slots_data),
            'total_work_seconds': total_day_worked_seconds,
            'total_work_hours': round(total_day_worked_seconds / 3600.0, 2),
            'total_work_duration_formatted': format_task_seconds(total_day_worked_seconds),
            'total_tasks_worked': len(distinct_tasks_worked_today),
            'total_tasks_completed': total_tasks_completed_today,
            'total_active_employees': len(active_employees_today),
            'task_counts': day_task_counts
        }

    return {
        'date': date_str,
        'timezone': settings_tz_str,
        'filter_employee_id': emp_filter_val or None,
        'filter_project': project_filter or None,
        'filter_slot': slot_filter_param if filter_slot_idx is not None else 'all',
        'summary': summary_payload,
        'task_counts': summary_payload.get('task_counts'),
        'slots_overview': slots_overview,
        'slots': filtered_slots
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_hourly_tasks_report_view(request):
    """
    Authenticated Admin API endpoint returning hourly breakdown of employee task activities.
    """
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)

    data = get_admin_hourly_task_report_data(request)
    if 'error' in data:
        return Response({'error': data['error']}, status=400)

    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_hourly_tasks_export_view(request):
    """
    Export hourly task report to CSV or Excel (.xlsx).
    """
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)

    data = get_admin_hourly_task_report_data(request)
    if 'error' in data:
        return Response({'error': data['error']}, status=400)

    export_format = request.GET.get('format', 'csv').lower()
    date_str = data['date']
    tz_str = data['timezone']
    slots = data['slots']
    summary = data['summary']

    storage.log_audit(
        action="EXPORT_HOURLY_TASK_REPORT",
        actor=request.user.email,
        details={
            "date": date_str,
            "format": export_format,
            "slots_count": len(slots),
            "timezone": tz_str
        }
    )

    filename_prefix = f"hourly_task_report_{date_str}"

    # Flatten task rows across slots for export
    rows = []
    sr = 1
    for s in slots:
        if not s['tasks']:
            # Include empty slot row to represent inactivity accurately
            rows.append({
                'sr_no': sr,
                'slot_label': s['slot_label'],
                'employee_id': '-',
                'employee_name': 'No recorded activity',
                'department': '-',
                'project_name': '-',
                'task_name': '-',
                'description': '-',
                'worked_in_slot': '-',
                'completed_in_slot': 'No',
                'completed_at': '-',
                'status': '-',
                'timing_accuracy': '-'
            })
            sr += 1
        else:
            for t in s['tasks']:
                rows.append({
                    'sr_no': sr,
                    'slot_label': s['slot_label'],
                    'employee_id': t['employee_id'],
                    'employee_name': t['employee_name'],
                    'department': t['department'],
                    'project_name': t['project_name'],
                    'task_name': t['task_name'],
                    'description': t['description'],
                    'worked_in_slot': t['worked_duration_formatted'],
                    'completed_in_slot': 'Yes' if t['is_completed_in_slot'] else 'No',
                    'completed_at': t['completed_at'] or '-',
                    'status': t['status'],
                    'timing_accuracy': t['timing_accuracy'].capitalize()
                })
                sr += 1

    if export_format == 'csv':
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename_prefix}.csv"'
        writer = csv.writer(response)
        writer.writerow(['KNOWLETIVE HOURLY EMPLOYEE TASK REPORT', f"Date: {date_str} ({tz_str})"])
        writer.writerow([
            'Total Worked Time:', summary['total_work_duration_formatted'],
            'Tasks Worked On:', summary['total_tasks_worked'],
            'Tasks Completed:', summary['total_tasks_completed'],
            'Active Hours:', summary['total_slots_with_activity']
        ])
        writer.writerow([])
        writer.writerow([
            'Sr. No.', 'Time Slot', 'Employee ID', 'Employee Name', 'Department',
            'Project Name', 'Task Name', 'Work Description', 'Time Worked in Slot',
            'Completed in Slot', 'Completed At', 'Task Status', 'Timing Accuracy'
        ])
        for r in rows:
            writer.writerow([
                r['sr_no'], r['slot_label'], r['employee_id'], r['employee_name'], r['department'],
                r['project_name'], r['task_name'], r['description'], r['worked_in_slot'],
                r['completed_in_slot'], r['completed_at'], r['status'], r['timing_accuracy']
            ])
        return response

    elif export_format in ['xlsx', 'excel']:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"Hourly Tasks {date_str}"

        title_font = Font(name="Arial", size=14, bold=True, color="1E3A8A")
        ws.append(['KNOWLETIVE HOURLY EMPLOYEE TASK REPORT'])
        ws['A1'].font = title_font
        ws.append([f"Date ({tz_str}): {date_str}", f"Total Worked: {summary['total_work_duration_formatted']}", f"Tasks Worked: {summary['total_tasks_worked']}", f"Tasks Completed: {summary['total_tasks_completed']}"])
        ws.append([])

        headers = [
            'Sr. No.', 'Time Slot', 'Employee ID', 'Employee Name', 'Department',
            'Project Name', 'Task Name', 'Work Description', 'Time Worked in Slot',
            'Completed in Slot', 'Completed At', 'Task Status', 'Timing Accuracy'
        ]
        ws.append(headers)

        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
        for cell in ws[4]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for r in rows:
            ws.append([
                r['sr_no'], r['slot_label'], r['employee_id'], r['employee_name'], r['department'],
                r['project_name'], r['task_name'], r['description'], r['worked_in_slot'],
                r['completed_in_slot'], r['completed_at'], r['status'], r['timing_accuracy']
            ])

        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        stream = io.BytesIO()
        wb.save(stream)
        stream.seek(0)

        response = HttpResponse(
            stream.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = f'attachment; filename="{filename_prefix}.xlsx"'
        return response

    return Response({'error': 'Invalid format. Use csv or xlsx.'}, status=400)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def analytics_dashboard_view(request):
    """
    Role-enforced analytics dashboard API.
    - Employees: strictly limited to their own data (request.user.id).
    - Admins: can view all permitted employees or filter by a specific employee.
    Calculates summary metrics, daily trends, project breakdowns, employee breakdowns, and task breakdowns using real data.
    """
    user = request.user
    is_admin = (user.role == 'ADMIN')

    # 1. Scope users based on role
    employee_users = User.objects.filter(role='EMPLOYEE')
    users_map = {u.id: u for u in employee_users}
    users_map[user.id] = user

    if not is_admin:
        # Strictly scope employees to their own records only; ignore any other employee_id parameter
        target_users = [user]
        target_user_ids = {user.id}
    else:
        req_emp = request.GET.get('employee_id')
        if req_emp:
            if str(req_emp).isdigit():
                matched = employee_users.filter(models.Q(id=int(req_emp)) | models.Q(employee_id=req_emp)).first()
            else:
                matched = employee_users.filter(employee_id=req_emp).first()
            target_users = [matched] if matched else []
            target_user_ids = {matched.id} if matched else set()
        else:
            target_users = list(employee_users)
            target_user_ids = set(employee_users.values_list('id', flat=True))

    # 2. Date filters
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    today_ist = now_ist.date()

    start_date_param = request.GET.get('start_date', '').strip() or None
    end_date_param = request.GET.get('end_date', '').strip() or None
    project_filter = request.GET.get('project', '').strip()
    period = request.GET.get('period', '7d').strip()

    if start_date_param and end_date_param:
        try:
            d_start = date.fromisoformat(start_date_param)
            d_end = date.fromisoformat(end_date_param)
            if d_start > d_end:
                return Response({'error': 'Invalid date range: Start date cannot be after end date.'}, status=400)
        except ValueError:
            return Response({'error': 'Invalid date format. Expected YYYY-MM-DD.'}, status=400)
    elif period == 'today':
        d_start = today_ist
        d_end = today_ist
    elif period == '30d':
        d_end = today_ist
        d_start = today_ist - timedelta(days=29)
    elif period == 'month':
        d_start = today_ist.replace(day=1)
        days_in_m = calendar.monthrange(today_ist.year, today_ist.month)[1]
        d_end = today_ist.replace(day=days_in_m)
    else:  # default 7d
        d_end = today_ist
        d_start = today_ist - timedelta(days=6)

    d_start_str = d_start.isoformat()
    d_end_str = d_end.isoformat()

    # 3. Retrieve all real events and tasks in date range for target users
    all_events = storage.get_all_events() if is_admin else storage.get_events_for_user(user.id)
    scoped_events = [
        e for e in all_events
        if int(e.get('user_id', -1)) in target_user_ids
    ]

    filter_uid = user.id if not is_admin else (list(target_user_ids)[0] if len(target_user_ids) == 1 and request.GET.get('employee_id') else None)
    all_tasks = storage.get_all_tasks(
        start_date=d_start_str,
        end_date=d_end_str,
        user_id=filter_uid,
        project=(project_filter if project_filter else None)
    )
    scoped_tasks = [t for t in all_tasks if int(t.get('user_id', -1)) in target_user_ids]

    # 4. Daily time-tracking metrics aggregation
    daily_trend = []
    total_work_seconds = 0
    total_break_seconds = 0
    days_worked_set = set()
    active_employees_set = set()

    events_by_user_and_date = {}
    for ev in scoped_events:
        dt = parse_iso_utc(ev.get('timestamp'))
        if dt:
            ev_date = dt.astimezone(IST_TZ).date()
            if d_start <= ev_date <= d_end:
                u_id = int(ev.get('user_id', -1))
                events_by_user_and_date.setdefault((u_id, ev_date), []).append(ev)

    tasks_by_date = {}
    for t in scoped_tasks:
        t_date = t.get('date', '')
        tasks_by_date.setdefault(t_date, []).append(t)

    cur_day = d_start
    while cur_day <= d_end:
        cur_day_str = cur_day.isoformat()
        day_work_sec = 0
        day_break_sec = 0
        day_active_users = set()

        for u in target_users:
            u_day_events = events_by_user_and_date.get((u.id, cur_day), [])
            if u_day_events:
                metrics = calculate_day_metrics(u_day_events, now_utc if cur_day == today_ist else None)
                day_work_sec += metrics['total_work_seconds']
                day_break_sec += metrics['total_break_seconds']
                if metrics['total_work_seconds'] > 0:
                    day_active_users.add(u.id)
                    days_worked_set.add(cur_day_str)
                    active_employees_set.add(u.id)

        day_tasks = tasks_by_date.get(cur_day_str, [])
        for t in day_tasks:
            t_dur = storage.calculate_task_duration(t, now_utc)
            active_employees_set.add(int(t.get('user_id', -1)))
            days_worked_set.add(cur_day_str)
            if not day_work_sec and t_dur:
                day_work_sec += t_dur

        total_work_seconds += day_work_sec
        total_break_seconds += day_break_sec

        formatted_label = cur_day.strftime('%d %b')
        day_name = cur_day.strftime('%a')

        daily_trend.append({
            'date': cur_day_str,
            'label': formatted_label,
            'day_name': day_name,
            'work_hours': round(day_work_sec / 3600.0, 2),
            'work_seconds': day_work_sec,
            'break_hours': round(day_break_sec / 3600.0, 2),
            'break_seconds': day_break_sec,
            'tasks_count': len(day_tasks),
            'active_employees': len(day_active_users) if day_active_users else (len(set(t['user_id'] for t in day_tasks)) if day_tasks else 0)
        })

        cur_day += timedelta(days=1)

    # 5. Project & Task Aggregations
    project_aggregates = {}
    task_aggregates = {}
    completed_tasks_count = 0
    in_progress_tasks_count = 0

    for t in scoped_tasks:
        p_name = (t.get('project_name') or 'Unassigned').strip()
        t_name = (t.get('task_name') or 'Unnamed Task').strip()
        status = t.get('status', 'COMPLETED')

        s_dt = parse_iso_utc(t.get('start_time'))
        e_dt = parse_iso_utc(t.get('end_time')) if t.get('end_time') else None
        if e_dt and s_dt:
            dur = max(0, int((e_dt - s_dt).total_seconds()))
            completed_tasks_count += 1
        elif s_dt:
            dur = max(0, int((now_utc - s_dt).total_seconds()))
            in_progress_tasks_count += 1
        else:
            dur = 0

        if p_name not in project_aggregates:
            project_aggregates[p_name] = {
                'project_name': p_name,
                'total_seconds': 0,
                'tasks_count': 0,
                'employees': set()
            }
        project_aggregates[p_name]['total_seconds'] += dur
        project_aggregates[p_name]['tasks_count'] += 1
        if t.get('user_id'):
            project_aggregates[p_name]['employees'].add(t['user_id'])

        t_key = f"{p_name}::{t_name}"
        if t_key not in task_aggregates:
            task_aggregates[t_key] = {
                'task_name': t_name,
                'project_name': p_name,
                'total_seconds': 0,
                'count': 0,
                'status': status
            }
        task_aggregates[t_key]['total_seconds'] += dur
        task_aggregates[t_key]['count'] += 1

    tasks_total_sec = sum(p['total_seconds'] for p in project_aggregates.values())
    effective_work_seconds = max(total_work_seconds, tasks_total_sec)
    effective_work_hours = round(effective_work_seconds / 3600.0, 2)
    effective_break_hours = round(total_break_seconds / 3600.0, 2)

    by_project = [
        {
            'project_name': p['project_name'],
            'work_hours': round(p['total_seconds'] / 3600.0, 2),
            'work_seconds': p['total_seconds'],
            'work_duration_formatted': format_task_seconds(p['total_seconds']),
            'tasks_count': p['tasks_count'],
            'employee_count': len(p['employees']),
            'percentage': round((p['total_seconds'] / tasks_total_sec * 100), 1) if tasks_total_sec > 0 else (round(100.0 / len(project_aggregates), 1) if project_aggregates else 0)
        }
        for p in sorted(project_aggregates.values(), key=lambda x: x['total_seconds'], reverse=True)
    ]

    by_task = [
        {
            'task_name': tk['task_name'],
            'project_name': tk['project_name'],
            'work_hours': round(tk['total_seconds'] / 3600.0, 2),
            'work_seconds': tk['total_seconds'],
            'work_duration_formatted': format_task_seconds(tk['total_seconds']),
            'count': tk['count'],
            'status': tk['status']
        }
        for tk in sorted(task_aggregates.values(), key=lambda x: x['total_seconds'], reverse=True)[:10]
    ]

    # 6. Employee breakdown (for Admin or multi-user)
    by_employee = []
    if is_admin:
        emp_aggregates = {}
        for u in target_users:
            u_sec = 0
            u_break = 0
            u_tasks = [t for t in scoped_tasks if int(t.get('user_id', -1)) == u.id]
            for d in daily_trend:
                u_day_ev = events_by_user_and_date.get((u.id, date.fromisoformat(d['date'])), [])
                if u_day_ev:
                    m = calculate_day_metrics(u_day_ev, now_utc if d['date'] == today_ist.isoformat() else None)
                    u_sec += m['total_work_seconds']
                    u_break += m['total_break_seconds']

            t_sec = sum(t.get('duration_seconds', 0) for t in u_tasks)
            u_sec = max(u_sec, t_sec)

            if u_sec > 0 or u_tasks:
                emp_code = u.employee_id or f"EMP{u.id:03d}"
                emp_name = f"{u.first_name} {u.last_name}".strip() or u.username
                emp_aggregates[u.id] = {
                    'user_id': u.id,
                    'employee_id': emp_code,
                    'employee_name': emp_name,
                    'department': u.department or 'General',
                    'work_hours': round(u_sec / 3600.0, 2),
                    'work_seconds': u_sec,
                    'work_duration_formatted': format_task_seconds(u_sec),
                    'break_hours': round(u_break / 3600.0, 2),
                    'tasks_count': len(u_tasks),
                    'percentage': round((u_sec / effective_work_seconds * 100), 1) if effective_work_seconds > 0 else 0
                }

        by_employee = sorted(emp_aggregates.values(), key=lambda x: x['work_seconds'], reverse=True)

    # 7. Summary
    total_tasks = len(scoped_tasks)
    active_with_records = len({uid for uid in active_employees_set if uid and uid > 0})
    summary = {
        'total_work_seconds': effective_work_seconds,
        'total_work_hours': effective_work_hours,
        'total_work_formatted': format_task_seconds(effective_work_seconds),
        'total_break_seconds': total_break_seconds,
        'total_break_hours': effective_break_hours,
        'total_break_formatted': format_task_seconds(total_break_seconds),
        'total_tasks': total_tasks,
        'completed_tasks': completed_tasks_count,
        'in_progress_tasks': in_progress_tasks_count,
        'employees_with_records': active_with_records,
        'employee_count': active_with_records if is_admin else 1,
        'total_registered_employees': len(employee_users) if is_admin else 1,
        'active_projects_count': len(project_aggregates),
        'days_worked_count': len(days_worked_set),
        'avg_daily_work_hours': round(effective_work_hours / max(1, len(days_worked_set)), 2) if days_worked_set else 0
    }

    available_employees = []
    if is_admin:
        available_employees = [
            {'id': u.id, 'employee_id': u.employee_id or f"EMP{u.id:03d}", 'name': f"{u.first_name} {u.last_name}".strip() or u.username}
            for u in employee_users
        ]

    all_known_projects = sorted(list(set(
        t.get('project_name', '').strip()
        for t in storage.get_all_tasks()
        if t.get('project_name')
    )))

    return Response({
        'user_role': user.role,
        'is_admin': is_admin,
        'date_range': {
            'start_date': d_start_str,
            'end_date': d_end_str,
            'period': period
        },
        'summary': summary,
        'daily_trend': daily_trend,
        'by_project': by_project,
        'by_employee': by_employee,
        'by_task': by_task,
        'filters': {
            'employees': available_employees,
            'projects': all_known_projects
        }
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_analytics_dashboard_view(request):
    """
    Dedicated Admin Panel Analytics API.
    Strictly forbids non-admin users with 403 Forbidden.
    """
    if request.user.role != 'ADMIN':
        return Response({'error': 'Access denied. Administrator privileges required.'}, status=403)
    return analytics_dashboard_view(getattr(request, '_request', request))


# ==============================================================================
# PROJECT & TASK PROGRESS - CONNECTED EMPLOYEE & ADMIN MODULE
# ==============================================================================

def sync_tasklogs_to_projects():
    """
    Ensures that historical TaskLog entries are synchronized to canonical
    Project, ProjectTask, and WorkSession instances while preserving original creation timestamps.
    Thread-safe to prevent race-condition duplicates.
    """
    try:
        with storage._lock:
            unlinked_logs = TaskLog.objects.filter(
                models.Q(project_id__isnull=True) | models.Q(project_id='') |
                models.Q(project_task_id__isnull=True) | models.Q(project_task_id='')
            )
            if not unlinked_logs.exists():
                return

            for tlog in unlinked_logs:
                pname = (tlog.project_name or 'General').strip()
                tname = (tlog.task_name or 'General Task').strip()
                user_obj = User.objects.filter(id=tlog.user_id).first()

                t_orig_created = None
                if tlog.created_at:
                    try:
                        t_orig_created = datetime.fromisoformat(tlog.created_at.replace("Z", "+00:00"))
                    except Exception:
                        pass
                if not t_orig_created and tlog.start_time:
                    try:
                        t_orig_created = datetime.fromisoformat(tlog.start_time.replace("Z", "+00:00"))
                    except Exception:
                        pass

                # 1. Project (case-insensitive lookup, thread-safe)
                project = Project.objects.filter(name__iexact=pname).first()
                if not project:
                    project = Project.objects.create(
                        name=pname,
                        description=f"Project for {pname}",
                        created_by=user_obj,
                        status='IN_PROGRESS'
                    )
                    if t_orig_created:
                        Project.objects.filter(project_id=project.project_id).update(created_at=t_orig_created)
                
                # 2. ProjectTask
                ptask = ProjectTask.objects.filter(
                    project=project,
                    assigned_to_id=tlog.user_id,
                    title__iexact=tname
                ).first()

                t_status = 'COMPLETED' if (tlog.status == 'COMPLETED' or tlog.is_explicit_completed) else 'IN_PROGRESS'
                t_comp_at = None
                if t_status == 'COMPLETED':
                    if tlog.completed_at:
                        try:
                            t_comp_at = datetime.fromisoformat(tlog.completed_at.replace("Z", "+00:00"))
                        except Exception:
                            t_comp_at = datetime.now(timezone.utc)
                    else:
                        t_comp_at = datetime.now(timezone.utc)

                t_first_started = None
                if tlog.start_time:
                    try:
                        t_first_started = datetime.fromisoformat(tlog.start_time.replace("Z", "+00:00"))
                    except Exception:
                        pass

                if not ptask:
                    ptask = ProjectTask.objects.create(
                        project=project,
                        title=tname,
                        description=tlog.description or '',
                        assigned_to_id=tlog.user_id,
                        status=t_status,
                        completed_at=t_comp_at,
                        completed_by=user_obj if t_status == 'COMPLETED' else None,
                        first_started_at=t_first_started,
                        total_duration_seconds=tlog.duration_seconds
                    )
                    if t_orig_created:
                        ProjectTask.objects.filter(task_id=ptask.task_id).update(created_at=t_orig_created)
                else:
                    if t_status == 'COMPLETED' and ptask.status != 'COMPLETED':
                        ptask.status = 'COMPLETED'
                        ptask.completed_at = t_comp_at
                        ptask.completed_by = user_obj
                    if t_first_started and (not ptask.first_started_at or t_first_started < ptask.first_started_at):
                        ptask.first_started_at = t_first_started
                    ptask.save()
                    if t_orig_created and (not ptask.created_at or t_orig_created < ptask.created_at):
                        ProjectTask.objects.filter(task_id=ptask.task_id).update(created_at=t_orig_created)

                if t_first_started and (not project.first_started_at or t_first_started < project.first_started_at):
                    project.first_started_at = t_first_started
                    project.save(update_fields=['first_started_at'])

                tlog.project_id = project.project_id
                tlog.project_task_id = ptask.task_id
                tlog.save(update_fields=['project_id', 'project_task_id'])
    except Exception:
        pass


def format_ist_unambiguous_date(dt_or_date):
    """Formats date into unambiguous format like '04 Nov 2026' in Asia/Kolkata timezone."""
    if not dt_or_date:
        return None
    try:
        if isinstance(dt_or_date, datetime):
            return dt_or_date.astimezone(IST_TZ).strftime('%d %b %Y')
        if isinstance(dt_or_date, date):
            return dt_or_date.strftime('%d %b %Y')
        if isinstance(dt_or_date, str):
            clean_str = dt_or_date.replace("Z", "+00:00")
            if 'T' in clean_str:
                return datetime.fromisoformat(clean_str).astimezone(IST_TZ).strftime('%d %b %Y')
            return datetime.strptime(clean_str[:10], '%Y-%m-%d').strftime('%d %b %Y')
    except Exception:
        pass
    return str(dt_or_date)


def format_ist_unambiguous_datetime(dt_or_str):
    """Formats timestamp into unambiguous format like '04 Nov 2026, 02:30 PM' in Asia/Kolkata timezone."""
    if not dt_or_str:
        return None
    try:
        if isinstance(dt_or_str, datetime):
            return dt_or_str.astimezone(IST_TZ).strftime('%d %b %Y, %I:%M %p')
        if isinstance(dt_or_str, str):
            clean_str = dt_or_str.replace("Z", "+00:00")
            return datetime.fromisoformat(clean_str).astimezone(IST_TZ).strftime('%d %b %Y, %I:%M %p')
    except Exception:
        pass
    return str(dt_or_str)


def parse_project_period_bounds(params, now_utc=None):
    """
    Parses 'View Period' parameter for Project Progress Hub:
    - today (default): Today in Asia/Kolkata [00:00:00, 24:00:00)
    - specific: Specific Date in Asia/Kolkata [00:00:00, 24:00:00)
    - weekly: Monday 00:00:00 to Sunday 24:00:00 (end boundary exclusive: next Monday 00:00:00)
    - monthly: 1st of month to last of month 24:00:00 (end boundary exclusive: 1st of next month 00:00:00)
    - custom: Start Date to End Date 24:00:00 (end boundary exclusive: (End Date + 1) 00:00:00)
    - all: All historical records (start_utc=None, end_utc=None)

    Returns:
      (period_type, start_utc, end_utc, label, range_display, d_start, d_end)
    """
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    today_ist = now_utc.astimezone(IST_TZ).date()

    period_type = (params.get('period') or 'today').strip().lower()

    if period_type == 'all':
        return ('all', None, None, 'All Time', 'All Historical Activity', None, None)

    if period_type == 'specific':
        date_str = (params.get('date') or today_ist.isoformat()).strip()
        try:
            d = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            d = today_ist
        start_utc = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        end_utc = start_utc + timedelta(days=1)
        label = d.strftime('%d %b %Y')
        range_display = d.strftime('%d %b %Y')
        return ('specific', start_utc, end_utc, label, range_display, d, d)

    if period_type == 'weekly':
        ref_str = (params.get('week_start') or params.get('date') or today_ist.isoformat()).strip()
        try:
            ref_d = datetime.strptime(ref_str, '%Y-%m-%d').date()
        except ValueError:
            ref_d = today_ist
        # Monday - Sunday in Asia/Kolkata
        monday = ref_d - timedelta(days=ref_d.weekday())
        sunday = monday + timedelta(days=6)
        start_utc = datetime(monday.year, monday.month, monday.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        end_utc = datetime(sunday.year, sunday.month, sunday.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc) + timedelta(days=1)
        label = f"Week of {monday.strftime('%d %b %Y')} – {sunday.strftime('%d %b %Y')}"
        range_display = f"{monday.strftime('%d %b %Y')} – {sunday.strftime('%d %b %Y')}"
        return ('weekly', start_utc, end_utc, label, range_display, monday, sunday)

    if period_type == 'monthly':
        try:
            m = int(params.get('month') or today_ist.month)
            y = int(params.get('year') or today_ist.year)
            num_days = calendar.monthrange(y, m)[1]
            d_start = date(y, m, 1)
            d_end = date(y, m, num_days)
        except (ValueError, TypeError):
            m = today_ist.month
            y = today_ist.year
            num_days = calendar.monthrange(y, m)[1]
            d_start = date(y, m, 1)
            d_end = date(y, m, num_days)
        start_utc = datetime(d_start.year, d_start.month, d_start.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        end_utc = datetime(d_end.year, d_end.month, d_end.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc) + timedelta(days=1)
        label = d_start.strftime('%B %Y')
        range_display = f"{d_start.strftime('%d %b %Y')} – {d_end.strftime('%d %b %Y')}"
        return ('monthly', start_utc, end_utc, label, range_display, d_start, d_end)

    if period_type == 'custom':
        s_str = (params.get('start_date') or today_ist.isoformat()).strip()
        e_str = (params.get('end_date') or s_str).strip()
        try:
            d_start = datetime.strptime(s_str, '%Y-%m-%d').date()
        except ValueError:
            d_start = today_ist
        try:
            d_end = datetime.strptime(e_str, '%Y-%m-%d').date()
        except ValueError:
            d_end = d_start
        if d_start > d_end:
            d_start, d_end = d_end, d_start
        start_utc = datetime(d_start.year, d_start.month, d_start.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        end_utc = datetime(d_end.year, d_end.month, d_end.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc) + timedelta(days=1)
        label = f"{d_start.strftime('%d %b %Y')} – {d_end.strftime('%d %b %Y')}"
        range_display = f"{d_start.strftime('%d %b %Y')} – {d_end.strftime('%d %b %Y')}"
        return ('custom', start_utc, end_utc, label, range_display, d_start, d_end)

    # Default 'today'
    start_utc = datetime(today_ist.year, today_ist.month, today_ist.day, 0, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
    end_utc = start_utc + timedelta(days=1)
    label = f"{today_ist.strftime('%d %b %Y')} (Today)"
    range_display = f"{today_ist.strftime('%d %b %Y')}"
    return ('today', start_utc, end_utc, label, range_display, today_ist, today_ist)


def extract_task_period_sessions_and_duration(t, period_start_utc, period_end_utc, now_utc_dt=None, filter_user_id=None):
    """
    Computes duration of work done within [period_start_utc, period_end_utc) (Asia/Kolkata boundary)
    and collects work sessions that overlap this window.
    Strictly splits boundary-crossing sessions and excludes break durations.
    """
    if now_utc_dt is None:
        now_utc_dt = datetime.now(timezone.utc)

    period_sessions = []
    task_period_seconds = 0

    all_sessions = list(t.work_sessions.all())
    all_sessions.sort(key=lambda s: s.start_time or '', reverse=True)

    for s in all_sessions:
        if filter_user_id is not None and s.user_id != filter_user_id:
            continue

        seg_seconds = 0
        has_overlap = False

        if period_start_utc is None:
            # All Time
            seg_seconds = s.duration_seconds
            if s.status == 'IN_PROGRESS':
                seg_start_str = s.current_segment_start or s.start_time
                if seg_start_str:
                    try:
                        dt_s = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                        seg_seconds += max(0, int((now_utc_dt - dt_s).total_seconds()))
                    except Exception:
                        pass
            has_overlap = True
        else:
            # 1. Segment-level calculation if present (strictly excludes breaks)
            if s.work_segments and isinstance(s.work_segments, list):
                for seg in s.work_segments:
                    start_str = seg.get('start_time') or seg.get('start')
                    end_str = seg.get('end_time') or seg.get('end')
                    if start_str and end_str:
                        try:
                            dt_s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                            dt_e = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                            ov_s = max(dt_s, period_start_utc)
                            ov_e = min(dt_e, period_end_utc)
                            if ov_e > ov_s:
                                seg_seconds += int((ov_e - ov_s).total_seconds())
                                has_overlap = True
                        except Exception:
                            pass

            # 2. Ongoing running segment if active
            if s.status == 'IN_PROGRESS':
                seg_start_str = s.current_segment_start or s.start_time
                if seg_start_str:
                    try:
                        dt_s = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                        dt_e = min(now_utc_dt, period_end_utc)
                        ov_s = max(dt_s, period_start_utc)
                        if dt_e > ov_s:
                            seg_seconds += int((dt_e - ov_s).total_seconds())
                            has_overlap = True
                    except Exception:
                        pass

            # 3. Fallback to session interval if segments were not stored
            if not has_overlap and s.start_time:
                try:
                    dt_s = datetime.fromisoformat(s.start_time.replace("Z", "+00:00"))
                    if s.end_time:
                        dt_e = datetime.fromisoformat(s.end_time.replace("Z", "+00:00"))
                    elif s.status == 'IN_PROGRESS':
                        dt_e = min(now_utc_dt, period_end_utc)
                    else:
                        dt_e = dt_s + timedelta(seconds=s.duration_seconds)
                    ov_s = max(dt_s, period_start_utc)
                    ov_e = min(dt_e, period_end_utc)
                    if ov_e > ov_s:
                        seg_seconds += int((ov_e - ov_s).total_seconds())
                        has_overlap = True
                except Exception:
                    pass

        if has_overlap:
            task_period_seconds += seg_seconds
            u = getattr(s, 'user', None)
            u_name = f"{u.first_name} {u.last_name}".strip() if u else ""
            if not u_name and u:
                u_name = u.username

            date_display = format_ist_unambiguous_date(s.date)

            start_time_display = None
            if s.start_time:
                try:
                    dt = datetime.fromisoformat(s.start_time.replace("Z", "+00:00")).astimezone(IST_TZ)
                    start_time_display = dt.strftime('%I:%M %p')
                except Exception:
                    start_time_display = s.start_time

            end_time_display = None
            if s.end_time:
                try:
                    dt = datetime.fromisoformat(s.end_time.replace("Z", "+00:00")).astimezone(IST_TZ)
                    end_time_display = dt.strftime('%I:%M %p')
                except Exception:
                    end_time_display = s.end_time

            period_sessions.append({
                'session_id': s.session_id,
                'user_id': s.user_id,
                'user_name': u_name or 'Employee',
                'date': str(s.date),
                'date_display': date_display,
                'start_time': s.start_time,
                'start_time_display': start_time_display,
                'end_time': s.end_time,
                'end_time_display': end_time_display,
                'duration_seconds': seg_seconds if (period_start_utc is not None and seg_seconds > 0) else s.duration_seconds,
                'status': s.status,
                'work_segments': s.work_segments
            })

    return task_period_seconds, period_sessions


def extract_task_today_sessions_and_duration(t, today_start_utc, today_end_utc, target_ist_date, now_utc_dt):
    """Legacy helper delegated to extract_task_period_sessions_and_duration."""
    return extract_task_period_sessions_and_duration(t, today_start_utc, today_end_utc, now_utc_dt=now_utc_dt)


def serialize_project_summary(p, preloaded_tasks=None, period_bounds=None, filter_user_id=None, now_utc_dt=None):
    """
    Serializes project statistics, distinguishing lifetime tracked metrics from selected period activity.
    Labels current overall progress clearly and calculates employee progress when filtered.
    """
    if now_utc_dt is None:
        now_utc_dt = datetime.now(timezone.utc)

    tasks_all = preloaded_tasks if preloaded_tasks is not None else list(
        p.tasks.select_related('assigned_to', 'completed_by').prefetch_related('work_sessions__user', 'progress_notes__author')
    )
    total_tasks = len(tasks_all)
    completed_tasks = sum(1 for t in tasks_all if t.status == 'COMPLETED')
    has_started = any(t.status == 'IN_PROGRESS' or (t.first_started_at is not None) for t in tasks_all)

    if p.status == 'COMPLETED':
        status_code = 'COMPLETED'
    elif total_tasks == 0:
        status_code = 'NO_TASKS'
    elif completed_tasks == total_tasks:
        status_code = 'ALL_RECORDED_COMPLETED'
    elif has_started or completed_tasks > 0:
        status_code = 'IN_PROGRESS'
    else:
        status_code = 'NOT_STARTED'

    lifetime_seconds = sum(t.total_duration_seconds for t in tasks_all)
    completion_percentage = round((completed_tasks / total_tasks) * 100.0, 1) if total_tasks > 0 else None

    if total_tasks == 0:
        label = 'No tasks recorded'
    elif completed_tasks == total_tasks:
        label = 'All tasks completed'
    else:
        label = f"{completed_tasks} of {total_tasks} tasks completed"

    assigned_map = {}
    for t in tasks_all:
        u = t.assigned_to
        if u and u.id not in assigned_map:
            assigned_map[u.id] = {
                'id': u.id,
                'name': f"{u.first_name} {u.last_name}".strip() or u.username,
                'employee_id': getattr(u, 'employee_id', '') or f"EMP{u.id:03d}",
                'email': u.email,
                'department': u.department
            }
    assigned_employees = list(assigned_map.values())

    first_start = p.first_started_at
    if not first_start:
        earliest = min((t.first_started_at for t in tasks_all if t.first_started_at), default=None)
        if earliest:
            first_start = earliest

    started_at_display = None
    if first_start:
        started_at_display = f"Started at {format_ist_unambiguous_datetime(first_start)}"

    status_display_map = {
        'ALL_RECORDED_COMPLETED': 'All Recorded Tasks Completed',
        'READY_FOR_CLOSURE': 'All Recorded Tasks Completed',
        'COMPLETED': 'All Recorded Tasks Completed',
        'IN_PROGRESS': 'In Progress',
        'NOT_STARTED': 'Not Started',
        'NO_TASKS': 'Not Started'
    }
    status_display = status_display_map.get(status_code, 'Not Started')

    closed_by_name = None
    if getattr(p, 'closed_by', None):
        closed_by_name = f"{p.closed_by.first_name} {p.closed_by.last_name}".strip() or p.closed_by.username

    # Selected Employee's Progress (if filter_user_id is active)
    employee_progress = None
    emp_tasks = [t for t in tasks_all if t.assigned_to_id == filter_user_id] if filter_user_id else []
    if filter_user_id:
        emp_total = len(emp_tasks)
        emp_comp = sum(1 for t in emp_tasks if t.status == 'COMPLETED')
        emp_pct = round((emp_comp / emp_total) * 100.0, 1) if emp_total > 0 else None
        emp_user_obj = next((t.assigned_to for t in emp_tasks if t.assigned_to), None)
        emp_name = f"{emp_user_obj.first_name} {emp_user_obj.last_name}".strip() if emp_user_obj else 'Selected Employee'
        employee_progress = {
            'user_id': filter_user_id,
            'employee_name': emp_name,
            'total_tasks': emp_total,
            'completed_tasks': emp_comp,
            'completion_percentage': emp_pct,
            'completion_label': f"{emp_comp} of {emp_total} tasks completed" if emp_total > 0 else 'No tasks assigned'
        }

    # Period Activity Metrics
    period_start_utc = None
    period_end_utc = None
    period_type = 'all'
    if period_bounds:
        period_type, period_start_utc, period_end_utc = period_bounds[0], period_bounds[1], period_bounds[2]

    period_tracked_seconds = 0
    period_tasks_worked_ids = set()
    period_tasks_started_ids = set()
    period_tasks_completed_ids = set()
    period_active_tasks_ids = set()

    for t in tasks_all:
        # If employee filter is active, only consider contributions from that employee
        if filter_user_id is not None and t.assigned_to_id != filter_user_id:
            has_emp_sess = any(s.user_id == filter_user_id for s in t.work_sessions.all())
            has_emp_note = any(n.author_id == filter_user_id for n in t.progress_notes.all())
            if not has_emp_sess and not has_emp_note:
                continue

        # 1. Work sessions
        t_sec, t_sessions = extract_task_period_sessions_and_duration(
            t, period_start_utc, period_end_utc, now_utc_dt=now_utc_dt, filter_user_id=filter_user_id
        )
        if t_sec > 0 or len(t_sessions) > 0:
            period_tracked_seconds += t_sec
            period_tasks_worked_ids.add(t.task_id)
            period_active_tasks_ids.add(t.task_id)

        # 2. First started in period
        if t.first_started_at:
            if period_start_utc is None or (period_start_utc <= t.first_started_at < period_end_utc):
                period_tasks_started_ids.add(t.task_id)
                period_active_tasks_ids.add(t.task_id)

        # 3. Completed in period
        if t.completed_at:
            if period_start_utc is None or (period_start_utc <= t.completed_at < period_end_utc):
                period_tasks_completed_ids.add(t.task_id)
                period_active_tasks_ids.add(t.task_id)

        # 4. Created in period
        if t.created_at:
            if period_start_utc is None or (period_start_utc <= t.created_at < period_end_utc):
                period_active_tasks_ids.add(t.task_id)

        # 5. Progress notes in period
        for n in t.progress_notes.all():
            if filter_user_id is not None and n.author_id != filter_user_id:
                continue
            if period_start_utc is None or (period_start_utc <= n.created_at < period_end_utc):
                period_active_tasks_ids.add(t.task_id)
                break

    if period_type == 'all':
        if filter_user_id:
            has_period_activity = (len(emp_tasks) > 0 or len(period_active_tasks_ids) > 0)
            period_tracked_seconds = sum(t.total_duration_seconds for t in emp_tasks)
        else:
            has_period_activity = True
            period_tracked_seconds = lifetime_seconds
    else:
        has_period_activity = len(period_active_tasks_ids) > 0

    return {
        'project_id': p.project_id,
        'name': p.name,
        'description': p.description,
        'status': status_code,
        'status_display': status_display,
        'current_status': status_code,
        'current_status_display': status_display,
        'stored_status': p.status,
        'deadline': p.deadline.isoformat() if p.deadline else None,
        'deadline_display': format_ist_unambiguous_date(p.deadline),
        'first_started_at': first_start.isoformat() if first_start else None,
        'started_at_display': started_at_display,
        'closed_at': p.closed_at.isoformat() if p.closed_at else None,
        'closed_by': closed_by_name,
        'reopen_reason': p.reopen_reason,
        'created_at': p.created_at.isoformat() if p.created_at else None,
        'created_at_display': format_ist_unambiguous_date(p.created_at),
        'updated_at': p.updated_at.isoformat() if p.updated_at else None,
        # Overall Project Progress (Current Overall Progress)
        'total_tasks': total_tasks,
        'completed_tasks': completed_tasks,
        'completion_percentage': completion_percentage,
        'completion_label': label,
        'total_tracked_seconds': lifetime_seconds,
        'lifetime_tracked_seconds': lifetime_seconds,
        'lifetime_tracked_hours': round(lifetime_seconds / 3600.0, 1),
        # Employee Progress (when employee filter is active)
        'employee_progress': employee_progress,
        # Period Activity Metrics
        'period_tracked_seconds': period_tracked_seconds,
        'period_tracked_hours': round(period_tracked_seconds / 3600.0, 1),
        'period_tasks_worked_count': len(period_tasks_worked_ids),
        'period_tasks_started_count': len(period_tasks_started_ids),
        'period_tasks_completed_count': len(period_tasks_completed_ids),
        'period_active_tasks_count': len(period_active_tasks_ids),
        'has_period_activity': has_period_activity,
        'assigned_employees': assigned_employees
    }


def serialize_task_item(t, current_user=None, today_bounds=None, project_status=None, period_bounds=None, filter_user_id=None):
    """
    Serializes a ProjectTask with its sessions, notes, live active timer, and period metrics.
    Dates are formatted unambiguously in Asia/Kolkata (e.g. '04 Nov 2026').
    """
    now_utc_dt = datetime.now(timezone.utc)

    # Active session check using prefetched list if available
    all_sessions = list(t.work_sessions.all())
    active_session = next((s for s in all_sessions if s.status in ['IN_PROGRESS', 'PAUSED']), None)

    active_session_obj = None
    if active_session:
        elapsed_sec = active_session.duration_seconds
        if active_session.status == 'IN_PROGRESS':
            seg_start_str = active_session.current_segment_start or active_session.start_time
            if seg_start_str:
                try:
                    s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                    elapsed_sec += max(0, int((now_utc_dt - s_dt).total_seconds()))
                except Exception:
                    pass
        u = getattr(active_session, 'user', None)
        u_name = f"{u.first_name} {u.last_name}".strip() if u else ""
        if not u_name and u:
            u_name = u.username
        active_session_obj = {
            'session_id': active_session.session_id,
            'user_id': active_session.user_id,
            'user_name': u_name,
            'date': str(active_session.date),
            'date_display': format_ist_unambiguous_date(active_session.date),
            'status': active_session.status,
            'start_time': active_session.start_time,
            'current_segment_start': active_session.current_segment_start,
            'elapsed_seconds': elapsed_sec
        }

    # Assigned user info
    assigned_user = None
    if t.assigned_to:
        u = t.assigned_to
        assigned_user = {
            'id': u.id,
            'name': f"{u.first_name} {u.last_name}".strip() or u.username,
            'employee_id': getattr(u, 'employee_id', '') or f"EMP{u.id:03d}",
            'email': u.email,
            'department': u.department
        }

    # Notes (sorted in memory without re-querying DB)
    all_notes = list(t.progress_notes.all())
    all_notes.sort(key=lambda n: n.created_at, reverse=True)
    notes = [
        {
            'note_id': n.note_id,
            'author_id': n.author_id,
            'author_name': n.author_name,
            'content': n.content,
            'created_at': n.created_at.isoformat(),
            'created_at_display': format_ist_unambiguous_datetime(n.created_at)
        }
        for n in all_notes
    ]

    # Period duration & sessions calculation
    period_sec = 0
    period_sessions = []
    if period_bounds:
        p_type, p_start_utc, p_end_utc = period_bounds[0], period_bounds[1], period_bounds[2]
        period_sec, period_sessions = extract_task_period_sessions_and_duration(
            t, p_start_utc, p_end_utc, now_utc_dt=now_utc_dt, filter_user_id=filter_user_id
        )

    # Sessions history & today duration calculation
    if today_bounds:
        today_start_utc, today_end_utc, target_ist_date = today_bounds
        today_sec, today_sessions = extract_task_period_sessions_and_duration(
            t, today_start_utc, today_end_utc, now_utc_dt=now_utc_dt
        )
        sessions_history = today_sessions
        today_duration_seconds = today_sec
    elif period_bounds:
        sessions_history = period_sessions
        today_duration_seconds = period_sec
    else:
        all_sessions_sorted = sorted(all_sessions, key=lambda s: s.start_time or '', reverse=True)[:20]
        sessions_history = [
            {
                'session_id': s.session_id,
                'user_id': s.user_id,
                'user_name': f"{s.user.first_name} {s.user.last_name}".strip() if getattr(s, 'user', None) else (s.user.username if getattr(s, 'user', None) else ''),
                'date': str(s.date),
                'date_display': format_ist_unambiguous_date(s.date),
                'start_time': s.start_time,
                'end_time': s.end_time,
                'duration_seconds': s.duration_seconds,
                'status': s.status,
                'work_segments': s.work_segments
            }
            for s in all_sessions_sorted
        ]
        today_duration_seconds = t.total_duration_seconds

    is_overdue = bool(t.deadline and t.status != 'COMPLETED' and now_utc_dt > t.deadline)
    p_status = project_status if project_status is not None else t.project.compute_status()

    return {
        'task_id': t.task_id,
        'project_id': t.project_id if hasattr(t, 'project_id') else t.project.project_id,
        'project_name': t.project.name,
        'project_status': p_status,
        'project_deadline': t.project.deadline.isoformat() if t.project.deadline else None,
        'title': t.title,
        'description': t.description,
        'status': t.status,
        'deadline': t.deadline.isoformat() if t.deadline else None,
        'deadline_display': format_ist_unambiguous_date(t.deadline),
        'is_overdue': is_overdue,
        'assigned_to': assigned_user,
        'first_started_at': t.first_started_at.isoformat() if t.first_started_at else None,
        'first_started_at_display': format_ist_unambiguous_datetime(t.first_started_at),
        'completed_at': t.completed_at.isoformat() if t.completed_at else None,
        'completed_at_display': format_ist_unambiguous_datetime(t.completed_at),
        'completed_by': f"{t.completed_by.first_name} {t.completed_by.last_name}".strip() if t.completed_by else None,
        'reopened_at': t.reopened_at.isoformat() if t.reopened_at else None,
        'reopened_at_display': format_ist_unambiguous_datetime(t.reopened_at),
        'reopened_by': f"{t.reopened_by.first_name} {t.reopened_by.last_name}".strip() if getattr(t, 'reopened_by', None) and not isinstance(t.reopened_by, str) else (t.reopened_by or None),
        'reopen_reason': t.reopen_reason,
        'total_duration_seconds': t.total_duration_seconds,
        'period_duration_seconds': period_sec if period_bounds else t.total_duration_seconds,
        'today_duration_seconds': today_duration_seconds,
        'time_worked_today': format_task_seconds(today_duration_seconds),
        'time_worked_in_period': format_task_seconds(period_sec if period_bounds else t.total_duration_seconds),
        'active_session': active_session_obj,
        'progress_notes': notes,
        'work_sessions': sessions_history,
        'created_at': t.created_at.isoformat() if t.created_at else None,
        'created_at_display': format_ist_unambiguous_datetime(t.created_at),
        'updated_at': t.updated_at.isoformat() if t.updated_at else None
    }


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def admin_projects_list_create_view(request):
    """
    GET: List projects with completion metrics and assigned employee details.
         Admin sees all; Employee sees projects with assigned tasks.
    POST: Create a new project (Admin only).
    """
    if request.method == 'POST':
        if request.user.role != 'ADMIN':
            return Response({'error': 'Admin permissions required to create projects.'}, status=403)

        name = (request.data.get('name') or '').strip()
        description = (request.data.get('description') or '').strip()
        deadline_str = request.data.get('deadline')

        if not name:
            return Response({'error': 'Project name is required.'}, status=400)

        deadline_dt = None
        if deadline_str:
            try:
                deadline_dt = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
            except Exception:
                return Response({'error': 'Invalid deadline format. Use ISO-8601.'}, status=400)

        project = Project.objects.create(
            name=name,
            description=description,
            created_by=request.user,
            deadline=deadline_dt,
            status='NOT_STARTED'
        )

        ProjectAuditHistory.objects.create(
            project=project,
            action='PROJECT_CREATED',
            actor=request.user,
            actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
            details={'name': name}
        )

        return Response({
            'message': 'Project created successfully.',
            'project': serialize_project_summary(project)
        }, status=201)

    # GET
    sync_tasklogs_to_projects()
    qs = Project.objects.all().order_by('-created_at')

    now_utc = datetime.now(timezone.utc)
    period_bounds = parse_project_period_bounds(request.GET, now_utc)
    (period_type, period_start_utc, period_end_utc, period_label, range_display, d_start, d_end) = period_bounds

    # Employee filtering if requested specifically
    if request.user.role != 'ADMIN' and request.GET.get('only_assigned') == 'true':
        qs = qs.filter(tasks__assigned_to=request.user).distinct()

    # Query params filters
    search_q = request.GET.get('project') or request.GET.get('search')
    if search_q:
        search_q = search_q.strip()
        qs = qs.filter(models.Q(name__icontains=search_q) | models.Q(project_id__icontains=search_q))

    filter_employee = request.GET.get('employee')
    filter_user_id = None
    if filter_employee and filter_employee != 'ALL':
        try:
            filter_user_id = int(filter_employee)
        except ValueError:
            pass

    filter_status = request.GET.get('status')
    filter_deadline = request.GET.get('deadline')
    page_param = request.GET.get('page')
    page_size_param = request.GET.get('page_size')

    cache_key = f"proj_list_v2_{request.user.id}_{request.user.role}_{period_type}_{d_start}_{d_end}_{search_q}_{filter_employee}_{filter_status}_{filter_deadline}_{page_param}_{page_size_param}"
    cached_payload = cache.get(cache_key)
    if cached_payload:
        return Response(cached_payload)

    # 1. Fetch matching projects in one query
    projects_list = list(qs)
    project_ids = [p.project_id for p in projects_list]

    # 2. Batch-fetch all tasks for these projects in one query with prefetching
    tasks = list(
        ProjectTask.objects.filter(project_id__in=project_ids)
        .select_related('assigned_to', 'completed_by')
        .prefetch_related('work_sessions__user', 'progress_notes__author')
    )
    tasks_by_proj = defaultdict(list)
    for t in tasks:
        tasks_by_proj[t.project_id].append(t)

    filtered_projects = []

    for p in projects_list:
        p_tasks = tasks_by_proj[p.project_id]
        p_summary = serialize_project_summary(
            p, preloaded_tasks=p_tasks, period_bounds=period_bounds, filter_user_id=filter_user_id, now_utc_dt=now_utc
        )
        comp_status = p_summary['status']

        # Period activity matching:
        # Show projects with matching employee activity during the selected period.
        if not p_summary['has_period_activity']:
            continue

        if filter_status and filter_status != 'ALL':
            if filter_status == 'ALL_RECORDED_COMPLETED':
                if comp_status not in ['ALL_RECORDED_COMPLETED', 'READY_FOR_CLOSURE', 'COMPLETED']:
                    continue
            elif comp_status != filter_status:
                continue

        if filter_deadline:
            if filter_deadline == 'OVERDUE':
                if not (p.deadline and comp_status != 'COMPLETED' and now_utc > p.deadline):
                    continue
            elif filter_deadline == 'UPCOMING':
                if not (p.deadline and comp_status != 'COMPLETED' and now_utc <= p.deadline):
                    continue

        filtered_projects.append(p_summary)

    total_projects = len(filtered_projects)
    in_progress = sum(1 for p in filtered_projects if p['status'] == 'IN_PROGRESS')
    completed = sum(1 for p in filtered_projects if p['status'] in ['ALL_RECORDED_COMPLETED', 'READY_FOR_CLOSURE', 'COMPLETED'])
    total_tasks_worked = sum(p.get('period_tasks_worked_count', 0) for p in filtered_projects)
    total_tasks_started = sum(p.get('period_tasks_started_count', 0) for p in filtered_projects)
    total_tasks_completed = sum(p.get('period_tasks_completed_count', 0) for p in filtered_projects)
    total_period_seconds = sum(p.get('period_tracked_seconds', 0) for p in filtered_projects)
    total_lifetime_seconds = sum(p.get('lifetime_tracked_seconds', 0) for p in filtered_projects)

    summary_totals = {
        'total_projects': total_projects,
        'in_progress_projects': in_progress,
        'completed_projects': completed,
        'tasks_worked_count': total_tasks_worked,
        'tasks_started_count': total_tasks_started,
        'tasks_completed_count': total_tasks_completed,
        'period_tracked_seconds': total_period_seconds,
        'period_tracked_hours': round(total_period_seconds / 3600.0, 1),
        'total_tracked_seconds': total_lifetime_seconds,
        'total_tracked_hours': round(total_lifetime_seconds / 3600.0, 1),
        'period_info': {
            'type': period_type,
            'label': period_label,
            'range_display': range_display,
            'start_date': d_start.isoformat() if d_start else None,
            'end_date': d_end.isoformat() if d_end else None
        }
    }

    if page_param and page_size_param:
        try:
            p_num = max(1, int(page_param))
            p_size = max(1, min(100, int(page_size_param)))
            start_idx = (p_num - 1) * p_size
            paginated_projects = filtered_projects[start_idx : start_idx + p_size]
            total_pages = max(1, math.ceil(total_projects / p_size))
        except ValueError:
            paginated_projects = filtered_projects
            p_num = 1
            p_size = len(filtered_projects)
            total_pages = 1
    else:
        paginated_projects = filtered_projects
        p_num = 1
        p_size = len(filtered_projects)
        total_pages = 1

    payload = {
        'count': total_projects,
        'summary': summary_totals,
        'projects': paginated_projects,
        'page': p_num,
        'page_size': p_size,
        'total_pages': total_pages
    }
    # Short 3-second buffer to absorb rapid duplicate client requests
    cache.set(cache_key, payload, 3)

    return Response(payload)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def admin_project_detail_view(request, project_id):
    """
    GET: Detailed project view including its tasks, work sessions, progress notes,
         and employee contributions breakdown filtered by selected period.
    PATCH: Update project metadata (Admin only).
    """
    try:
        project = Project.objects.get(project_id=project_id)
    except Project.DoesNotExist:
        return Response({'error': 'Project not found.'}, status=404)

    # Permission check for employee
    if request.user.role != 'ADMIN':
        is_assigned = project.tasks.filter(assigned_to=request.user).exists()
        if not is_assigned:
            return Response({'error': 'Access denied. You are not assigned to this project.'}, status=403)

    if request.method == 'PATCH':
        if request.user.role != 'ADMIN':
            return Response({'error': 'Admin permissions required to modify project.'}, status=403)

        name = request.data.get('name')
        description = request.data.get('description')
        deadline_str = request.data.get('deadline')

        if name is not None and name.strip():
            project.name = name.strip()
        if description is not None:
            project.description = description.strip()
        if deadline_str is not None:
            if deadline_str:
                try:
                    project.deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
                except Exception:
                    return Response({'error': 'Invalid deadline format.'}, status=400)
            else:
                project.deadline = None

        project.save()
        ProjectAuditHistory.objects.create(
            project=project,
            action='PROJECT_UPDATED',
            actor=request.user,
            actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
            details={'name': project.name}
        )
        return Response({
            'message': 'Project updated successfully.',
            'project': serialize_project_summary(project)
        })

    # GET: Optimized batch load of tasks and details for the selected period & employee
    now_utc = datetime.now(timezone.utc)
    period_bounds = parse_project_period_bounds(request.GET, now_utc)
    (period_type, period_start_utc, period_end_utc, period_label, range_display, d_start, d_end) = period_bounds

    filter_employee = request.GET.get('employee')
    filter_user_id = None
    if filter_employee and filter_employee != 'ALL':
        try:
            filter_user_id = int(filter_employee)
        except ValueError:
            pass

    tasks_qs = (
        project.tasks
        .select_related('assigned_to', 'completed_by', 'project')
        .prefetch_related('progress_notes__author', 'work_sessions__user')
        .order_by('created_at')
    )
    if request.user.role != 'ADMIN':
        tasks_qs = tasks_qs.filter(assigned_to=request.user)

    tasks_list = list(tasks_qs)
    summary = serialize_project_summary(
        project, preloaded_tasks=tasks_list, period_bounds=period_bounds, filter_user_id=filter_user_id, now_utc_dt=now_utc
    )
    tasks_data = [
        serialize_task_item(
            t, current_user=request.user, project_status=summary['status'], period_bounds=period_bounds, filter_user_id=filter_user_id
        )
        for t in tasks_list
    ]

    # If employee filter is active, filter tasks_data to employee's assigned or contributed tasks
    if filter_user_id:
        tasks_data = [
            t for t in tasks_data
            if (t.get('assigned_to') and t['assigned_to']['id'] == filter_user_id) or (t.get('period_duration_seconds', 0) > 0)
        ]

    # Employee contributions aggregation in memory (both period and lifetime)
    contributions = {}
    for t in tasks_list:
        # Check sessions
        for s in t.work_sessions.all():
            uid = s.user_id
            if filter_user_id and uid != filter_user_id:
                continue
            if uid not in contributions:
                u = getattr(s, 'user', None)
                u_name = f"{u.first_name} {u.last_name}".strip() if u else (u.username if u else f"User {uid}")
                contributions[uid] = {
                    'user_id': uid,
                    'employee_name': u_name,
                    'employee_id': getattr(u, 'employee_id', '') or f"EMP{uid:03d}",
                    'department': getattr(u, 'department', '') if u else '',
                    'tasks_count': 0,
                    'completed_tasks_count': 0,
                    'total_duration_seconds': 0,
                    'period_duration_seconds': 0,
                    'period_tasks_worked': 0,
                    'period_tasks_completed': 0
                }
        if t.assigned_to:
            uid = t.assigned_to.id
            if filter_user_id and uid != filter_user_id:
                pass
            else:
                if uid not in contributions:
                    u = t.assigned_to
                    contributions[uid] = {
                        'user_id': uid,
                        'employee_name': f"{u.first_name} {u.last_name}".strip() or u.username,
                        'employee_id': getattr(u, 'employee_id', '') or f"EMP{uid:03d}",
                        'department': u.department,
                        'tasks_count': 0,
                        'completed_tasks_count': 0,
                        'total_duration_seconds': 0,
                        'period_duration_seconds': 0,
                        'period_tasks_worked': 0,
                        'period_tasks_completed': 0
                    }
                contributions[uid]['tasks_count'] += 1
                if t.status == 'COMPLETED':
                    contributions[uid]['completed_tasks_count'] += 1
                contributions[uid]['total_duration_seconds'] += t.total_duration_seconds

    # Populate period-specific metrics per employee
    for uid, c_data in contributions.items():
        emp_period_sec = 0
        emp_tasks_worked = set()
        emp_tasks_comp = set()
        for t in tasks_list:
            t_sec, s_list = extract_task_period_sessions_and_duration(t, period_start_utc, period_end_utc, now_utc_dt=now_utc, filter_user_id=uid)
            if t_sec > 0 or len(s_list) > 0:
                emp_period_sec += t_sec
                emp_tasks_worked.add(t.task_id)
            if t.completed_at and (t.completed_by_id == uid or t.assigned_to_id == uid):
                if period_start_utc is None or (period_start_utc <= t.completed_at < period_end_utc):
                    emp_tasks_comp.add(t.task_id)
        c_data['period_duration_seconds'] = emp_period_sec
        c_data['period_tasks_worked'] = len(emp_tasks_worked)
        c_data['period_tasks_completed'] = len(emp_tasks_comp)

    # All matching work sessions across tasks for the period
    all_period_sessions = []
    for t_data in tasks_data:
        for ws in t_data.get('work_sessions', []):
            ws_copy = dict(ws)
            ws_copy['task_title'] = t_data['title']
            ws_copy['task_id'] = t_data['task_id']
            all_period_sessions.append(ws_copy)
    all_period_sessions.sort(key=lambda s: s.get('start_time') or '', reverse=True)

    # All matching progress notes across tasks
    all_period_notes = []
    for t in tasks_list:
        for n in t.progress_notes.all():
            if filter_user_id and n.author_id != filter_user_id:
                continue
            if period_start_utc is None or (period_start_utc <= n.created_at < period_end_utc):
                all_period_notes.append({
                    'note_id': n.note_id,
                    'task_id': t.task_id,
                    'task_title': t.title,
                    'author_id': n.author_id,
                    'author_name': n.author_name,
                    'content': n.content,
                    'created_at': n.created_at.isoformat(),
                    'created_at_display': format_ist_unambiguous_datetime(n.created_at)
                })
    all_period_notes.sort(key=lambda n: n['created_at'], reverse=True)

    # Project Audit Records
    audit_records = list(project.audit_records.order_by('-timestamp')[:30].values(
        'audit_id', 'action', 'actor_name', 'reason', 'details', 'timestamp'
    ))
    for ar in audit_records:
        ar['timestamp_display'] = format_ist_unambiguous_datetime(ar.get('timestamp'))

    return Response({
        'project': summary,
        'tasks': tasks_data,
        'work_sessions': all_period_sessions,
        'progress_notes': all_period_notes,
        'employee_contributions': list(contributions.values()),
        'audit_records': audit_records,
        'period_info': {
            'type': period_type,
            'label': period_label,
            'range_display': range_display,
            'start_date': d_start.isoformat() if d_start else None,
            'end_date': d_end.isoformat() if d_end else None
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_project_close_view(request, project_id):
    """Admin explicitly confirms project closure."""
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)

    try:
        project = Project.objects.get(project_id=project_id)
    except Project.DoesNotExist:
        return Response({'error': 'Project not found.'}, status=404)

    now_utc_dt = datetime.now(timezone.utc)
    project.status = 'COMPLETED'
    project.closed_at = now_utc_dt
    project.closed_by = request.user
    project.save()

    ProjectAuditHistory.objects.create(
        project=project,
        action='PROJECT_CLOSED',
        actor=request.user,
        actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        details={'closed_at': now_utc_dt.isoformat()}
    )

    return Response({
        'message': 'Project closed successfully.',
        'project': serialize_project_summary(project)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_project_reopen_view(request, project_id):
    """Admin reopens a closed project. Requires mandatory reason."""
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required.'}, status=403)

    try:
        project = Project.objects.get(project_id=project_id)
    except Project.DoesNotExist:
        return Response({'error': 'Project not found.'}, status=404)

    reason = (request.data.get('reason') or '').strip()
    if not reason:
        return Response({'error': 'A mandatory reason is required to reopen this project.'}, status=400)

    project.status = 'IN_PROGRESS'
    project.reopen_reason = reason
    project.closed_at = None
    project.closed_by = None
    project.save()

    ProjectAuditHistory.objects.create(
        project=project,
        action='PROJECT_REOPENED',
        actor=request.user,
        actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        reason=reason,
        details={'reopened_at': datetime.now(timezone.utc).isoformat()}
    )

    return Response({
        'message': 'Project reopened successfully.',
        'project': serialize_project_summary(project)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_project_create_task_view(request, project_id):
    """
    Creates a new task in a project (Admin only).
    Rejects creation if project is closed until reopened.
    """
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required to create tasks.'}, status=403)

    try:
        project = Project.objects.get(project_id=project_id)
    except Project.DoesNotExist:
        return Response({'error': 'Project not found.'}, status=404)

    if project.status == 'COMPLETED':
        return Response({'error': 'Adding tasks to a closed project requires reopening it first.'}, status=400)

    title = (request.data.get('title') or '').strip()
    description = (request.data.get('description') or '').strip()
    assigned_to_id = request.data.get('assigned_to')
    deadline_str = request.data.get('deadline')

    if not title:
        return Response({'error': 'Task title is required.'}, status=400)

    assigned_user = None
    if assigned_to_id:
        try:
            assigned_user = User.objects.get(id=int(assigned_to_id))
        except User.DoesNotExist:
            return Response({'error': 'Assigned user does not exist.'}, status=404)

    deadline_dt = None
    if deadline_str:
        try:
            deadline_dt = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
        except Exception:
            return Response({'error': 'Invalid deadline format. Use ISO-8601.'}, status=400)

    task = ProjectTask.objects.create(
        project=project,
        title=title,
        description=description,
        assigned_to=assigned_user,
        deadline=deadline_dt,
        status='NOT_STARTED'
    )

    ProjectAuditHistory.objects.create(
        project=project,
        task=task,
        action='TASK_CREATED',
        actor=request.user,
        actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        details={'title': title, 'assigned_to': assigned_user.username if assigned_user else None}
    )

    return Response({
        'message': 'Task created successfully.',
        'task': serialize_task_item(task, current_user=request.user)
    }, status=201)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def project_tasks_my_tasks_view(request):
    """
    Returns tasks for 'My Projects & Tasks'.
    Employees receive tasks assigned directly to them.
    Admins can view their tasks or query across projects/employees.
    Filters to today's tasks and activity (Asia/Kolkata timezone) by default,
    or all history when all_history=true.
    """
    user = request.user
    if user.role == 'ADMIN':
        emp_filter = request.GET.get('employee_id')
        if emp_filter:
            qs = ProjectTask.objects.filter(assigned_to_id=int(emp_filter))
        else:
            qs = ProjectTask.objects.all()
    else:
        qs = ProjectTask.objects.filter(assigned_to=user)

    project_filter = request.GET.get('project_id')
    if project_filter:
        qs = qs.filter(project_id=project_filter)

    status_filter = request.GET.get('status')
    if status_filter and status_filter != 'ALL':
        qs = qs.filter(status=status_filter)

    all_history = request.GET.get('all_history') == 'true' or request.GET.get('scope') == 'all'

    # Calculate IST today boundaries: [today at 00:00, tomorrow at 00:00) IST
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST_TZ)
    target_date_str = request.GET.get('date')
    if target_date_str:
        try:
            parts = [int(p) for p in target_date_str.split('-')]
            target_ist_date = date(parts[0], parts[1], parts[2])
        except Exception:
            target_ist_date = now_ist.date()
    else:
        target_ist_date = now_ist.date()

    day_start_ist = datetime(target_ist_date.year, target_ist_date.month, target_ist_date.day, 0, 0, 0, tzinfo=IST_TZ)
    day_end_ist = day_start_ist + timedelta(days=1)
    day_start_utc = day_start_ist.astimezone(timezone.utc)
    day_end_utc = day_end_ist.astimezone(timezone.utc)
    today_bounds = (day_start_utc, day_end_utc, target_ist_date)

    seen_task_ids = set()
    tasks_data = []
    for t in qs.order_by('-created_at', '-updated_at'):
        # Stable task ID deduplication
        if t.task_id in seen_task_ids:
            continue
        seen_task_ids.add(t.task_id)

        if not all_history:
            # Exact visibility rule:
            # Show a task only when its original created_at falls between today at 00:00 IST
            # and tomorrow at 00:00 IST, with the end boundary excluded.
            # Hide tasks created on previous dates, regardless of their current status.
            # Do not include older tasks because they were updated, resumed, reopened, or completed today.
            orig_created_at = t.created_at
            tlog = TaskLog.objects.filter(project_task_id=t.task_id).order_by('created_at').first()
            if not tlog:
                tlog = TaskLog.objects.filter(task_name__iexact=t.title, project_name__iexact=t.project.name).order_by('created_at').first()
            if tlog and tlog.created_at:
                try:
                    tlog_dt = datetime.fromisoformat(tlog.created_at.replace("Z", "+00:00"))
                    if orig_created_at is None or tlog_dt < orig_created_at:
                        orig_created_at = tlog_dt
                except Exception:
                    pass

            if not orig_created_at or not (day_start_utc <= orig_created_at < day_end_utc):
                continue

        serialized = serialize_task_item(t, current_user=user, today_bounds=today_bounds if not all_history else None)
        tasks_data.append(serialized)

    project_map = {}
    for item in tasks_data:
        pid = item['project_id']
        if pid not in project_map:
            project_map[pid] = {
                'project_id': pid,
                'name': item['project_name'],
                'status': item['project_status'],
                'deadline': item['project_deadline']
            }
    projects_data = list(project_map.values())

    total_work_seconds_today = sum(t.get('today_duration_seconds', 0) for t in tasks_data)
    summary_data = {
        'total_tasks': len(tasks_data),
        'not_started': sum(1 for t in tasks_data if t['status'] == 'NOT_STARTED'),
        'in_progress': sum(1 for t in tasks_data if t['status'] == 'IN_PROGRESS'),
        'completed': sum(1 for t in tasks_data if t['status'] == 'COMPLETED'),
        'total_work_seconds_today': total_work_seconds_today,
        'total_work_today_formatted': format_task_seconds(total_work_seconds_today),
    }

    return Response({
        'count': len(tasks_data),
        'tasks': tasks_data,
        'projects': projects_data,
        'summary': summary_data,
        'date': target_ist_date.isoformat(),
        'timezone': 'Asia/Kolkata'
    })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def project_task_detail_update_view(request, task_id):
    """Admin updates task title, description, assigned employee, or deadline."""
    if request.user.role != 'ADMIN':
        return Response({'error': 'Admin permissions required to modify task details.'}, status=403)

    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if task.project.status == 'COMPLETED':
        return Response({'error': 'Modifying tasks in a closed project requires reopening it first.'}, status=400)

    title = request.data.get('title')
    description = request.data.get('description')
    assigned_to_id = request.data.get('assigned_to')
    deadline_str = request.data.get('deadline')

    if title is not None and title.strip():
        task.title = title.strip()
    if description is not None:
        task.description = description.strip()
    if assigned_to_id is not None:
        if assigned_to_id:
            try:
                task.assigned_to = User.objects.get(id=int(assigned_to_id))
            except User.DoesNotExist:
                return Response({'error': 'Assigned user does not exist.'}, status=404)
        else:
            task.assigned_to = None

    if deadline_str is not None:
        if deadline_str:
            try:
                task.deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
            except Exception:
                return Response({'error': 'Invalid deadline format.'}, status=400)
        else:
            task.deadline = None

    task.save()
    ProjectAuditHistory.objects.create(
        project=task.project,
        task=task,
        action='TASK_UPDATED',
        actor=request.user,
        actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        details={'title': task.title}
    )
    return Response({
        'message': 'Task updated successfully.',
        'task': serialize_task_item(task, current_user=request.user)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_task_start_view(request, task_id):
    """
    Starts or resumes work on an assigned task.
    - Transitions 'Not Started' -> 'In Progress'.
    - Rejects completed tasks: prevent time logging on completed tasks.
    - Closes/pauses any conflicting active timers for this user.
    - Atomically creates or resumes a WorkSession and syncs with TaskLog.
    """
    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if request.user.role != 'ADMIN' and task.assigned_to_id != request.user.id:
        return Response({'error': 'Access denied. You can only track time on tasks assigned to you.'}, status=403)

    if task.status == 'COMPLETED':
        return Response({'error': 'Cannot log time on a completed task. Contact admin to reopen it.'}, status=400)

    if task.project.status == 'COMPLETED':
        return Response({'error': 'Cannot work on a task in a closed project. Contact admin to reopen the project.'}, status=400)

    now_utc_dt = datetime.now(timezone.utc)
    now_utc_str = now_utc_dt.isoformat().replace("+00:00", "Z")
    today_ist = now_utc_dt.astimezone(IST_TZ).date().isoformat()

    # 1. Close/Pause any other active WorkSessions for this user across all tasks
    conflicting_sessions = WorkSession.objects.filter(user=request.user, status='IN_PROGRESS').exclude(task=task)
    for cs in conflicting_sessions:
        seg_start_str = cs.current_segment_start or cs.start_time
        seg_sec = 0
        if seg_start_str:
            try:
                s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                seg_sec = max(0, int((now_utc_dt - s_dt).total_seconds()))
            except Exception:
                pass
        cs.duration_seconds += seg_sec
        cs.task.total_duration_seconds += seg_sec
        cs.task.save(update_fields=['total_duration_seconds', 'updated_at'])
        segs = list(cs.work_segments or [])
        segs.append({'start_time': seg_start_str, 'end_time': now_utc_str, 'duration_seconds': seg_sec})
        cs.work_segments = segs
        cs.current_segment_start = None
        cs.end_time = now_utc_str
        cs.status = 'ENDED'
        cs.updated_at = now_utc_str
        cs.save()
        if cs.task_log_id:
            TaskLog.objects.filter(task_id=cs.task_log_id).update(
                status='ENDED', end_time=now_utc_str, duration_seconds=cs.duration_seconds,
                work_segments=cs.work_segments, current_segment_start=None, updated_at=now_utc_str
            )

    # 2. End any generic legacy task running for user
    storage.end_any_active_task_for_user(request.user.id, now_utc_str)

    # 3. Task status transition
    if task.status == 'NOT_STARTED':
        task.status = 'IN_PROGRESS'
    if not task.first_started_at:
        task.first_started_at = now_utc_dt
    if not task.project.first_started_at:
        task.project.first_started_at = now_utc_dt
        task.project.save(update_fields=['first_started_at'])
    task.save()

    # 4. Resume existing paused session or create new session
    paused_session = WorkSession.objects.filter(task=task, user=request.user, status='PAUSED').first()
    if paused_session:
        paused_session.status = 'IN_PROGRESS'
        paused_session.current_segment_start = now_utc_str
        paused_session.updated_at = now_utc_str
        paused_session.save()
        session = paused_session
    else:
        session = WorkSession.objects.create(
            task=task,
            user=request.user,
            date=today_ist,
            start_time=now_utc_str,
            current_segment_start=now_utc_str,
            status='IN_PROGRESS',
            work_segments=[],
            created_at=now_utc_str,
            updated_at=now_utc_str
        )

    # 5. Maintain synced TaskLog record for live reports and daily tracking
    task_log_id = str(uuid.uuid4())
    emp_code = getattr(request.user, 'employee_id', '') or f"EMP{request.user.id:03d}"
    emp_name = f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username

    task_log = TaskLog.objects.create(
        task_id=task_log_id,
        user_id=request.user.id,
        employee_id=emp_code,
        employee_name=emp_name,
        date=today_ist,
        project_id=task.project.project_id,
        project_task_id=task.task_id,
        project_name=task.project.name,
        task_name=task.title,
        description=task.description,
        status='IN_PROGRESS',
        start_time=now_utc_str,
        duration_seconds=session.duration_seconds,
        current_segment_start=now_utc_str,
        work_segments=session.work_segments,
        is_explicit_completed=False,
        created_at=now_utc_str,
        updated_at=now_utc_str
    )
    session.task_log_id = task_log.task_id
    session.save(update_fields=['task_log_id'])

    ProjectAuditHistory.objects.create(
        project=task.project,
        task=task,
        action='TASK_STARTED',
        actor=request.user,
        actor_name=emp_name,
        details={'session_id': session.session_id, 'start_time': now_utc_str}
    )

    return Response({
        'message': 'Work session started.',
        'task': serialize_task_item(task, current_user=request.user),
        'session_id': session.session_id
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_task_pause_view(request, task_id):
    """
    Pauses active work session on task. Does NOT complete task.
    Task status remains In Progress.
    """
    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if request.user.role != 'ADMIN' and task.assigned_to_id != request.user.id:
        return Response({'error': 'Access denied.'}, status=403)

    session = WorkSession.objects.filter(task=task, user=request.user, status='IN_PROGRESS').first()
    if not session:
        return Response({'error': 'No active in-progress work session found for this task.'}, status=400)

    now_utc_dt = datetime.now(timezone.utc)
    now_utc_str = now_utc_dt.isoformat().replace("+00:00", "Z")

    seg_start_str = session.current_segment_start or session.start_time
    seg_sec = 0
    if seg_start_str:
        try:
            s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
            seg_sec = max(0, int((now_utc_dt - s_dt).total_seconds()))
        except Exception:
            pass

    session.duration_seconds += seg_sec
    task.total_duration_seconds += seg_sec
    task.save(update_fields=['total_duration_seconds', 'updated_at'])

    segs = list(session.work_segments or [])
    segs.append({'start_time': seg_start_str, 'end_time': now_utc_str, 'duration_seconds': seg_sec})
    session.work_segments = segs
    session.current_segment_start = None
    session.status = 'PAUSED'
    session.updated_at = now_utc_str
    session.save()

    if session.task_log_id:
        TaskLog.objects.filter(task_id=session.task_log_id).update(
            status='PAUSED',
            duration_seconds=session.duration_seconds,
            current_segment_start=None,
            work_segments=session.work_segments,
            updated_at=now_utc_str
        )

    ProjectAuditHistory.objects.create(
        project=task.project,
        task=task,
        action='SESSION_PAUSED',
        actor=request.user,
        actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        details={'session_id': session.session_id, 'paused_at': now_utc_str}
    )

    return Response({
        'message': 'Work session paused.',
        'task': serialize_task_item(task, current_user=request.user)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_task_stop_view(request, task_id):
    """
    Stops the active/paused timer session on task. Does NOT complete task.
    Task status remains In Progress.
    """
    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if request.user.role != 'ADMIN' and task.assigned_to_id != request.user.id:
        return Response({'error': 'Access denied.'}, status=403)

    session = WorkSession.objects.filter(task=task, user=request.user, status__in=['IN_PROGRESS', 'PAUSED']).first()
    if not session:
        return Response({'error': 'No active session found for this task.'}, status=400)

    now_utc_dt = datetime.now(timezone.utc)
    now_utc_str = now_utc_dt.isoformat().replace("+00:00", "Z")

    if session.status == 'IN_PROGRESS':
        seg_start_str = session.current_segment_start or session.start_time
        seg_sec = 0
        if seg_start_str:
            try:
                s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                seg_sec = max(0, int((now_utc_dt - s_dt).total_seconds()))
            except Exception:
                pass
        session.duration_seconds += seg_sec
        task.total_duration_seconds += seg_sec
        task.save(update_fields=['total_duration_seconds', 'updated_at'])
        segs = list(session.work_segments or [])
        segs.append({'start_time': seg_start_str, 'end_time': now_utc_str, 'duration_seconds': seg_sec})
        session.work_segments = segs

    session.current_segment_start = None
    session.end_time = now_utc_str
    session.status = 'ENDED'
    session.updated_at = now_utc_str
    session.save()

    if session.task_log_id:
        TaskLog.objects.filter(task_id=session.task_log_id).update(
            status='ENDED',
            end_time=now_utc_str,
            duration_seconds=session.duration_seconds,
            current_segment_start=None,
            work_segments=session.work_segments,
            is_explicit_completed=False,
            updated_at=now_utc_str
        )

    ProjectAuditHistory.objects.create(
        project=task.project,
        task=task,
        action='SESSION_STOPPED',
        actor=request.user,
        actor_name=f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username,
        details={'session_id': session.session_id, 'stopped_at': now_utc_str}
    )

    return Response({
        'message': 'Timer stopped. Task remains In Progress.',
        'task': serialize_task_item(task, current_user=request.user)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_task_note_view(request, task_id):
    """Adds a progress note explaining work done or remaining."""
    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if request.user.role != 'ADMIN' and task.assigned_to_id != request.user.id:
        return Response({'error': 'Access denied.'}, status=403)

    content = (request.data.get('content') or '').strip()
    if not content:
        return Response({'error': 'Progress note content is required.'}, status=400)

    author_name = f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username

    note = TaskProgressNote.objects.create(
        task=task,
        author=request.user,
        author_name=author_name,
        content=content
    )

    ProjectAuditHistory.objects.create(
        project=task.project,
        task=task,
        action='NOTE_ADDED',
        actor=request.user,
        actor_name=author_name,
        details={'note_id': str(note.note_id)}
    )

    return Response({
        'message': 'Progress note added successfully.',
        'note': {
            'note_id': str(note.note_id),
            'author_name': note.author_name,
            'content': note.content,
            'created_at': note.created_at.isoformat()
        },
        'task': serialize_task_item(task, current_user=request.user)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_task_complete_view(request, task_id):
    """
    Explicitly marks task completed.
    - Closes active work session atomically and records completion timestamp.
    - Prevents additional time logging on completed tasks unless reopened.
    - Evaluates project closure readiness.
    """
    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if request.user.role != 'ADMIN' and task.assigned_to_id != request.user.id:
        return Response({'error': 'Access denied. You can only complete tasks assigned to you.'}, status=403)

    if task.status == 'COMPLETED':
        return Response({'error': 'Task is already marked as completed.'}, status=400)

    now_utc_dt = datetime.now(timezone.utc)
    now_utc_str = now_utc_dt.isoformat().replace("+00:00", "Z")

    # 1. Close any running work session atomically
    active_session = WorkSession.objects.filter(task=task, user=request.user, status__in=['IN_PROGRESS', 'PAUSED']).first()
    if active_session:
        if active_session.status == 'IN_PROGRESS':
            seg_start_str = active_session.current_segment_start or active_session.start_time
            seg_sec = 0
            if seg_start_str:
                try:
                    s_dt = datetime.fromisoformat(seg_start_str.replace("Z", "+00:00"))
                    seg_sec = max(0, int((now_utc_dt - s_dt).total_seconds()))
                except Exception:
                    pass
            active_session.duration_seconds += seg_sec
            task.total_duration_seconds += seg_sec
            segs = list(active_session.work_segments or [])
            segs.append({'start_time': seg_start_str, 'end_time': now_utc_str, 'duration_seconds': seg_sec})
            active_session.work_segments = segs

        active_session.current_segment_start = None
        active_session.end_time = now_utc_str
        active_session.status = 'ENDED'
        active_session.updated_at = now_utc_str
        active_session.save()

        if active_session.task_log_id:
            TaskLog.objects.filter(task_id=active_session.task_log_id).update(
                status='COMPLETED',
                end_time=now_utc_str,
                completed_at=now_utc_str,
                is_explicit_completed=True,
                duration_seconds=active_session.duration_seconds,
                current_segment_start=None,
                work_segments=active_session.work_segments,
                updated_at=now_utc_str
            )

    # 2. Mark task completed
    task.status = 'COMPLETED'
    task.completed_at = now_utc_dt
    task.completed_by = request.user
    task.save()

    # Sync any other TaskLog records for this task
    TaskLog.objects.filter(project_task_id=task.task_id).update(
        completed_at=now_utc_str,
        is_explicit_completed=True,
        updated_at=now_utc_str
    )

    # 3. Check if all tasks in project are completed
    project = task.project
    if project.tasks.filter(status='COMPLETED').count() == project.tasks.count() and project.status != 'COMPLETED':
        project.status = 'READY_FOR_CLOSURE'
        project.save(update_fields=['status'])

    actor_name = f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username
    ProjectAuditHistory.objects.create(
        project=project,
        task=task,
        action='TASK_COMPLETED',
        actor=request.user,
        actor_name=actor_name,
        details={'completed_at': now_utc_str}
    )

    return Response({
        'message': 'Task marked as completed successfully.',
        'task': serialize_task_item(task, current_user=request.user),
        'project_status': project.compute_status()
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def project_task_reopen_view(request, task_id):
    """
    Employee or Admin reopens a completed task. Requires mandatory reason.
    Allows time logging to resume and preserves status-change history.
    """
    try:
        task = ProjectTask.objects.get(task_id=task_id)
    except ProjectTask.DoesNotExist:
        return Response({'error': 'Task not found.'}, status=404)

    if request.user.role != 'ADMIN' and task.assigned_to_id != request.user.id:
        return Response({'error': 'Access denied. You can only reopen tasks assigned to you.'}, status=403)

    reason = (request.data.get('reason') or '').strip()
    if not reason:
        return Response({'error': 'A mandatory reason is required to reopen this task.'}, status=400)

    now_utc_dt = datetime.now(timezone.utc)
    now_utc_str = now_utc_dt.isoformat().replace("+00:00", "Z")

    task.status = 'IN_PROGRESS'
    task.completed_at = None
    task.completed_by = None
    task.reopened_at = now_utc_dt
    task.reopened_by = request.user
    task.reopen_reason = reason
    task.save()

    # Sync TaskLog
    TaskLog.objects.filter(project_task_id=task.task_id).update(
        status='IN_PROGRESS',
        completed_at=None,
        is_explicit_completed=False,
        updated_at=now_utc_str
    )

    # If project was completed or ready for closure, set back to In Progress
    project = task.project
    if project.status in ['READY_FOR_CLOSURE', 'COMPLETED']:
        project.status = 'IN_PROGRESS'
        project.save(update_fields=['status'])

    actor_name = f"{request.user.first_name} {request.user.last_name}".strip() or request.user.username
    ProjectAuditHistory.objects.create(
        project=project,
        task=task,
        action='TASK_REOPENED',
        actor=request.user,
        actor_name=actor_name,
        reason=reason,
        details={'reopened_at': now_utc_str}
    )

    return Response({
        'message': 'Task reopened successfully.',
        'task': serialize_task_item(task, current_user=request.user),
        'project_status': project.compute_status()
    })





