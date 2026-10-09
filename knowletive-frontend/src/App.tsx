import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Tracker from './pages/Tracker';
import Admin from './pages/Admin';
import MonthlyTimesheet from './pages/MonthlyTimesheet';
import Analytics from './pages/Analytics';

const PrivateRoute = ({ children, role }: { children: React.ReactNode, role?: string }) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  
  if (!token) return <Navigate to="/login" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  
  return <>{children}</>;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={<PrivateRoute><Tracker /></PrivateRoute>} />
        <Route path="/timesheet" element={<PrivateRoute><MonthlyTimesheet /></PrivateRoute>} />
        <Route path="/analytics" element={<PrivateRoute><Analytics /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute role="ADMIN"><Admin /></PrivateRoute>} />
      </Routes>
    </Router>
  );
}

export default App;
