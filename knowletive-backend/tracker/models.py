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
    work_start_time = models.CharField(max_length=10, default='10:00')
    work_end_time = models.CharField(max_length=10, default='19:00')
    timezone = models.CharField(max_length=50, default='Asia/Kolkata')
