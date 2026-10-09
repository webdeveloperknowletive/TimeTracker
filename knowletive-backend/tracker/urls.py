from django.urls import path
from . import views

urlpatterns = [
    # Auth
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/signup/', views.signup_view, name='signup'),
    path('auth/verify-invitation/', views.verify_invitation_view, name='verify_invitation'),
    path('auth/forgot-password/', views.forgot_password_view, name='forgot_password'),
    
    # Tracker
    path('tracker/status/', views.status_view, name='status'),
    path('tracker/action/', views.action_view, name='action'),
    
    # Admin Dashboard & Overview
    path('admin/dashboard/', views.admin_dashboard, name='admin_dashboard'),
    
    # Reports & Exports (Place export before base reports to guarantee resolution)
    path('admin/reports/export/', views.export_reports_view, name='export_reports'),
    path('admin/reports/', views.reports_view, name='reports'),
    
    # User Management & Approvals
    path('admin/users/', views.user_management, name='user_management'),
    path('admin/users/<int:user_id>/', views.user_detail_manage, name='user_detail_manage'),
    path('admin/users/<int:user_id>/approve/', views.approve_user_view, name='approve_user'),
    path('admin/users/<int:user_id>/reject/', views.reject_user_view, name='reject_user'),

    # Invitations
    path('admin/invitations/', views.admin_invitations_view, name='admin_invitations'),
    path('admin/invitations/<int:inv_id>/revoke/', views.revoke_invitation_view, name='revoke_invitation'),

    # Notifications
    path('admin/notifications/', views.admin_notifications_view, name='admin_notifications'),
    path('admin/notifications/read/', views.mark_notifications_read_view, name='mark_notifications_read'),
    
    # Corrections & Audit Trail
    path('admin/corrections/', views.admin_correction, name='admin_correction'),
    path('admin/audit-logs/', views.audit_logs_view, name='audit_logs'),
    
    # Settings
    path('settings/', views.settings_view, name='settings'),
    
    # Monthly Timesheet & Entry
    path('timesheet/monthly/', views.monthly_timesheet_view, name='monthly_timesheet'),
    path('timesheet/entry/', views.save_timesheet_entry_view, name='save_timesheet_entry'),
    path('timesheet/export/', views.export_timesheet_view, name='export_timesheet'),
    
    # Time-wise Task & Project Logs
    path('tasks/daily/', views.daily_tasks_view, name='daily_tasks'),
    path('tasks/start/', views.start_task_view, name='start_task'),
    path('tasks/end/', views.end_task_view, name='end_task'),
    path('tasks/<str:task_log_id>/', views.update_task_view, name='update_task'),
    
    # Admin Daily Task Reports & Exports
    path('admin/tasks/export/', views.admin_tasks_export_view, name='admin_tasks_export'),
    path('admin/tasks/report/', views.admin_tasks_report_view, name='admin_tasks_report'),
    
    # Analytics Dashboard (Role-Enforced)
    path('admin/analytics/dashboard/', views.admin_analytics_dashboard_view, name='admin_analytics_dashboard'),
    path('analytics/dashboard/', views.analytics_dashboard_view, name='analytics_dashboard'),
]

