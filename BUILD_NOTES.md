# Build notes — what's missing / needs adjustment

Internal tracking only — not shown in the app UI (previously the 📝 "Build
notes" icon in the header opened this as a sheet; removed per request so
testers/friends don't see it, but kept here so it can be pulled back up
next time it's asked for).

- **Overlap engine (PLANNIT):** auto-finding best common slots from
  everyone's grids — flagged for a later session. Grid + colors are in;
  the math isn't.
- **Location search:** currently canned places (YMCA, Fairview, Don Mills,
  Bayview). Needs: how locations get added to a network, and region vs.
  exact-place search rules. Marked TBD.
- **Time-range replies — decided:** a suggestion only needs to overlap
  with the poster's range, not fit fully inside it — a range is the most
  you could go, not a fixed commitment. Anything beyond the overlap gets
  sorted out by message. Live in the demo feed; not wired to a real
  backend reply flow yet.
- **Custom activity trackers:** the 3 tracker types cover count / measure
  / ladder, but the "create goal" wizard (pick unit, direction,
  milestones) is a stub — needs a real flow.
- **Universal logger:** fan-out currently covers weekly chart, all-time
  stats, and the bench/swim trend cards via simple tag matching
  (Gym+Chest → bench, Swim+Distance → swim time). A real version needs a
  mapping you can edit per goal. LATER
- **Smart recommendations:** flags same-day overload (3+ intense
  activities stacked on one day) and gaps in habitual activities
  (something you usually do a lot missing from your whole visible
  window), on top of recovery rules (legs→run, back→swim, 3 hard
  days→rest). Still rule-of-thumb, not a real muscle-group/intensity
  model. LATER
- **Profile auth:** real accounts exist (username + bcrypt-hashed
  password, server-side). Still no session/JWT, so requests trust the
  acting username rather than a verified login token — fine for a
  friends-only trial, not hardened against someone spoofing a username
  via devtools. Passkeys remain a future email-free upgrade path.
- **Notifications — decided:** Privacy → Notifications lets you choose
  "Everything" or "Only join requests" for what raises the 💬 badge.
  It's poll-based (checks every few seconds while a screen's open), not a
  push notification.
- **Groups vs circles — decided:** Circles are one real, persistent
  object — create one, add/remove friends anytime, reusable as the
  audience on any post plus PLANNIT invites. SEARCH groups aren't wired
  in yet since SEARCH/Location isn't backed by real data.
- **Live status — decided:** manual only. You'd tap "I'm here" to show
  up; nothing shares your location automatically. Not built yet —
  SEARCH/Location is still canned demo data.
- **Editing/deleting posts** after friends have replied with sub-ranges —
  what happens to their replies?
- **Names:** SCHD (now labeled "Schedule") / FRDS / GLPR / PLANNIT are
  internal tab identifiers; GLPR especially reads unclear if ever surfaced.
- **PLANNIT is real** (as of the range-type revamp): events, invites,
  friend-only visibility, the availability grid, and group chat are all
  live/backend-persisted — no longer demo data. SEARCH's Person/Group/
  Activity tabs are also real now; Location is still canned demo data.
- **Milestones (GLPR)** are still local-only — no backend sharing
  mechanism, so they can't appear in FRIENDS/SEARCH feeds yet (their
  filter option in those feeds will show "nothing to show").
