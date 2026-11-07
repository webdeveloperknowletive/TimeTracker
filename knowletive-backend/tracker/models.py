import re
from datetime import datetime, timezone
from django.db import models
from django.contrib.auth.models import AbstractUser

def generate_unique_employee_id(name):
    """
    Generates a unique, permanent Employee ID in the format:
    Uppercase name-based prefix + 3-digit zero-padded number,
    e.g. AYUSH001, AMAN002, RAVINA003, AMAY004, SAKSHAM005.
    
    If two employees have the same name or prefix, automatically uses the
    next available number so their IDs remain unique.
    IDs are permanent and never reused, even if an account is deactivated.
    """
    raw_prefix = re.sub(r'[^A-Za-z]', '', name or '').upper()
    prefix = raw_prefix if raw_prefix else 'EMP'
    
    # Check all existing employee IDs across active and deactivated accounts
    existing_ids = list(User.objects.exclude(employee_id__isnull=True).exclude(employee_id='').values_list('employee_id', flat=True))
    
    max_num = 0
    for eid in existing_ids:
        m = re.search(r'(\d+)$', eid)
        if m:
            try:
                num = int(m.group(1))
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
                
    candidate_num = max(max_num + 1, 1)
    while True:
        candidate_id = f"{prefix}{candidate_num:03d}"
        if not User.objects.filter(employee_id=candidate_id).exists():
            return candidate_id
        candidate_num += 1

class User(AbstractUser):
    ROLE_CHOICES = (
        ('ADMIN', 'Admin'),
        ('EMPLOYEE', 'Employee'),
    )
    APPROVAL_CHOICES = (
        ('PENDING', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='EMPLOYEE')
    employee_id = models.CharField(max_length=30, blank=True, null=True, unique=True)
    department = models.CharField(max_length=100, blank=True)
    designation = models.CharField(max_length=100, blank=True, default='')
    employment_status = models.CharField(max_length=50, default='Active')
    approval_status = models.CharField(max_length=20, choices=APPROVAL_CHOICES, default='APPROVED')

    def __str__(self):
        full_name = f"{self.first_name} {self.last_name}".strip()
        if full_name and self.email:
            return f"{full_name} ({self.email})"
        elif full_name:
            return f"{full_name} ({self.username})"
        return self.username

class Invitation(models.Model):
    code = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_invitations')
    recipient_email = models.EmailField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_used = models.BooleanField(default=False)
    used_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='used_invitation')
    used_at = models.DateTimeField(null=True, blank=True)
    is_revoked = models.BooleanField(default=False)
    notes = models.CharField(max_length=255, blank=True)

    def is_valid(self):
        if self.is_used or self.is_revoked:
            return False
        if self.expires_at and datetime.now(timezone.utc) > self.expires_at:
            return False
        return True

    def __str__(self):
        return f"Invitation {self.code} (Used: {self.is_used}, Revoked: {self.is_revoked})"

class Notification(models.Model):
    title = models.CharField(max_length=200)
    message = models.TextField()
    notification_type = models.CharField(max_length=50, default='NEW_SIGNUP')
    related_user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.title} - {self.created_at}"

class TimeEvent(models.Model):
    event_id = models.CharField(max_length=100, primary_key=True)
    user_id = models.IntegerField()
    event_type = models.CharField(max_length=50)
    timestamp = models.CharField(max_length=50)
    source = models.CharField(max_length=50, default='web')
    session_id = models.CharField(max_length=100, blank=True, null=True)

import uuid

def generate_project_id():
    return f"PRJ-{uuid.uuid4().hex[:6].upper()}"

def generate_task_id():
    return f"TSK-{uuid.uuid4().hex[:6].upper()}"

def generate_session_id():
    return f"SES-{uuid.uuid4().hex[:8].upper()}"

class TaskLog(models.Model):
    task_id = models.CharField(max_length=100, primary_key=True)
    user_id = models.IntegerField()
    employee_id = models.CharField(max_length=50, blank=True, null=True)
    employee_name = models.CharField(max_length=200, blank=True, null=True)
    date = models.CharField(max_length=50, blank=True, null=True)
    project_name = models.CharField(max_length=200, blank=True, null=True)
    task_name = models.CharField(max_length=200, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=50, default='IN_PROGRESS')
    start_time = models.CharField(max_length=50, blank=True, null=True)
    end_time = models.CharField(max_length=50, blank=True, null=True)
    duration_seconds = models.IntegerField(default=0)
    current_segment_start = models.CharField(max_length=50, blank=True, null=True)
    work_segments = models.JSONField(default=list, blank=True, null=True)
    created_at = models.CharField(max_length=50, blank=True, null=True)
    updated_at = models.CharField(max_length=50, blank=True, null=True)
    project_id = models.CharField(max_length=50, blank=True, null=True)
    project_task_id = models.CharField(max_length=50, blank=True, null=True)
    completed_at = models.CharField(max_length=50, blank=True, null=True)
    is_explicit_completed = models.BooleanField(default=False)

