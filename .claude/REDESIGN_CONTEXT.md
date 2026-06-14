# Dr. Nath — Design System (Navy + Gold + Cream)

> Brand: **Dr. Nath · Coaching for Good** — Clarity • Growth • Impact
> Stack: React + Vite + TailwindCSS + Framer Motion + Heroicons
> Frontend dir: `/home/danishrehman/Music/SkillForge/frontend`
> Reference style: suzywelch.com (oversized light serif, full-bleed hero, pill controls)

## 1. Color Palette (from the navy/gold logo)
Defined as CSS vars in `src/index.css`:

| Token | Hex | Use |
|-------|-----|-----|
| `--navy` | `#1B2B4A` | primary, headings, dark sections, body heading text |
| `--navy-deep` | `#14213D` | deep sections, hero fallback, footer |
| `--navy-soft` | `#233A63` | navbar bg, lighter navy accents, cards on dark |
| `--gold` | `#C8A951` | accent, buttons, eyebrows, icons, dividers |
| `--gold-light` | `#E8C96A` | gold highlight / hover |
| `--gold-deep` | `#A9863A` | gold text on cream (better contrast) |
| `--cream` | `#FAF6EC` | main light page background |
| `--cream-warm` | `#F3ECD9` | alt section bg, cards on cream |
| `--slate` | `#4A5568` | body / paragraph text |
| `--slate-light` | `#7A8699` | muted text |
| hero text cream | `#F5EEC9` | pale-cream text over dark photos |

**Rule:** NEVER use the old brown palette. Map them:
- `#2C1810`/`#3D2010` (brown text/dark bg) → `#1B2B4A` navy
- `#1A0E08` (deep footer) → `#14213D`
- `#5C3D2E` (mid text) → `#4A5568` slate
- `#FEFDF5` (off-white) → `#FAF6EC` cream
- `#FFF8DC` (yellow section) → `#F3ECD9` cream-warm
- `#F5E6E0` (rose) → `#F3ECD9` cream-warm (or `#FAF6EC`)
- gold `#C8A951` stays gold (already brand-correct)

## 2. Typography
- Headings: **Playfair Display serif**, `font-normal` (400) — NOT bold. Oversized (`text-4xl`→`text-6xl`). Italic `<em>` on accent words.
  - `style={{ fontFamily: "'Playfair Display', serif" }}` or class `.font-serif-display`
- Body: **Inter sans** (default), color `--slate`.
- Eyebrow label: `text-xs font-semibold uppercase tracking-[0.22em]`, color `--gold-deep` (on light) or `--gold` (on dark).
- FAQ / list-row labels: bold **sans** (Inter), navy — not serif.

## 3. Reusable CSS classes (`src/index.css`)
- `.gold-btn` — gold gradient pill, navy text, hover lift+glow.
- `.navy-btn` — solid navy pill, cream text.
- `.outline-btn` — navy outline → gold on hover (for light bgs).
- `.animate-shimmer` — animated gold gradient text.
- `.animate-ticker` — horizontal scroll (stats bar).
- `.font-serif-display` — Playfair Display.
- Buttons are **pills** (`rounded-full`) site-wide.

## 4. Component patterns
- **Cards (on light):** `bg-white rounded-[2rem]`, `border: 1px solid rgba(27,43,74,0.1)`, hover `y:-6` + shadow. Centered content, **circular gold-tint icon** (`bg rgba(200,169,81,0.14)`, color `--gold-deep`), serif title, slate body, pill CTA.
- **Inputs:** `rounded-full` (or `rounded-xl` in dense forms), white/cream bg, border `rgba(27,43,74,0.2)`, navy text, gold focus ring. Gold icons.
- **Section eyebrow + heading:** small gold uppercase label, then large serif heading centered or left.
- **Dark sections:** navy gradient `linear-gradient(135deg, #1B2B4A, #14213D)`, cream text, gold accents.
- **Loading spinner:** gold border, `borderTopColor: transparent`.
- **Badges/tags:** gold-tint bg `rgba(200,169,81,0.14)`, text `--gold-deep`.
- **Quote/testimonial:** cream-warm rounded card, big gold serif quote marks, centered serif quote, bold navy name, gold-deep role, dots.

