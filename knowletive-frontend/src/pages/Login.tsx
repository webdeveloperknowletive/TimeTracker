import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Clock, AlertCircle, ArrowRight, User, Lock, Sparkles } from 'lucide-react';
import api from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = username.trim();
    const cleanPassword = password;

    if (!cleanUsername || !cleanPassword) {
      setError('Please provide your username and password.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login/', {
        username: cleanUsername,
        password: cleanPassword
      });

      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      if (res.data.user.role === 'ADMIN') {
        navigate('/admin');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden">
      {/* Decorative ambient glass spheres */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-indigo-200/40 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-violet-200/40 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-2/3 left-1/3 w-60 h-60 bg-teal-100/40 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="w-full max-w-md">
        {/* Brand Header with Clay Badge */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-[0_12px_24px_-6px_rgba(79,70,229,0.4),inset_1px_1px_2px_rgba(255,255,255,0.45)] border border-indigo-400/30 mb-3.5 transition-transform hover:scale-105 duration-200">
            <Clock size={32} className="drop-shadow-sm" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Knowletive</h1>
            <span className="clay-pill clay-pill-indigo text-[11px] font-bold">
              <Sparkles size={11} /> Hub
            </span>
          </div>
          <p className="text-slate-500 mt-1.5 text-xs sm:text-sm font-medium">
            Time & Attendance Workspace Portal
          </p>
        </div>

        {/* Claymorphic & Glassmorphic Login Card */}
        <div className="clay-card p-7 sm:p-9 relative">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Welcome Back</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Enter your credentials to access your dashboard
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-rose-50/90 border border-rose-200/80 rounded-2xl flex items-start gap-3 text-rose-900 text-xs sm:text-sm shadow-xs animate-fadeIn">
              <AlertCircle size={18} className="shrink-0 text-rose-600 mt-0.5" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Username or Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username or email"
                  required
                  autoComplete="username"
                  className="clay-input w-full pl-10 pr-3.5 py-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="clay-input w-full pl-10 pr-3.5 py-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="clay-btn clay-btn-primary w-full mt-3 py-3.5 px-4 text-sm font-semibold rounded-xl"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Authenticating...</span>
                </span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Sign Up Option */}
          <div className="mt-7 pt-5 border-t border-slate-200/60 flex items-center justify-between text-xs sm:text-sm">
            <span className="text-slate-500 font-medium">New to Knowletive?</span>
            <Link
              to="/signup"
              className="font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition-colors group"
            >
              <span>Create Account</span>
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>

        <p className="text-center text-slate-400 font-medium text-xs mt-6">
          Asia/Kolkata (IST) • Enterprise Time Tracking
        </p>
      </div>
    </div>
  );
}
