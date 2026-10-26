import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { actor, ready } = useAuth();
  if (!ready) return null;
  if (!actor) return <Navigate to="/login" replace />;
  return children;
}
