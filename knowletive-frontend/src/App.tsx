import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Tracker from './pages/Tracker';
import Admin from './pages/Admin';
import MonthlyTimesheet from './pages/MonthlyTimesheet';
import Analytics from './pages/Analytics';
import api from './lib/api';

const PrivateRoute = ({ children, role }: { children: React.ReactNode, role?: string }) => {
  const token = localStorage.getItem('token');
  const [currentUser, setCurrentUser] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  });
  const [isValidating, setIsValidating] = useState<boolean>(!currentUser.role && !!token);

  useEffect(() => {
    if (!token) return;
    
    // If cached role is missing or invalid, refresh directly from backend /api/auth/me/
    if (!currentUser.role || (currentUser.role !== 'ADMIN' && currentUser.role !== 'EMPLOYEE')) {
      api.get('/auth/me/')
        .then((res) => {
          if (res.data?.user) {
            localStorage.setItem('user', JSON.stringify(res.data.user));
            setCurrentUser(res.data.user);
          } else {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setCurrentUser({});
          }
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setCurrentUser({});
        })
        .finally(() => {
          setIsValidating(false);
        });
    }
  }, [token, currentUser.role]);

  if (!token) return <Navigate to="/login" replace />;

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm font-medium">
        Verifying permissions...
      </div>
    );
  }

  // Security safeguard: Do NOT default unknown or corrupted users to admin
  if (!currentUser.role || (currentUser.role !== 'ADMIN' && currentUser.role !== 'EMPLOYEE')) {
    return <Navigate to="/login" replace />;
  }

  // Enforce role-based access
  if (role && currentUser.role !== role) {
    return <Navigate to={currentUser.role === 'ADMIN' ? '/admin' : '/'} replace />;
  }

  return <>{children}</>;
};

// Route component for root path '/': Admins go directly to '/admin', Employees go to '/tracker'
function RoleBasedDashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role === 'ADMIN') {
    return <Navigate to="/admin" replace />;
  }
  return <Tracker />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={<PrivateRoute><RoleBasedDashboard /></PrivateRoute>} />
        <Route path="/timesheet" element={<PrivateRoute><MonthlyTimesheet /></PrivateRoute>} />
        <Route path="/analytics" element={<PrivateRoute><Analytics /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute role="ADMIN"><Admin /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
