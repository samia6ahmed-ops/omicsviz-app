import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase, authConfigured } from "./supabaseClient";

const AuthCtx = createContext({
  user: null,
  loading: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(authConfigured);

  useEffect(() => {
    if (!authConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!authConfigured) throw new Error("Accounts aren't configured yet.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email, password) => {
    if (!authConfigured) throw new Error("Accounts aren't configured yet.");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!authConfigured) return;
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signUp, signOut, authConfigured }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
