import json
import uuid
from datetime import datetime, date, timedelta, timezone, time
from zoneinfo import ZoneInfo
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from tracker.models import User, TimeEvent
from tracker.views import IST_TZ, calculate_monthly_attendance_summary

def create_event(user_id, event_type, timestamp):
    return TimeEvent.objects.create(
        event_id=f"EVT-{uuid.uuid4().hex[:10].upper()}",
        user_id=user_id,
        event_type=event_type,
        timestamp=timestamp
    )

class MonthlyAttendanceSummaryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='att_admin',
            email='admin@attendance.test',
            password='AdminPassword123!',
            role='ADMIN'
        )
        self.employee1 = User.objects.create_user(
            username='emp_alice',
            email='alice@attendance.test',
            password='Password123!',
            role='EMPLOYEE',
            first_name='Alice',
            last_name='Smith',
            employee_id='EMP_ATT_01'
        )
        self.employee2 = User.objects.create_user(
            username='emp_bob',
            email='bob@attendance.test',
            password='Password123!',
            role='EMPLOYEE',
            first_name='Bob',
            last_name='Jones',
            employee_id='EMP_ATT_02'
        )
        self.token_emp1 = Token.objects.create(user=self.employee1)
        self.token_emp2 = Token.objects.create(user=self.employee2)
        self.token_admin = Token.objects.create(user=self.admin)

    def test_cutoff_cases_10_30_and_10_35_00_and_10_35_01(self):
        """
        - 10:30 AM: on time
        - 10:35:00 AM: on time
        - 10:35:01 AM: late
        - Missing clock-in: not late
        """
        year = 2026
        month = 11

        # Day 1: 10:30:00 AM IST (05:00:00 UTC) -> On time
        d1_start = datetime(year, month, 1, 10, 30, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        d1_end = d1_start + timedelta(hours=8)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d1_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d1_end.isoformat())

        # Day 2: 10:35:00 AM IST (05:05:00 UTC) -> On time
        d2_start = datetime(year, month, 2, 10, 35, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        d2_end = d2_start + timedelta(hours=8)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d2_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d2_end.isoformat())

        # Day 3: 10:35:01 AM IST (05:05:01 UTC) -> Late
        d3_start = datetime(year, month, 3, 10, 35, 1, tzinfo=IST_TZ).astimezone(timezone.utc)
        d3_end = d3_start + timedelta(hours=8)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d3_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d3_end.isoformat())

        # Day 4: No clock-in -> Missing clock-in must NOT be late

        summary = calculate_monthly_attendance_summary(self.employee1, year, month)
        self.assertEqual(summary['late_arrivals_count'], 1)  # Only Day 3 is late

        day1 = next(d for d in summary['days'] if d['date'] == '2026-11-01')
        self.assertFalse(day1['is_late'])

        day2 = next(d for d in summary['days'] if d['date'] == '2026-11-02')
        self.assertFalse(day2['is_late'])

        day3 = next(d for d in summary['days'] if d['date'] == '2026-11-03')
        self.assertTrue(day3['is_late'])

        day4 = next(d for d in summary['days'] if d['date'] == '2026-11-04')
        self.assertFalse(day4['is_late'])
        self.assertFalse(day4['has_record'])

    def test_nine_hour_durations_and_breaks(self):
        """
        - Below 9 hours (8h 59m 59s = 32399s): completed_9_hours is False
        - Exactly 9 hours (32400s): completed_9_hours is True
        - Above 9 hours (9h 15m): completed_9_hours is True
        - 10 hours presence with 1.5 hours break = 8.5 hours work: completed_9_hours is False
        """
        year = 2026
        month = 11

        # Day 5: 32399s (8h 59m 59s) -> under 9 hours
        d5_start = datetime(year, month, 5, 10, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        d5_end = d5_start + timedelta(seconds=32399)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d5_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d5_end.isoformat())

        # Day 6: exactly 32400s (9 hours) -> completed 9 hours
        d6_start = datetime(year, month, 6, 10, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        d6_end = d6_start + timedelta(seconds=32400)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d6_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d6_end.isoformat())

        # Day 7: 33300s (9h 15m) -> completed 9 hours
        d7_start = datetime(year, month, 7, 10, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        d7_end = d7_start + timedelta(seconds=33300)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d7_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d7_end.isoformat())

        # Day 8: 10h presence (36000s) with 1.5h break (5400s) = 8.5h work (30600s) -> under 9 hours
        d8_start = datetime(year, month, 8, 10, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        d8_break_s = d8_start + timedelta(hours=4)
        d8_break_e = d8_break_s + timedelta(hours=1, minutes=30)
        d8_end = d8_start + timedelta(hours=10)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=d8_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='START_BREAK', timestamp=d8_break_s.isoformat())
        create_event(user_id=self.employee1.id, event_type='RESUME_WORK', timestamp=d8_break_e.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=d8_end.isoformat())

        summary = calculate_monthly_attendance_summary(self.employee1, year, month)
        self.assertEqual(summary['completed_9_hours_count'], 2)  # Day 6 and Day 7

        d5 = next(d for d in summary['days'] if d['date'] == '2026-11-05')
        self.assertFalse(d5['completed_9_hours'])
        self.assertEqual(d5['counted_work_seconds'], 32399)

        d6 = next(d for d in summary['days'] if d['date'] == '2026-11-06')
        self.assertTrue(d6['completed_9_hours'])
        self.assertEqual(d6['counted_work_seconds'], 32400)

        d7 = next(d for d in summary['days'] if d['date'] == '2026-11-07')
        self.assertTrue(d7['completed_9_hours'])

        d8 = next(d for d in summary['days'] if d['date'] == '2026-11-08')
        self.assertFalse(d8['completed_9_hours'])
        self.assertEqual(d8['counted_work_seconds'], 30600)

    def test_both_late_and_completed_9_hours_and_repeated_sessions(self):
        """
        - Day 9: Clock in at 10:45 AM (Late) and work 9.5 hours -> both Late Arrival and Completed 9 Hours.
        - Multiple sessions on same day: first clock-in of the day used, and multiple work sessions combined without overlap.
        """
        year = 2026
        month = 11

        # Session 1: 10:45 AM to 02:45 PM (4 hours)
        s1_start = datetime(year, month, 9, 10, 45, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        s1_end = s1_start + timedelta(hours=4)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=s1_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=s1_end.isoformat())

        # Session 2: 03:30 PM to 09:00 PM (5.5 hours) -> Total = 9.5 hours
        s2_start = datetime(year, month, 9, 15, 30, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        s2_end = s2_start + timedelta(hours=5, minutes=30)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=s2_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=s2_end.isoformat())

        summary = calculate_monthly_attendance_summary(self.employee1, year, month)
        d9 = next(d for d in summary['days'] if d['date'] == '2026-11-09')

        self.assertTrue(d9['is_late'])
        self.assertTrue(d9['completed_9_hours'])
        self.assertEqual(d9['first_clock_in_short'], '10:45 AM')
        self.assertEqual(d9['counted_work_seconds'], 34200) # 9.5 hours
        self.assertIn("Late Arrival", d9['attendance_result'])
        self.assertIn("Completed 9h", d9['attendance_result'])

    def test_midnight_crossing_session_split(self):
        """
        Session from 11:00 PM Nov 10 to 02:00 AM Nov 11 (3 hours total):
        - Nov 10 gets 1 hour (23:00 to 24:00)
        - Nov 11 gets 2 hours (00:00 to 02:00)
        """
        year = 2026
        month = 11

        s_start = datetime(year, month, 10, 23, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        s_end = datetime(year, month, 11, 2, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=s_start.isoformat())
        create_event(user_id=self.employee1.id, event_type='END_WORK', timestamp=s_end.isoformat())

        summary = calculate_monthly_attendance_summary(self.employee1, year, month)
        d10 = next(d for d in summary['days'] if d['date'] == '2026-11-10')
        d11 = next(d for d in summary['days'] if d['date'] == '2026-11-11')

        self.assertEqual(d10['counted_work_seconds'], 3600)  # 1 hour
        self.assertEqual(d11['counted_work_seconds'], 7200)  # 2 hours
        # Nov 11 had no clock-in on that day -> not late
        self.assertFalse(d11['is_late'])

    def test_employee_api_isolation_and_endpoint(self):
        """
        - Employees can access only their own summary.
        - Passing other employee's user_id does NOT leak data.
        - Admin can access specified employee's summary.
        """
        year = 2026
        month = 11

        # Create event for Bob
        b_start = datetime(year, month, 12, 10, 40, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        b_end = b_start + timedelta(hours=9)
        create_event(user_id=self.employee2.id, event_type='START_WORK', timestamp=b_start.isoformat())
        create_event(user_id=self.employee2.id, event_type='END_WORK', timestamp=b_end.isoformat())

        # Alice requests Bob's user_id -> must return Alice's own summary (0 late days)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_emp1.key}')
        res_alice = self.client.get(f'/api/attendance/monthly-summary/?year=2026&month=11&user_id={self.employee2.id}')
        self.assertEqual(res_alice.status_code, 200)
        self.assertEqual(res_alice.data['late_arrivals_count'], 0) # Alice has 0 on day 12

        # Admin requests Bob's summary -> receives Bob's data (1 late day)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_admin.key}')
        res_admin = self.client.get(f'/api/attendance/monthly-summary/?year=2026&month=11&user_id={self.employee2.id}')
        self.assertEqual(res_admin.status_code, 200)
        self.assertEqual(res_admin.data['late_arrivals_count'], 1)
        self.assertEqual(res_admin.data['completed_9_hours_count'], 1)

    def test_admin_monthly_attendance_all_employees_and_permission_enforcement(self):
        """
        - Employee calling /api/admin/attendance/monthly-summary/ gets 403 Forbidden.
        - Admin calling /api/admin/attendance/monthly-summary/ gets list of all employees.
        - Employee and Admin counts are identical for the same employee, year, and month.
        - Ongoing day labels final_clock_out as 'Working' or 'On Break'.
        """
        year = 2026
        month = 11

        # 1. Employee forbidden from admin endpoint
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_emp1.key}')
        res_emp_call = self.client.get(f'/api/admin/attendance/monthly-summary/?year={year}&month={month}')
        self.assertEqual(res_emp_call.status_code, 403)

        # 2. Add an ongoing session today for Alice
        now_utc = datetime.now(timezone.utc)
        now_ist = now_utc.astimezone(IST_TZ)
        today_start_time = datetime(now_ist.year, now_ist.month, now_ist.day, 10, 25, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
        create_event(user_id=self.employee1.id, event_type='START_WORK', timestamp=today_start_time.isoformat())

        # 3. Admin calls admin endpoint
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_admin.key}')
        res_admin = self.client.get(f'/api/admin/attendance/monthly-summary/?year={now_ist.year}&month={now_ist.month}')
        self.assertEqual(res_admin.status_code, 200)
        employees_data = res_admin.data['employees']

        # Both Alice and Bob should be listed
        emp_ids = [e['id'] for e in employees_data]
        self.assertIn(self.employee1.id, emp_ids)
        self.assertIn(self.employee2.id, emp_ids)

        alice_admin_data = next(e for e in employees_data if e['id'] == self.employee1.id)

        # Alice's direct employee summary
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_emp1.key}')
        res_alice_direct = self.client.get(f'/api/attendance/monthly-summary/?year={now_ist.year}&month={now_ist.month}')
        self.assertEqual(res_alice_direct.status_code, 200)

        # Identical counts check!
        self.assertEqual(alice_admin_data['late_arrivals_count'], res_alice_direct.data['late_arrivals_count'])
        self.assertEqual(alice_admin_data['completed_9_hours_count'], res_alice_direct.data['completed_9_hours_count'])
        self.assertEqual(alice_admin_data['total_days_worked'], res_alice_direct.data['total_days_worked'])

        # Ongoing today clock-out label check
        today_str = now_ist.date().isoformat()
        today_row = next(d for d in alice_admin_data['days'] if d['date'] == today_str)
        self.assertEqual(today_row['final_clock_out'], 'Working')
        self.assertEqual(today_row['first_clock_in_short'], '10:25 AM')
        self.assertFalse(today_row['is_late'])
        self.assertEqual(today_row['late_display'], 'On Time')

