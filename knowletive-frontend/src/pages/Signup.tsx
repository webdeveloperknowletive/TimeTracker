import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Clock, User, Lock, AlertCircle, ArrowRight, UserPlus, CheckCircle2 } from 'lucide-react';
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

      if (res.data?.token && res.data?.user) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
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
    <div className="min-h-screen flex flex-col justify-center items-center p-4 sm:p-6 py-10 relative overflow-hidden">
      {/* Decorative ambient glass spheres */}
      <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-indigo-200/40 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-violet-200/40 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-[0_12px_24px_-6px_rgba(79,70,229,0.4),inset_1px_1px_2px_rgba(255,255,255,0.45)] border border-indigo-400/30 mb-2.5 transition-transform hover:scale-105 duration-200">
            <Clock size={28} className="drop-shadow-sm" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Knowletive</h1>
          <p className="text-slate-500 mt-1 text-xs sm:text-sm font-medium">Employee Onboarding & Registration</p>
        </div>

        {/* Claymorphic Card */}
        <div className="clay-card p-7 sm:p-9 relative">
          <div className="mb-6 pb-3 border-b border-slate-200/60">
            <div className="flex items-center gap-2">
              <UserPlus size={18} className="text-indigo-600" />
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Create Employee Account</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">Sign up with a username and password to start tracking time</p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-rose-50/90 border border-rose-200/80 rounded-2xl flex items-start gap-3 text-rose-900 text-xs sm:text-sm animate-fadeIn">
              <AlertCircle size={18} className="shrink-0 text-rose-600 mt-0.5" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            {/* Username Field */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
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
                  className="clay-input w-full pl-10 pr-3.5 py-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">Letters, numbers, underscores, and dots allowed</p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  autoComplete="new-password"
                  className="clay-input w-full pl-10 pr-3.5 py-3 text-sm placeholder-slate-400 font-medium"
                />
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Confirm Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock size={16} />
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  autoComplete="new-password"
                  className={`clay-input w-full pl-10 pr-10 py-3 text-sm placeholder-slate-400 font-medium ${
                    confirmPassword.length > 0
                      ? passwordsMatch
                        ? '!border-emerald-400 !bg-emerald-50/20'
                        : '!border-rose-400 !bg-rose-50/20'
                      : ''
                  }`}
                />
                {confirmPassword.length > 0 && passwordsMatch && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-emerald-600">
                    <CheckCircle2 size={16} />
                  </div>
                )}
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-rose-600 mt-1 font-medium">Passwords do not match.</p>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || (confirmPassword.length > 0 && !passwordsMatch)}
                className="clay-btn clay-btn-primary w-full py-3.5 px-4 text-sm font-semibold rounded-xl"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Creating Account...</span>
                  </span>
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
          <div className="mt-7 pt-5 border-t border-slate-200/60 text-center">
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              Already have an account?{' '}
              <Link to="/login" className="text-indigo-600 hover:text-indigo-800 font-bold underline underline-offset-2 transition-colors">
                Sign In
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-slate-400 font-medium text-xs mt-6">
          Knowletive Time Tracker • Secure Employee Access
        </p>
      </div>
    </div>
  );
}
