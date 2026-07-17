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

// ── Guest invites (N4: add a 3rd/4th person to a 1:1 call) ───────────────────

// Coach: turn the shareable guest link on (returns a signed token) / off.
export async function createGuestInvite(bookingId) {
  const res = await api.post(`/bookings/${bookingId}/guest-invite/`);
  return res.data; // { active, token }
}
export async function revokeGuestInvite(bookingId) {
  const res = await api.delete(`/bookings/${bookingId}/guest-invite/`);
  return res.data; // { active: false }
}
// Coach: who's waiting + admit / deny / remove.
export async function getGuestPending(bookingId) {
  const res = await api.get(`/bookings/${bookingId}/guest-pending/`);
  return res.data; // { waiting: [{ guest_uid, name }], link_active }
}
export async function admitGuest(bookingId, guestUid) {
  return (await api.post(`/bookings/${bookingId}/guest-admit/`, { guest_uid: guestUid })).data;
}
export async function denyGuest(bookingId, guestUid) {
  return (await api.post(`/bookings/${bookingId}/guest-deny/`, { guest_uid: guestUid })).data;
}
export async function removeGuest(bookingId, identity) {
  return (await api.post(`/bookings/${bookingId}/guest-remove/`, { identity })).data;
}

// Guest (public): ask to join, poll admit status, then fetch a room token.
export async function requestGuestJoin(bookingId, token, name) {
  const res = await api.post(`/bookings/${bookingId}/guest-request/`, { token, name });
  return res.data; // { guest_uid, name }
}
export async function getGuestJoinStatus(bookingId, guestUid) {
  const res = await api.get(`/bookings/${bookingId}/guest-status/`, { params: { guest_uid: guestUid } });
  return res.data; // { status, coach_present }
}
export async function getGuestCallToken(bookingId, guestUid, token) {
  const res = await api.get(`/bookings/${bookingId}/guest-token/`, { params: { guest_uid: guestUid, t: token } });
  return res.data; // { url, token, room, identity }
}
