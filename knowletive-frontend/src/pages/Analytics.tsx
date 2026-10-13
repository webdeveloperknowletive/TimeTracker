import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  Calendar,
  LogOut,
  TrendingUp,
  ArrowLeft,
  Shield,
  Sparkles
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
    <div className="min-h-screen text-slate-800 flex flex-col font-sans">
      {/* Top Glass Navigation Bar */}
      <header className="glass-nav sticky top-0 z-40 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(isAdmin ? '/admin' : '/')}
            className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl"
            title="Go Back"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">{isAdmin ? 'Admin Console' : 'Tracker'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-[0_8px_16px_-4px_rgba(79,70,229,0.35),inset_1px_1px_2px_rgba(255,255,255,0.4)] border border-indigo-400/30">
              <TrendingUp size={20} className="drop-shadow-xs" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base text-slate-900 tracking-tight">Knowletive</span>
                <span className="clay-pill clay-pill-indigo text-[10px]">
                  <Sparkles size={10} /> Analytics
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
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
                className="clay-btn clay-btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl"
              >
                <Clock size={14} className="text-indigo-600" />
                <span>Time Tracker</span>
              </button>
            )}
            <button
              onClick={() => navigate('/timesheet')}
              className="clay-btn clay-btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl"
            >
              <Calendar size={14} className="text-indigo-600" />
              <span>Timesheets</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="clay-btn clay-btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl"
              >
                <Shield size={14} className="text-indigo-600" />
                <span>Admin Console</span>
              </button>
            )}
          </div>

          <div className="h-6 w-px bg-slate-200/80 hidden md:block" />

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
              className="clay-btn clay-btn-secondary px-3 py-2 text-xs font-semibold rounded-xl hover:!text-rose-600"
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
