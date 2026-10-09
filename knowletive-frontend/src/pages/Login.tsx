import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Clock, AlertCircle, ArrowRight, User } from 'lucide-react';
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

      // Route to correct dashboard based on backend-assigned account type
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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 text-white shadow-sm mb-3">
            <Clock size={28} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Knowletive</h1>
          <p className="text-slate-500 mt-1.5 text-sm">Employee Time & Attendance Portal</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7 sm:p-8 shadow-xs">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900">Sign In</h2>
            <p className="text-xs text-slate-500 mt-0.5">Enter your username and password to access your dashboard</p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-800 text-xs sm:text-sm">
              <AlertCircle size={18} className="shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl shadow-xs transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <span>Signing in...</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Sign Up Option */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-600">Don't have an account?</span>
            <Link
              to="/signup"
              className="font-bold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 flex items-center gap-1 transition"
            >
              <span>Create Account</span>
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>

        <p className="text-center text-slate-400 text-xs mt-6">
          Asia/Kolkata timezone • Simple & Secure Authentication
        </p>
      </div>
    </div>
  );
}
