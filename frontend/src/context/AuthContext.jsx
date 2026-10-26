import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

const STORAGE_KEY = 'ammo_chain_session';

export function AuthProvider({ children }) {
  const [actor, setActor] = useState(null);
  const [token, setTokenState] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const { token: storedToken, user } = JSON.parse(raw);
        api.setToken(storedToken);
        setTokenState(storedToken);
        setActor(user);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setReady(true);
  }, []);

  const login = useCallback(async (username, password) => {
    const { token: newToken, user } = await api.post('/auth/login', { username, password });
    api.setToken(newToken);
    setTokenState(newToken);
    setActor(user);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: newToken, user }));
  }, []);

  const logout = useCallback(() => {
    api.setToken(null);
    setTokenState(null);
    setActor(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ actor, token, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
