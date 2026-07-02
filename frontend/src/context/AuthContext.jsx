// src/context/AuthContext.js
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  getUser as getAuthUser, // Renamed to avoid state variable conflict
  loginUser as performLogin, // Renamed to avoid context function conflict
  logoutUser as performLogout, // Renamed
  refreshAuthTokens,
  clearAuthTokens,
} from "../utils/auth"; // Import all necessary functions from your auth utility
import { syncTimezone } from "../utils/syncTimezone";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  // Initialize user state by immediately trying to get the user from storage/token
  // This will return null if no valid token or expired
  const [user, setUser] = useState(() => getAuthUser());
  const [loading, setLoading] = useState(true); // State to indicate if initial auth check is complete
  const [profileComplete, setProfileComplete] = useState(() => {
    const u = getAuthUser();
    return u ? (u.is_profile_complete ?? false) : true;
  });
  // The viewer's display timezone (their profile timezone; browser as fallback).
  // Every page formats session/booking times in this zone so a coach sees their
  // chosen timezone and a client sees theirs.
  const [timezone, setTimezone] = useState(null);

  // Function to perform initial user check and token refresh on app load
  const initializeAuth = useCallback(async () => {
    const currentUser = getAuthUser(); // Get user from potentially stored token (checks expiry)

    if (currentUser) {
      // If user exists and token is valid (not expired), set it directly
      setUser(currentUser);
    } else {
      // If no user or access token expired, try refreshing the token
      const refreshed = await refreshAuthTokens();
      if (refreshed) {
        // If refresh was successful, get the new user data from the new token
        setUser(getAuthUser());
      } else {
        // No valid token and refresh failed, ensure user is null and tokens are cleared
        setUser(null);
        clearAuthTokens();
        // Optionally, redirect to login if not already there, but do this carefully
        // to avoid infinite redirects on pages that don't require auth.
        // if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        //   navigate('/login');
        // }
      }
    }
    setLoading(false); // Authentication initialization is complete
  }, [navigate]); // navigate is a dependency for useCallback

  // Run initialization once when the AuthProvider mounts
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Keep profileComplete in sync whenever the user object changes (login / refresh / logout).
  useEffect(() => {
    if (!user) { setProfileComplete(true); return; }
    setProfileComplete(user.is_profile_complete ?? false);
  }, [user]);

  // Once authenticated, resolve the viewer's display timezone (and backfill the
  // profile from the browser if it was never set). Used for all time displays.
  useEffect(() => {
    if (!user) { setTimezone(null); return; }
    syncTimezone().then(setTimezone);
  }, [user]);

  // Login function for components to call
  const login = useCallback(async (username, password) => {
    try {
      // Call the login utility function from auth.js
      const loggedInUser = await performLogin(username, password);
      if (loggedInUser) {
        setUser(loggedInUser); // Update context user state
        return loggedInUser; // Return user object for component-level redirection
      }
      return null; // Should ideally not be reached if performLogin throws on failure
    } catch (error) {
      setUser(null); // Ensure user state is null on login failure
      throw error; // Re-throw the error for the component to handle (e.g., display toast)
    }
  }, []);

  // Logout function for components to call
  const logout = useCallback(() => {
    performLogout(); // Call the logout utility function from auth.js
    setUser(null); // Clear user state in context
    navigate("/login"); // Redirect to login page after logout
  }, [navigate]);

  // Call after a successful profile PATCH. Optimistically opens the gate, then
  // mints a fresh JWT from the backend so the new is_profile_complete=true value
  // is baked into the stored token — surviving refreshes and page reloads.
  const markProfileComplete = useCallback(async () => {
    // 1. Optimistic: open the gate immediately for snappy navigation.
    setUser(prev => prev ? { ...prev, is_profile_complete: true } : prev);
    setProfileComplete(true);
    // 2. Durable: refresh the token so the stored JWT reflects the new state.
    const refreshed = await refreshAuthTokens();
    if (refreshed) setUser(getAuthUser());
  }, []);

  const contextData = {
    user, // The decoded JWT payload (or null)
    loading, // True during initial auth check
    login, // Function to log in
    logout, // Function to log out
    timezone, // The viewer's display timezone (profile tz; browser fallback)
    role: user?.role || null,
    isCoach: () => user?.role === "coach",
    isClient: () => user?.role === "client",
    isAdmin: () => user?.role === 'admin',
    approvalStatus: user?.approval_status || null,
    isMentor: () => {
      const r = user?.role;
      return r === 'coach' || r === 'mentor';
    },
    isAuthenticated: !!user,
    // Profile completion
    profileComplete,
    markProfileComplete, // call this after a successful profile PATCH
    firstName: user?.first_name || '',
    lastName: user?.last_name || '',
  };

  return (
    <AuthContext.Provider value={contextData}>
      {loading ? (
        <div className="flex justify-center items-center min-h-screen">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};

// Custom hook to consume the AuthContext
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
