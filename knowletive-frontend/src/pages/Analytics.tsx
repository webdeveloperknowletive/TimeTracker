import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  Calendar,
  LogOut,
  TrendingUp,
  ArrowLeft,
  Shield
} from 'lucide-react';
import RechartsAnalyticsDashboard from '../components/RechartsAnalyticsDashboard';

export default function Analytics() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const isAdmin = currentUser.role === 'ADMIN';

  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(isAdmin ? '/admin' : '/')}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition flex items-center gap-2 text-xs font-semibold"
            title="Go Back"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">{isAdmin ? 'Admin Console' : 'Tracker'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <TrendingUp size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base text-slate-900 tracking-tight">Knowletive</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Analytics
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {isAdmin ? 'Team performance and time insights' : 'Personal time-tracking and productivity trends'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Nav Navigation & User Profile */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            {!isAdmin && (
              <button
                onClick={() => navigate('/')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition flex items-center gap-1.5"
              >
                <Clock size={14} />
                <span>Time Tracker</span>
              </button>
            )}
            <button
              onClick={() => navigate('/timesheet')}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition flex items-center gap-1.5"
            >
              <Calendar size={14} />
              <span>Timesheets</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition flex items-center gap-1.5"
              >
                <Shield size={14} />
                <span>Admin Console</span>
              </button>
            )}
          </div>

          <div className="h-6 w-px bg-slate-200 hidden md:block" />

          {/* User Profile */}
          <div className="flex items-center gap-2.5">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-slate-900">
                {currentUser.first_name ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : (currentUser.username || 'User')}
              </p>
              <p className="text-[11px] text-slate-500 font-mono truncate max-w-[140px]">
                {currentUser.email || ''}
              </p>
            </div>

            <button
              onClick={handleSignOut}
              className="p-2 sm:px-3 sm:py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl flex items-center gap-1.5 transition shadow-2xs"
              title="Sign Out"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <RechartsAnalyticsDashboard
          onNavigateToTimesheet={() => navigate('/timesheet')}
          showTitle={true}
        />
      </main>
    </div>
  );
}
