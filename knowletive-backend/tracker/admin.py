from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    User,
    Invitation,
    Notification,
    TimeEvent,
    TaskLog,
    TimesheetEntry,
    AuditLog,
    SystemSettings,
)


@admin.register(User)
class CustomUserAdmin(BaseUserAdmin):
    list_display = (
        "username",
        "email",
        "role",
        "employee_id",
        "is_staff",
        "is_superuser",
        "approval_status",
    )
    list_filter = (
        "role",
        "is_staff",
        "is_superuser",
        "approval_status",
        "employment_status",
    )
    search_fields = ("username", "email", "employee_id")
    ordering = ("username",)

    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "TimeTracker Details",
            {
                "fields": (
                    "role",
                    "employee_id",
                    "department",
                    "employment_status",
                    "approval_status",
                )
            },
        ),
    )

    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        (
            "TimeTracker Details",
            {
                "fields": (
                    "role",
                    "employee_id",
                    "department",
                    "employment_status",
                    "approval_status",
                )
            },
        ),
    )


admin.site.register(Invitation)
admin.site.register(Notification)
admin.site.register(TimeEvent)
admin.site.register(TaskLog)
admin.site.register(TimesheetEntry)
admin.site.register(AuditLog)
admin.site.register(SystemSettings)
