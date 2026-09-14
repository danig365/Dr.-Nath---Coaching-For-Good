import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

/**
 * Guards for pages that only some roles may open.
 *
 * These pages used to call `logout()` when the visitor was the wrong role — so
 * a client who followed a link to a coach page was signed out of the platform
 * entirely, losing a perfectly valid session with no explanation. Being on the
 * wrong page is not a reason to end someone's session.
 *
 * Each guard returns true when the caller should stop:
 *
 *   const { requireCoach } = useAccessGuard();
 *   const load = useCallback(async () => {
 *     if (requireCoach()) return;
 *     ...
 *   }, [requireCoach]);
 */
export function useAccessGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isCoach, isAdmin } = useAuth();

  // Where a signed-in user belongs — mirrors HomeGate in App.jsx.
  const home = useCallback(
    () => (isAdmin() ? "/admin" : isCoach() ? "/my-skills" : "/skills"),
    [isAdmin, isCoach]
  );

  const requireSignedIn = useCallback(() => {
    if (isAuthenticated) return false;
    const next = encodeURIComponent(location.pathname + location.search);
    navigate(`/login?next=${next}`, { replace: true });
    return true;
  }, [isAuthenticated, location, navigate]);

  const requireCoach = useCallback(() => {
    if (requireSignedIn()) return true;
    if (isCoach()) return false;
    navigate(home(), { replace: true });
    return true;
  }, [requireSignedIn, isCoach, home, navigate]);

  return { requireSignedIn, requireCoach };
}

export default useAccessGuard;
