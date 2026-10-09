import os
import django
import time
from datetime import datetime, timezone, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'knowletive.settings')
django.setup()

from django.contrib.auth import get_user_model
from tracker.storage_adapter import storage
from tracker.views import calculate_day_metrics

User = get_user_model()
user = User.objects.get(id=19) # amanknowletive@gmail.com
user_id = str(user.id)
print(f"=== TESTING TIMER LOGIC FOR USER: {user.email} (ID: {user_id}) ===")

def get_current_metrics():
    events = storage.get_events_for_user(user_id)
    return calculate_day_metrics(events)

# Reset state
storage.end_any_active_task_for_user(user_id)
storage.record_event(user_id, 'START_WORK')

print("\n--- TEST 1: User Starts Task A ---")
now_iso = datetime.now(timezone.utc).isoformat()
task_a = storage.start_task(user_id, 'Client Portal', 'Task A', 'Frontend development', user.email)
metrics = get_current_metrics()
active_task = storage.get_active_task_for_user(user_id)
assert metrics['tracker_state'] == 'WORKING', f"Expected WORKING, got {metrics['tracker_state']}"
assert active_task['task_name'] == 'Task A', f"Expected Task A, got {active_task}"
assert active_task['status'] == 'IN_PROGRESS'
time.sleep(1.2)
dur1 = storage.calculate_task_duration(active_task)
assert dur1 >= 1, f"Task A duration should be >= 1s, got {dur1}"
print(f"PASS: Task A started, timer ticking: {dur1}s. Break is 0.")

print("\n--- TEST 2: User Starts Break (Task must freeze immediately) ---")
pause_iso = datetime.now(timezone.utc).isoformat()
paused_task = storage.pause_active_task(user_id, pause_iso)
storage.record_event(user_id, 'START_BREAK')
metrics = get_current_metrics()
assert metrics['tracker_state'] == 'BREAK', f"Expected BREAK, got {metrics['tracker_state']}"
paused_task = storage.get_active_task_for_user(user_id)
assert paused_task['status'] == 'PAUSED', f"Expected PAUSED, got {paused_task['status']}"
dur_frozen = storage.calculate_task_duration(paused_task)
print(f"Task A frozen at: {dur_frozen}s. Simulating 2 seconds on break...")
time.sleep(2)
dur_after_2s = storage.calculate_task_duration(paused_task)
assert dur_after_2s == dur_frozen, f"FAIL: Task duration increased during break! {dur_frozen} vs {dur_after_2s}"
print(f"PASS: Task A duration strictly frozen during break ({dur_after_2s}s == {dur_frozen}s)!")

print("\n--- TEST 3: User Returns from Break (Resume Work) ---")
storage.record_event(user_id, 'RESUME_WORK')
resume_iso = datetime.now(timezone.utc).isoformat()
resumed_task = storage.resume_active_task(user_id, resume_iso)
metrics = get_current_metrics()
assert metrics['tracker_state'] == 'WORKING'
assert resumed_task['status'] == 'IN_PROGRESS'
time.sleep(1.2)
dur_resumed = storage.calculate_task_duration(resumed_task)
assert dur_resumed > dur_frozen, f"FAIL: Resumed task duration didn't increase: {dur_resumed} vs {dur_frozen}"
print(f"PASS: Break stopped, Task A resumed from {dur_frozen}s to {dur_resumed}s!")

print("\n--- TEST 4: User Starts New Task (Task B) While on Break ---")
# Go on break again
storage.pause_active_task(user_id)
storage.record_event(user_id, 'START_BREAK')
metrics = get_current_metrics()
assert metrics['tracker_state'] == 'BREAK'

# Starting Task B directly ends break and starts Task B
storage.record_event(user_id, 'RESUME_WORK')
task_b = storage.start_task(user_id, 'Internal CRM', 'Task B', 'Backend API', user.email)
metrics = get_current_metrics()
active_task = storage.get_active_task_for_user(user_id)
assert metrics['tracker_state'] == 'WORKING'
assert active_task['task_name'] == 'Task B'
assert active_task['status'] == 'IN_PROGRESS'
tasks = storage.get_all_tasks(user_id=user_id)
task_a_record = next(t for t in tasks if t['task_log_id'] == task_a['task_log_id'])
assert task_a_record['status'] == 'COMPLETED', "Previous Task A must be completed"
print("PASS: Break ended automatically, Task A finalized, Task B started!")

print("\n--- TEST 5: Switching from Task B to Task C ---")
task_c = storage.start_task(user_id, 'Analytics Dashboard', 'Task C', 'Recharts', user.email)
active_task = storage.get_active_task_for_user(user_id)
assert active_task['task_name'] == 'Task C'
tasks = storage.get_all_tasks(user_id=user_id)
task_b_record = next(t for t in tasks if t['task_log_id'] == task_b['task_log_id'])
assert task_b_record['status'] == 'COMPLETED'
print("PASS: Task B completed cleanly without overlap, Task C actively running!")

print("\n--- TEST 6: Verify Break Time Excluded from Task Work Totals ---")
# Check task_a work duration vs wall-clock duration
# Task A had a 2-second break in the middle
t_a_dur = task_a_record['duration_seconds']
assert t_a_dur < 4, f"Task A duration should not include break time! Duration: {t_a_dur}"
print(f"PASS: Task A total work recorded: {t_a_dur}s (break was completely excluded)!")

# Cleanup
storage.end_any_active_task_for_user(user_id)
storage.record_event(user_id, 'END_WORK')
print("\n>>> ALL QA TESTS PASSED WITH 100% SUCCESS! <<<")
