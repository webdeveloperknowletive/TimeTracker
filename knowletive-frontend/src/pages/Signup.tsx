import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Clock, User, AlertCircle, ArrowRight } from 'lucide-react';
import api from '../lib/api';

export default function Signup() {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError('Username is required.');
      return;
    }

    if (cleanUsername.length < 3) {
      setError('Username must be at least 3 characters long.');
      return;
    }

    if (!password) {
      setError('Password is required.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);

    try {
      const payload = {
        username: cleanUsername,
        password
      };

      const res = await api.post('/auth/signup/', payload);

      // Save credentials for immediate login
      if (res.data?.token && res.data?.user) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        // All public signups are Employees
        navigate('/');
      } else {
        navigate('/login');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please choose another username.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 py-8">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white shadow-sm mb-2.5">
            <Clock size={24} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Knowletive</h1>
          <p className="text-slate-500 mt-1 text-sm">Employee Time & Attendance Portal</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
          <div className="mb-5 pb-3 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-900">Create Employee Account</h2>
            <p className="text-xs text-slate-500 mt-0.5">Sign up with a username and password to track your time</p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-800 text-xs sm:text-sm">
              <AlertCircle size={18} className="shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            {/* Username Field */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Username <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. john_doe"
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Letters, numbers, underscores, and dots allowed</p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Password <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition"
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                Confirm Password <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                autoComplete="new-password"
                className={`w-full px-3.5 py-2.5 bg-white border ${
                  confirmPassword.length > 0
                    ? passwordsMatch
                      ? 'border-emerald-400'
                      : 'border-rose-400'
                    : 'border-slate-300'
                } rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition`}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-rose-600 mt-1">Passwords do not match.</p>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || (confirmPassword.length > 0 && !passwordsMatch)}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl shadow-xs transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span>Creating Employee Account...</span>
                ) : (
                  <>
                    <span>Sign Up & Start Work</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Back to Login */}
          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-600">
              Already have an account?{' '}
              <Link to="/login" className="text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2">
                Sign In
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-slate-400 text-xs mt-6">
          Knowletive Time Tracker • Secure Employee Access
        </p>
      </div>
    </div>
  );
}
