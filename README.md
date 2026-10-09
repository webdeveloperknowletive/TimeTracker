# Knowletive Time Tracker

A complete, responsive employee time-tracking web app with an accompanying Chrome extension (Manifest V3), an admin panel, a monthly employee timesheet system, and a centralized Google Sheets data store (with automatic local fallback for zero-dependency instant testing).

## Architecture & Project Structure

The project maintains three independent components:

- **`backend/`** (or `knowletive-backend/`): Python 3 + Django REST Framework API
- **`frontend/`** (or `knowletive-frontend/`): React 19 + TypeScript + Vite + Tailwind CSS v4
- **`extension/`** (or `knowletive-extension/`): Chrome Extension (Manifest V3) in TypeScript

---

## Quick Start & Local Setup

### 1. Backend (Django REST Framework)

```powershell
cd c:\Users\ayush\Downloads\TIMETRACKER\backend
.\venv\Scripts\activate
python manage.py migrate
python seed.py
python manage.py runserver 8000
```

- **Admin Account:** `admin@knowletive.com` / `admin`
- **Employee Account:** `emp@knowletive.com` / `emp`
- **Run Automated Tests:**
  ```powershell
  python manage.py test tracker
  ```
  *(9 comprehensive integration test suites covering auth, role isolation, state machine transitions, deduplication, audit trails, monthly timesheets, and CSV/Excel exports.)*

### 2. Frontend Web App (React + Vite)

```powershell
cd c:\Users\ayush\Downloads\TIMETRACKER\frontend
npm install
npm run dev
```

Visit **http://localhost:5173** in your browser.

- **Employee Flow (`/`):** Jibble-style time tracker with live ticking timer, start/break/resume/end actions, confirmation modal, daily office hours reminders (10:00 AM - 7:00 PM Asia/Kolkata), and 7-day activity history.
- **Monthly Timesheet (`/timesheet`):** Excel-inspired monthly grid (matching reference images) showing one row per workday with Date, Day, Project, Task Name, Description, Start/End times, Total Work hours, Break duration, and Record Status. Employees can input/update their Project, Task, and Description with unsaved change warnings and export to CSV or Excel (`.xlsx`).
- **Admin Console (`/admin`):** Live attendance board, late start & missing clock-out detection, employee timesheet review with project/task filtering, user management (create, edit, deactivate), CSV and Excel report exports, admin time correction modal with mandatory audit reason, and audit trail logs.

### 3. Chrome Extension (Manifest V3)

1. Build/Compile extension TypeScript:
   ```powershell
   cd c:\Users\ayush\Downloads\TIMETRACKER\extension
   npm install
   npx tsc
   ```
2. In Google Chrome, go to `chrome://extensions/`
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `extension` folder.
5. Click the extension icon in Chrome toolbar to sign in, track time, or click the direct links to the web Tracker and Monthly Timesheet.

---

## Monthly Employee Timesheet & Editing Rules

- **Editable Fields for Employees:** For each workday, employees can add and edit their `Project Name`, `Task Name`, and `Work Description`.
- **Immutable Time Records:** Employees **cannot** edit, delete, or backdate start times, end times, breaks, or total working hours. Those are strictly calculated from server-recorded events.
- **Unsaved Changes Warning:** Prompts employees if they attempt to navigate away or switch months with uncommitted edits.
- **Admin Review:** Admins can select any employee and review their full month's timesheet, search/filter by project or task, and export to CSV/Excel.
- **Data Protection:** Backend API enforces that employees can query and update only their own timesheets (`403 Forbidden` if attempting to access another user's timesheet).

---

## Google Sheets Integration

The backend uses a modular storage adapter (`storage_adapter.py`). If credentials are not specified, it automatically operates in local JSON mock mode (`local_sheets_mock.json`) so the entire application functions out of the box.

To connect your live Google Sheet:

1. Create a service account in [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Sheets API**.
2. Download the JSON key file.
3. Create a Google Sheet and share it with the service account email (Editor access).
4. Create the required tabs:
   - `TimeEvents` (Columns: `event_id`, `user_id`, `event_type`, `timestamp`, `source`)
   - `TimesheetEntries` (Columns: `entry_id`, `user_id`, `date`, `project_name`, `task_name`, `work_description`, `updated_at`)
   - `AuditLog` (Columns: `log_id`, `action`, `actor`, `timestamp`, `details`)
   - `Settings` (Office hours and timezone)
   - `Users`
5. In `backend/.env`:
   ```env
   GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account.json"
   GOOGLE_SPREADSHEET_ID="your_google_spreadsheet_id"
   ```
