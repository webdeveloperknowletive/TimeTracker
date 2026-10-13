# Knowletive Time Tracker

A complete, responsive employee time-tracking web app with an accompanying Chrome extension (Manifest V3), an admin panel, a monthly employee timesheet system, and a cloud-hosted Supabase PostgreSQL database store.

## Architecture & Project Structure

The project maintains three independent components:

- **`knowletive-backend/`**: Python 3 + Django REST Framework API with Supabase PostgreSQL
- **`knowletive-frontend/`**: React 19 + TypeScript + Vite + Tailwind CSS
- **`knowletive-extension/`**: Chrome Extension (Manifest V3) in TypeScript

---

## Quick Start & Local Setup

### 1. Backend (Django REST Framework)

```powershell
cd knowletive-backend
.\venv\Scripts\activate
python manage.py migrate
python setup_admin.py
python manage.py runserver 8000
```

- **Environment Configuration:** Configured in `knowletive-backend/.env` (using `DATABASE_URL` pointing to Supabase PostgreSQL).
- **Run Automated Tests:**
  ```powershell
  python manage.py test tracker
  ```
  *(Automated test suites covering auth, role isolation, state machine transitions, deduplication, audit trails, monthly timesheets, task logging, and CSV/Excel exports.)*

### 2. Frontend Web App (React + Vite)

```powershell
cd knowletive-frontend
npm install
npm run dev
```

Visit **http://localhost:5173** in your browser.

- **Employee Flow (`/`):** Jibble-style time tracker with live ticking timer, start/break/resume/end actions, task timers, confirmation modal, daily office hours reminders (10:00 AM - 7:00 PM Asia/Kolkata), and 7-day activity history.
- **Monthly Timesheet (`/timesheet`):** Excel-inspired monthly grid showing one row per workday with Date, Day, Project, Task Name, Description, Start/End times, Total Work hours, Break duration, and Record Status. Employees can update their Project, Task, and Description with unsaved change warnings and export to CSV or Excel (`.xlsx`).
- **Admin Console (`/admin`):** Live attendance board, late start & missing clock-out detection, employee timesheet review with project/task filtering, user management (create, edit, deactivate), CSV and Excel report exports, admin time correction modal with mandatory audit reason, and audit trail logs.

### 3. Chrome Extension (Manifest V3)

1. Build/Compile extension TypeScript:
   ```powershell
   cd knowletive-extension
   npm install
   npx tsc
   ```
2. In Google Chrome, go to `chrome://extensions/`
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `knowletive-extension` folder.
5. Click the extension icon in Chrome toolbar to sign in, track time, or click the direct links to the web Tracker and Monthly Timesheet.

---

## Monthly Employee Timesheet & Editing Rules

- **Editable Fields for Employees:** For each workday, employees can add and edit their `Project Name`, `Task Name`, and `Work Description`.
- **Immutable Time Records:** Employees **cannot** edit, delete, or backdate start times, end times, breaks, or total working hours. Those are strictly calculated from server-recorded events.
- **Unsaved Changes Warning:** Prompts employees if they attempt to navigate away or switch months with uncommitted edits.
- **Admin Review:** Admins can select any employee and review their full month's timesheet, search/filter by project or task, and export to CSV/Excel.
- **Data Protection:** Backend API enforces that employees can query and update only their own timesheets (`403 Forbidden` if attempting to access another user's timesheet).

---

## Database Configuration (Supabase PostgreSQL)

The backend connects to a managed PostgreSQL database on **Supabase** via `dj-database-url`.

In `knowletive-backend/.env`:
```env
DATABASE_URL="postgresql://user:password@host:port/dbname"
DEBUG=True
DJANGO_SECRET_KEY="your-secret-key"
```
