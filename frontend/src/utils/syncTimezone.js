import { api } from "./auth";

// Resolve the viewer's display timezone and keep client profiles in sync.
//
// Returns the timezone every page should render times in:
//   - If the profile timezone is explicitly set (not the 'UTC' default), use it.
//   - Otherwise fall back to the browser timezone for display.
//
// Backfill policy: CLIENTS have no timezone UI, so we silently capture their
// browser timezone into their profile (so email reminders match). COACHES are
// NOT auto-saved — their timezone drives slot generation, so they confirm it
// explicitly on the Availability page (we just display in browser tz until then).
// Best-effort: on any error we fall back to the browser timezone.
export async function syncTimezone() {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    const me = await api.get("/profile/");
    const profile = me.data?.profile || {};
    const current = profile.timezone;
    const isSet = current && current !== "UTC";

    if (!isSet && profile.role === "client" && browserTz !== "UTC") {
      await api.patch("/profile/", { profile: { timezone: browserTz } });
      return browserTz;
    }
    return isSet ? current : browserTz;
  } catch {
    return browserTz;
  }
}
