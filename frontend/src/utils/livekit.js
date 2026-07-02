// LiveKit helpers — fetch a room access token from the backend.
//
// The backend mints a short-lived token scoped to one room, enforcing the same
// access rules as the built-in calls. The frontend uses the returned { url,
// token } to connect with livekit-client.
import { api } from "./auth";

// Token for a 1:1 session call.
export async function getBookingCallToken(bookingId) {
  const res = await api.get(`/bookings/livekit/token/booking/${bookingId}/`);
  return res.data; // { url, token, room, identity }
}

// Token for a group session call.
export async function getGroupCallToken(sessionId) {
  const res = await api.get(`/bookings/livekit/token/group/${sessionId}/`);
  return res.data; // { url, token, room, identity }
}