class Project(models.Model):
    PROJECT_STATUS_CHOICES = (
        ('NOT_STARTED', 'Not Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('READY_FOR_CLOSURE', 'Ready for Closure'),
        ('COMPLETED', 'Completed'),
    )
    project_id = models.CharField(max_length=50, primary_key=True, default=generate_project_id)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    status = models.CharField(max_length=50, choices=PROJECT_STATUS_CHOICES, default='NOT_STARTED')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_projects')
    deadline = models.DateTimeField(null=True, blank=True)
    first_started_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='closed_projects')
    reopen_reason = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def compute_status(self):
        """
        Status rules derived from employee-recorded tasks:
        - Admin confirmed closed: 'COMPLETED'
        - No tasks: 'NO_TASKS' (No tasks recorded)
        - Some work started and unfinished tasks remain: In Progress.
        - All currently recorded tasks completed: All Recorded Tasks Completed.
        - No started tasks: Not Started.
        """
        if self.status == 'COMPLETED':
            return 'COMPLETED'
        total = self.tasks.count()
        if total == 0:
            return 'NO_TASKS'
        completed = self.tasks.filter(status='COMPLETED').count()
        if completed == total:
            return 'ALL_RECORDED_COMPLETED'
        started = self.tasks.filter(models.Q(status='IN_PROGRESS') | models.Q(first_started_at__isnull=False)).exists()
        if started or completed > 0:
            return 'IN_PROGRESS'
        return 'NOT_STARTED'

    def get_completion_metrics(self):
        total = self.tasks.count()
        if total == 0:
            return {
                'total_tasks': 0,
                'completed_tasks': 0,
                'completion_percentage': None,
                'label': 'No tasks recorded'
            }
        completed = self.tasks.filter(status='COMPLETED').count()
        percentage = round((completed / total) * 100.0, 1)
        return {
            'total_tasks': total,
            'completed_tasks': completed,
            'completion_percentage': percentage,
            'label': f"{percentage}%"
        }

    def __str__(self):
        return f"{self.name} ({self.project_id})"

class ProjectTask(models.Model):
    TASK_STATUS_CHOICES = (
        ('NOT_STARTED', 'Not Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
    )
    task_id = models.CharField(max_length=50, primary_key=True, default=generate_task_id)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_project_tasks')
    deadline = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=50, choices=TASK_STATUS_CHOICES, default='NOT_STARTED')
    first_started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='completed_project_tasks')
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopened_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='reopened_project_tasks')
    reopen_reason = models.TextField(blank=True, default='')
    total_duration_seconds = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} [{self.project.name}] ({self.status})"

class WorkSession(models.Model):
    SESSION_STATUS_CHOICES = (
        ('IN_PROGRESS', 'In Progress'),
        ('PAUSED', 'Paused'),
        ('ENDED', 'Ended'),
    )
    session_id = models.CharField(max_length=50, primary_key=True, default=generate_session_id)
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name='work_sessions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='work_sessions')
    date = models.CharField(max_length=50)
    start_time = models.CharField(max_length=50)
    end_time = models.CharField(max_length=50, null=True, blank=True)
    duration_seconds = models.IntegerField(default=0)
    current_segment_start = models.CharField(max_length=50, null=True, blank=True)
    work_segments = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=50, choices=SESSION_STATUS_CHOICES, default='IN_PROGRESS')
    created_at = models.CharField(max_length=50, blank=True, null=True)
    updated_at = models.CharField(max_length=50, blank=True, null=True)
    task_log_id = models.CharField(max_length=100, null=True, blank=True)

    def __str__(self):
        return f"Session {self.session_id} for Task {self.task_id} ({self.status})"

class TaskProgressNote(models.Model):
    note_id = models.CharField(max_length=50, primary_key=True, default=uuid.uuid4)
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name='progress_notes')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='task_progress_notes')
    author_name = models.CharField(max_length=200, blank=True, default='')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Note on {self.task_id} by {self.author_name}"

class ProjectAuditHistory(models.Model):
    audit_id = models.CharField(max_length=50, primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, null=True, blank=True, related_name='audit_records')
    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, null=True, blank=True, related_name='audit_records')
    action = models.CharField(max_length=100)
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    actor_name = models.CharField(max_length=200, blank=True, default='')
    reason = models.TextField(blank=True, default='')
    details = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"[{self.action}] on {self.project_id or self.task_id} by {self.actor_name}"

class TimesheetEntry(models.Model):
    entry_id = models.CharField(max_length=100, primary_key=True)
    user_id = models.IntegerField()
    date = models.CharField(max_length=50)
    project_name = models.CharField(max_length=200, blank=True, null=True)
    task_name = models.CharField(max_length=200, blank=True, null=True)
    work_description = models.TextField(blank=True, null=True)

class AuditLog(models.Model):
    log_id = models.CharField(max_length=100, primary_key=True)
    action = models.CharField(max_length=100)
    actor = models.CharField(max_length=100)
    timestamp = models.CharField(max_length=50)
    details = models.JSONField(blank=True, null=True)

class SystemSettings(models.Model):
    company_name = models.CharField(max_length=200, default='Knowletive')
    workspace_name = models.CharField(max_length=200, default='Knowletive')
    work_start_time = models.CharField(max_length=10, default='10:30')
    work_end_time = models.CharField(max_length=10, default='19:30')
    timezone = models.CharField(max_length=50, default='Asia/Kolkata')


def generate_eps_id():
    return f"EPS-{uuid.uuid4().hex[:12].upper()}"


class EmployeeProjectStatus(models.Model):
    STATUS_CHOICES = (
        ('JUST_STARTED', 'Just Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
    )
    status_id = models.CharField(max_length=50, primary_key=True, default=generate_eps_id)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='project_contributions')
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='employee_contributions_statuses')
    project_name = models.CharField(max_length=200, db_index=True)
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='JUST_STARTED')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'project_name')

    def __str__(self):
        return f"{self.user.username} -> {self.project_name}: {self.status}"
