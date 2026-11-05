import sys
import os
from django.apps import AppConfig


class TrackerConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'tracker'

    def ready(self):
        # Auto-run database migrations on server startup (e.g. Coolify container start)
        skip_commands = ['makemigrations', 'migrate', 'test', 'collectstatic']
        if any(arg in sys.argv for arg in skip_commands):
            return

        try:
            from django.core.management import call_command
            call_command('migrate', interactive=False, verbosity=0)
        except Exception as e:
            print(f"Startup migration notice: {e}")