## 5. Layout
- **Navbar:** fixed, `h-24` (96px), lighter navy `rgba(38,56,92,0.9)` (scrolled `0.97`), backdrop-blur, gold bottom border + soft shadow. **Logo only** (image already contains wordmark), `h-20`. Full-width `px-6 sm:px-10 lg:px-20`. Public links: Home · Who is Dr Nath · Offerings · Login · Newsletter Sign Up (gold pill).
- **Hero:** full-bleed photo, content hugs left (`px-8 sm:px-12 lg:px-20`, `max-w-2xl` text). Responsive bg: `dr-nath-mobile.jpg` (`md:hidden`) / `dr-nath.jpg` (`hidden md:block`). Dark navy overlays for legibility.
- **Hero offset:** hero uses `pt-32`. Inner dashboard pages (no hero) use `min-h-screen pt-28 pb-12 px-6` with `background: #FAF6EC` to clear the `h-24` navbar.
- **Section rhythm:** `py-24 px-6`, alternate `#FAF6EC` / `#F3ECD9` / navy gradient. Content `max-w-6xl mx-auto` (text-heavy `max-w-3xl`).
- **Footer:** `#14213D`, multi-column, serif gold column headers, logo image, gold-hover links.

## 6. Assets (`frontend/public/`)
- `dr-nath-logo.png` — transparent navy/gold logo (used in navbar + footer).
- `favicon.png` — square logo.
- `dr-nath.jpg` — desktop hero (landscape, subject right).
- `dr-nath-mobile.jpg` — mobile hero (portrait).

## 7. Page / Component conversion status
✅ = on new navy theme · ⬜ = still old brown, needs conversion

### Pages
| Page | Status | Notes |
|------|--------|-------|
| Home.jsx | ✅ | reference implementation |
| Login.jsx | ✅ | done — navy theme, logo, Dr. Nath name + slogan |
| Register.jsx | ✅ | done — navy theme, logo, Dr. Nath name + slogan |
| ProfilePage.jsx | ✅ | done — coach/client/admin views |
| SkillList.jsx | ✅ | done — navy theme, has its own inline SkillCard |
| CoachDirectory.jsx | ✅ | done — navy theme, inline CoachCard |
| CoachProfile.jsx | ✅ | fully redesigned (was raw indigo/gray) |
| SmartMatch.jsx | ✅ | done — navy theme, 4-step wizard |
| BookSessionPage.jsx | ✅ | done — PaymentForm component still pending |
| MySkills.jsx | ✅ | done — inline SkillCard + delete modal |
| AddSkill.jsx | ✅ | done |
| EditSkill.jsx | ✅ | done (mirrors AddSkill) |
| MyLearning .jsx | ✅ | done — trailing space in filename; uses SessionFeedbackCard (tone="gold" pending) |
| MySessions.jsx | ✅ | done — now uses SessionFeedbackCard tone="gold" |
| MentorBookings.jsx | ✅ | done (note: dead MeetingLinkModal refs unimported FiLink, never rendered) |
| Milestones.jsx | ✅ | done — coach + client roles |
| MyBookings.jsx | ✅ | redesigned (was raw gray); legacy/may be unrouted |
| SessionChatPage.jsx | ✅ | done — chat + sidebar |
| SessionCallPage.jsx | ✅ | done — dark call bg kept intentionally |
| AdminPanel.jsx | ✅ | done — bold stat numbers kept for data readability |

### Components
| Component | Status | Notes |
|-----------|--------|-------|
| Navbar.jsx | ✅ | done (2 minor `#1A0E08` badge refs ok) |
| SkillCard.jsx | ✅ | done (shared component) |
| BookingCard.jsx | ✅ | done |
| BookingModal.jsx | ✅ | done |
| PaymentForm.jsx | ✅ | redesigned (was raw indigo) |
| SessionFeedbackCard.jsx | ✅ | added gold tone (default); emerald kept for MySessions until converted |
| SessionStatusBadge.jsx | ✅ | done — confirmed=gold, others semantic |
| EmptyState.jsx | ✅ | done |
| VideoCall.jsx | ✅ | done |

## 8. Suggested conversion order
1. **Shared components first** (appear across pages): SkillCard, BookingCard, EmptyState, SessionStatusBadge, BookingModal, PaymentForm, SessionFeedbackCard, VideoCall.
2. **Auth & public** (highest visibility): Login, Register, SkillList, CoachDirectory, CoachProfile, SmartMatch, BookSessionPage.
3. **Client dashboard:** MyLearning, Milestones, ProfilePage, SessionChatPage, SessionCallPage, MyBookings.
4. **Coach dashboard:** MySkills, AddSkill, EditSkill, MySessions, MentorBookings.
5. **Admin:** AdminPanel (largest, last).
