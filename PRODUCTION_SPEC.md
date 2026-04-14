# WaveCraft — Production Specification

**Version:** 1.0
**Date:** April 2026
**Baseline:** [POC Product Spec](./PRODUCT_SPEC.md)
**Status:** Ready for implementation

---

## 1. Product Vision

WaveCraft is a browser synth where you type an equation and it becomes a playable instrument. The POC validates the concept. The production build makes it reliable enough to charge for and smooth enough that people want to.

**Business model:** $2 one-time payment for lifetime access. Free users get a taste, then friction. Paid users get the full instrument with no interruptions, ever.

---

## 2. User Tiers

### 2.1 Free Tier (Unregistered / Unpaid)

Free users get complete access to all synth features for a **grace period** (configurable, target ~3–5 minutes of active use per session). After the grace period expires:

- **Parameter resets:** Equation, ADSR, filter, and effect parameters are reset to defaults at intervals, destroying any sound design in progress.
- **Nag overlay:** A dismissible but persistent overlay appears encouraging upgrade. Each dismiss buys a shorter window before the next one.
- **Export disabled:** No audio export.
- **Cloud presets disabled:** No save/load from server.
- **Recording limited:** Recording capped at a short duration (e.g. 10 seconds).

The goal is not to be punitive — it's to let people hear what the synth can do, feel the pain of losing their work, and decide $2 is worth it. The grace period should be long enough for someone to load a preset, play it, think "this is cool", and hit the wall.

**Session tracking:** Active use time is tracked client-side (time spent with audio engine active and notes being played, not idle tab time). The grace period resets on page reload but the nag frequency escalates across sessions via localStorage.

### 2.2 Paid Tier ($2 Lifetime)

- All features, no interruptions, no nags, no resets
- Audio export (WebM initially, WAV when available)
- Cloud preset save/load
- Full recording with no duration cap
- Priority in any future feature rollouts

### 2.3 Tier Enforcement

Tier status is determined by the server and encoded in the JWT. The client reads the tier from the token claims and enforces locally. The audio interruption / reset logic runs client-side — it doesn't need to be tamper-proof since the product is $2 and the attack surface is "someone who knows how to patch JS wants to avoid paying two dollars." That's fine. Don't over-invest in DRM.

The server is the source of truth for whether a user has paid. The client is the enforcement point for the free-tier friction. If someone defeats the client-side checks, they were never going to pay anyway.

---

## 3. Monetisation

### 3.1 Payment Flow

1. User clicks "Upgrade — $2 Lifetime" (visible in nag overlay and in the top bar)
2. Redirect to Stripe Checkout (or equivalent hosted payment page) with a one-time $2 charge
3. On success, Stripe webhook hits the backend, which sets `paid = true` on the user record
4. User is redirected back to the app; their JWT is refreshed with `tier: "paid"` in claims
5. All friction stops immediately

### 3.2 Payment Provider

Use a hosted checkout flow (Stripe Checkout, Lemon Squeezy, or Paddle). Do not build a custom payment form. The provider handles PCI compliance, receipts, and refund mechanics.

Requirements:
- One-time payment (not subscription)
- Webhook to confirm payment server-side
- Works internationally
- Handles VAT/tax if required by the provider

### 3.3 Account Requirement

Payment requires an account (email + password). Users can create an account for free (to get cloud presets eventually) but the paid flag is what removes friction. The signup → pay flow should be as short as possible — ideally one screen.

### 3.4 Refunds

Handle via the payment provider's dashboard. No in-app refund flow needed. If refunded, the backend webhook sets `paid = false` and the next JWT refresh re-applies free tier.

---

## 4. Architecture

### 4.1 High-Level Topology

```
┌─────────────┐       ┌──────────────┐       ┌───────────────┐
│   Browser    │──────▶│   API Server │──────▶│   Database    │
│  (SPA + WAA) │◀──────│  (Node/Express)│◀──────│  (SQLite/Pg)  │
└─────────────┘       └──────┬───────┘       └───────────────┘
                              │
                              ▼
                      ┌──────────────┐
                      │   Payment    │
                      │  (Stripe etc)│
                      └──────────────┘
```

The frontend is a static SPA deployed to any CDN or static host (GitHub Pages, Vercel, Netlify, Cloudflare Pages). The API server handles auth, presets, and payment webhooks. Database can stay SQLite for low traffic or move to Postgres if needed. These are deployment decisions, not architecture decisions — keep the API stateless so the backing store is swappable.

### 4.2 Frontend

**Framework:** React + Vite (same as POC).

**Key change from POC:** Decompose the single JSX file into modules. The exact decomposition is an implementation decision, but the boundaries to respect are:

- **Audio engine** (synthesis, envelope, effects, LFO processing) — no React dependency, pure JS/TS. This is the core IP. It should be testable in isolation with an `OfflineAudioContext`.
- **MIDI handling** — separate from engine, separate from UI.
- **UI components** — all the knobs, keyboards, canvases, sections.
- **State** — centralised (Zustand, Jotai, or similar). The POC's 45+ `useState` hooks scattered across one component don't scale.
- **Tier enforcement** — a single module that exposes `isFreeUser()`, `shouldInterrupt()`, `getGraceRemaining()` etc. All friction logic in one place.

**Deployment:** Static files to any CDN. The `VITE_API_BASE` env var points to the API. No server-side rendering needed.

### 4.3 Backend

**Framework:** Node.js + Express (same as POC, proven sufficient).

**Changes from POC:**

| Area | POC | Production |
|------|-----|-----------|
| Auth | JWT + bcrypt | Same, plus `tier` claim in JWT |
| Database | SQLite | SQLite initially, Postgres-ready |
| Payment | None | Stripe Checkout webhook integration |
| User table | email, password, display_name | Add `paid` boolean, `paid_at` timestamp, `stripe_customer_id` |
| Rate limiting | None | Per-IP and per-user rate limiting |
| CORS | Wide open | Restricted to known frontend origins |
| JWT secret | Potentially hardcoded | Environment variable |
| Email | None | Optional: welcome email on signup, receipt on payment |

**Webhook security:** Verify Stripe webhook signatures. Don't trust the client to report payment status.

### 4.4 Database Schema Changes

Add to users table:

| Column | Type | Default |
|--------|------|---------|
| paid | BOOLEAN | false |
| paid_at | TIMESTAMP | NULL |
| stripe_customer_id | TEXT | NULL |
| stripe_payment_id | TEXT | NULL |

Add a payments table for audit:

| Column | Type |
|--------|------|
| id | PRIMARY KEY |
| user_id | FK → users |
| stripe_payment_id | TEXT |
| amount_cents | INTEGER |
| currency | TEXT |
| status | TEXT (succeeded / refunded) |
| created_at | TIMESTAMP |

### 4.5 New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/checkout` | Yes | Create a Stripe Checkout session, return the URL |
| POST | `/api/webhooks/stripe` | No (signature verified) | Handle payment success/refund events |
| GET | `/api/me` | Yes | Now includes `tier: "free" | "paid"` |

Existing preset and auth endpoints remain unchanged.

---

## 5. Audio Engine (Production)

The engine is the product. These are the changes that matter for charging money.

### 5.1 AudioWorklet Migration

Replace `ScriptProcessorNode` with `AudioWorkletProcessor`. This is the single highest-impact change:

- Moves synthesis off the main thread → eliminates UI-induced audio glitches
- Enables 128-sample buffer blocks → latency drops from ~46ms to ~3ms
- Removes the deprecation risk

The worklet runs a processing loop similar to the current `onaudioprocess` callback. Communication between the main thread and the worklet uses `MessagePort` for parameter updates and `SharedArrayBuffer` (where available) or frequent message passing for real-time parameter changes.

The equation compiler (`mathjs`) should ideally run on the main thread with the compiled function or its output transferred to the worklet. Explore whether the compiled mathjs expression can be serialised or whether a custom expression-to-JS transpiler is needed to avoid shipping mathjs into the worklet.

### 5.2 Latency Budget

| Component | Target |
|-----------|--------|
| AudioWorklet render block | 128 samples (~2.9ms at 44.1kHz) |
| OS audio buffer | 1–2 blocks (~3–6ms) |
| MIDI → noteOn processing | < 1ms |
| **Total round-trip** | **< 10ms** |

This is fast enough that MIDI keyboard players won't perceive latency.

### 5.3 Polyphony

Add a configurable voice limit (default 16). Voice stealing strategy: release the voice with the lowest envelope gain. This prevents CPU runaway from sustained MIDI controller input.

### 5.4 Stereo Output

The worklet should output stereo. Per-voice panning is not essential for v1 but the output bus should be stereo from day one so effects (chorus, delay, reverb) can produce a stereo field.

### 5.5 Export

Replace MediaRecorder-based export with `OfflineAudioContext` rendering:
- Renders at maximum speed (not real-time)
- Outputs WAV (PCM) — universally compatible
- WebM/Opus can remain as a secondary option for smaller files

### 5.6 Anti-Aliasing

For drawn wavetables: generate band-limited mipmap levels so high notes don't alias. For equation-based oscillators: 2× oversampling with a simple decimation filter is sufficient and keeps CPU load manageable.

### 5.7 What Stays the Same

- The equation evaluation concept (`mathjs` compile + evaluate)
- 4 parameters (a, b, c, d) with LFO modulation
- ADSR envelope per voice
- The effects chain (distortion, chorus, delay, reverb) with drag reorder
- Filter (biquad, 4 types)
- 3 LFOs with same shapes and targets
- Wavetable drawing (256 samples)
- Both drum machines (VL-Tone + PO-32 Tonic)

The feature set is validated. The production work is making it solid, not adding features.

---

## 6. Free Tier Friction — Design

### 6.1 Grace Period

The grace period timer starts when the audio engine is first activated (first note played). It counts **active audio time** — time when at least one note is sounding or the drum machine is playing. Idle time (tab open but no audio) does not count toward the limit.

Target: **3–5 minutes** of active use. Make this server-configurable so it can be tuned without a deploy.

### 6.2 Interruption Sequence

After the grace period expires, interruptions follow an escalating pattern:

1. **First interruption:** Soft fade-out over 1 second. Audio muted for 3 seconds. "Upgrade for $2" overlay appears. Dismissible. Audio resumes.
2. **Repeated interruptions:** Every 30–60 seconds (decreasing interval). Same overlay, increasingly prominent.
3. **Parameter reset:** After 2–3 dismissals, the synth parameters (equation, ADSR, effects) are reset to defaults. The user's sound design is destroyed. This is the pain point — they had something good, now it's gone.
4. **Hard lock:** After extended use past the grace period (~10+ minutes total), the audio engine is suspended entirely. Overlay becomes non-dismissible. "Sign up and pay $2 to continue."

### 6.3 Nag Overlay

A modal/overlay that:
- Shows a waveform animation or screenshot of the synth in action
- Says something like: *"You've been making sounds for 3 minutes. WaveCraft is $2 — once, forever. No subscription."*
- Two buttons: **"Upgrade — $2"** and **"Maybe Later"**
- "Maybe Later" shrinks the next window before the next nag
- If the user is not signed in, the upgrade button leads to signup → checkout

### 6.4 Cross-Session Escalation

Store a `nagLevel` counter in localStorage. Each session where the user hits the grace limit increments it. Higher nag levels mean:
- Shorter grace period (down to ~1 minute at high levels)
- More aggressive interruption frequency
- Parameter resets happen sooner

This doesn't need to be bulletproof. Clearing localStorage resets it — that's fine. The nag is a nudge, not a wall.

### 6.5 What Free Users Can Always Do

- Play the synth with any equation or preset for the duration of the grace period
- Use all effects, filters, LFOs, both drum machines
- See all visualisers
- Use MIDI controllers

What they cannot do even during the grace period:
- Export audio
- Save cloud presets
- Record longer than 10 seconds

---

## 7. Auth & Identity

### 7.1 Account Creation

Keep it minimal. Email + password. Display name optional (default to email prefix).

Add:
- **Email validation** (format check, not verification email — keep friction low at signup)
- **Password requirements:** 8+ characters, no complexity rules
- **Rate limiting:** Max 5 signup attempts per IP per hour

### 7.2 JWT Claims

```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "tier": "free" | "paid",
  "iat": 1234567890,
  "exp": 1237159890
}
```

The `tier` claim drives all client-side feature gating. On payment, issue a new token with `tier: "paid"`.

### 7.3 Session Persistence

Same as POC: JWT stored in localStorage. Token checked on app load. If expired, user must re-login. Token lifetime: 30 days.

Future consideration: refresh tokens. Not needed for v1 — 30-day expiry is fine for a $2 product.

### 7.4 Password Reset

Needed before launch. Standard flow: enter email → receive reset link → set new password. Use a transactional email provider (Resend, SendGrid, Postmark). Keep it simple — one email template.

---

## 8. Preset System (Production)

### 8.1 Local Presets

Same as POC. `localStorage` under `wavecraft_user_presets`. Available to all users regardless of tier.

### 8.2 Cloud Presets (Paid Only)

Same API as POC. Server-side storage of serialised synth state. Gated behind `tier: "paid"`.

### 8.3 Preset Data Shape

Same as POC but add versioning:

```json
{
  "v": 1,
  "eq": "sin(x + a*sin(b*x))",
  "a": 3, "b": 7, "c": 0, "d": 0,
  "xScale": 1, "yScale": 1,
  "masterVolume": 0.18,
  "adsr": { "attack": 0.002, "decay": 1.2, "sustain": 0, "release": 1.1 },
  "filter": { "type": "allpass", "cutoff": 18000, "resonance": 0.7 },
  "fxParams": { ... },
  "fxOrder": ["distortion", "chorus", "delay", "reverb"],
  "lfos": [ ... ],
  "add7th": false,
  "drawnWave": null
}
```

The `v` field allows future migrations if the shape changes.

### 8.4 Future: Shared Presets

Not in v1. But the schema should accommodate it later — a `public` boolean on the presets table, a browse/search endpoint. Design the preset table with this in mind but don't build it yet.

---

## 9. Recording & Export (Production)

### 9.1 Recording

Same event-based system as POC. Changes:

- **Persist to localStorage/IndexedDB** so recordings survive page refresh
- **Duration cap for free users:** 10 seconds
- **No duration cap for paid users**
- Persist the FX chain order with the recording so playback is accurate

### 9.2 Export (Paid Only)

- Primary format: **WAV** (PCM, 16-bit, 44.1kHz) via `OfflineAudioContext`
- Secondary format: **WebM/Opus** (smaller, for sharing)
- Offline rendering: not real-time, completes as fast as the CPU allows
- Filename: `wavecraft-{preset-name}-{timestamp}.wav`

Free users see the Export button but it triggers the upgrade nag.

---

## 10. UI / UX (Production)

### 10.1 File Decomposition

Break the monolith. The exact file structure is an implementation decision, but the app should not ship as a single 4,000-line file. Logical boundaries:

- Audio engine (no React)
- Synth UI (equation, parameters, keyboard, visualisers)
- Effects UI
- Drum machine components
- Wave drawer
- Auth / account UI
- Tier enforcement / nag system
- Shared UI primitives (Knob, RotaryKnob, Section, Pill)

### 10.2 State Management

Replace the 45+ `useState` / `useRef` hooks with a centralised store. The store should be:
- Accessible by both React components and the audio engine (via refs or subscriptions)
- Serialisable for preset save/load
- Auditable (for potential undo/redo later)

### 10.3 Responsive Layout

The POC is desktop-only. Production should work on tablet. Full mobile is a stretch goal — the knob-heavy UI doesn't map well to small touch screens. At minimum:
- Tablet landscape: all features accessible
- Tablet portrait: stacked single-column layout, scrollable
- Mobile: basic playback works (keyboard + presets) but the full editor is not optimised

### 10.4 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / stop recording playback |
| R | Start / stop recording |
| Escape | Close any modal or overlay |

More can be added later. These three cover the most common interruption-to-flow scenarios.

### 10.5 Upgrade Touchpoints

The $2 upgrade prompt should appear naturally at moments of value:

- **Top bar:** Small "Upgrade" badge (always visible for free users, non-intrusive)
- **Export button:** Triggers nag if free
- **Cloud preset save:** Triggers nag if free
- **Grace period expiry:** Full overlay
- **After parameter reset:** "Your sound was reset. Upgrade to keep your work."

---

## 11. Drum Machines (Production)

Both drum machines (VL-Tone and PO-32 Tonic) carry over as-is from the POC. They are feature-complete and charming.

Production changes:
- **Persist state to localStorage** on every change (currently volatile in PO-32)
- **Combined drum presets** should save/load correctly including both machines + shared BPM
- **Free tier:** Drum machines are fully usable during the grace period. After grace period, drum playback is also interrupted.

No new drum machine features for v1.

---

## 12. MIDI (Production)

Carries over from POC. Production changes:

- **Robustness:** Handle MIDI device disconnection/reconnection gracefully (POC may drop events if a device is unplugged mid-session)
- **Status display:** Show connected device name(s) in the status pill, not just count
- **+7th feature:** Carries over unchanged

### 12.1 Future: MIDI CC Learn

Not in v1, but the architecture should make it possible to add later. The parameter store should have stable identifiers that a MIDI CC mapping could reference.

---

## 13. Visualisers (Production)

All five visualisers (waveform preview, oscilloscope, spectrum, ADSR graph, LFO scopes) carry over from the POC.

Production changes:
- **Performance:** Visualiser rendering should not cause audio glitches. If the AudioWorklet is on a separate thread (as planned), this is mostly solved. Visualiser canvas updates can drop frames without audible impact.
- **Oscilloscope and spectrum** should pull data from the AnalyserNode on the main thread (same as POC but now the analyser is fed from the worklet output, not the ScriptProcessorNode).

---

## 14. Infrastructure & Deployment

### 14.1 Frontend Hosting

Static files on a CDN. GitHub Pages (current), Vercel, Netlify, or Cloudflare Pages are all fine. The choice depends on custom domain needs and deploy workflow preference.

### 14.2 Backend Hosting

The API server needs:
- Persistent process (not serverless — SQLite needs a filesystem, and persistent WebSocket for potential future real-time features)
- HTTPS
- Webhook endpoint reachable by the payment provider

Options: Railway, Render, Fly.io, a small VPS. For a $2 product with low initial traffic, the cheapest option that stays up is the right one.

### 14.3 Domain

A custom domain improves trust for payment. Something like `wavecraft.app` or `wavecraft.synth`. This is a branding decision, not an architecture one.

### 14.4 Monitoring

At minimum:
- **Error tracking** (Sentry or equivalent) on both frontend and backend
- **Uptime monitoring** on the API endpoint
- **Payment event logging** — every webhook receipt logged with timestamp, event type, user ID

No need for analytics or usage dashboards in v1 beyond what the payment provider's dashboard shows.

---

## 15. Security

### 15.1 Payment

- Never handle card details — use the provider's hosted checkout
- Verify webhook signatures on every payment event
- Payment status is server-authoritative; client reads from JWT

### 15.2 Auth

- Bcrypt password hashing (cost 10, same as POC)
- JWT secret from environment variable, never committed to source
- Rate limit auth endpoints (signup, login, password reset)
- CORS restricted to known frontend origin(s)

### 15.3 Client-Side Enforcement

The free-tier friction (nags, resets, muting) runs entirely client-side. It's not hardened against tampering. This is intentional:
- The $2 price point doesn't justify anti-piracy investment
- The payment provider handles the actual transaction security
- Someone who patches the JS bundle to skip nags was never going to pay

### 15.4 Input Validation

- Equation input: already sandboxed by `mathjs` (no arbitrary code execution)
- Preset data: validated on server before storage (max size, JSON structure)
- API body limit: 2MB (same as POC)

---

## 16. Testing Strategy

### 16.1 Audio Engine

- **Unit tests** using `OfflineAudioContext`: feed known inputs, assert expected outputs
- Test ADSR envelope stages (attack ramp, decay curve, sustain hold, release to zero)
- Test equation evaluation for all built-in presets
- Test voice stealing when polyphony limit is reached
- Test parameter smoothing (no discontinuities)

### 16.2 API

- **Integration tests** for all endpoints: signup, login, preset CRUD, checkout session creation
- Test webhook handling: payment success, refund
- Test tier enforcement: free user can't access paid endpoints

### 16.3 UI

- **Component tests** for custom controls (Knob, RotaryKnob) — verify value changes, range clamping, reset
- **E2E smoke test** (Playwright or Cypress): load app → click preset → play note → verify audio engine activates

### 16.4 Tier Enforcement

- Test grace period timer (mock time)
- Test escalation sequence (interruptions happen at correct intervals)
- Test that paid users never see friction

---

## 17. Launch Checklist

Before charging money:

- [ ] AudioWorklet migration complete, audio is glitch-free under normal use
- [ ] Latency < 10ms for MIDI input
- [ ] Payment flow works end-to-end (Stripe test mode → webhook → tier upgrade → JWT refresh)
- [ ] Refund webhook correctly reverts tier
- [ ] Free tier friction works (grace period → interruptions → parameter reset → hard lock)
- [ ] Password reset flow works
- [ ] Error tracking deployed (frontend + backend)
- [ ] CORS locked to production origin
- [ ] JWT secret in environment, not in source
- [ ] WAV export works for paid users
- [ ] Cloud preset save/load works for paid users
- [ ] All 12 built-in presets sound correct
- [ ] Both drum machines function correctly
- [ ] MIDI hot-plug works without errors
- [ ] Tested in Chrome, Firefox, Edge
- [ ] Custom domain with HTTPS
- [ ] Terms of Service / Privacy Policy page (required for payment)
- [ ] At least one real person has gone through the full free → pay → use flow

---

## 18. What's Out of Scope for v1

These are good ideas that are not needed to launch and charge $2:

- Mobile-optimised layout
- Preset sharing / social features
- MIDI CC learn
- Multi-track recording
- Undo/redo
- Quantisation
- PWA / offline support
- User profile pages
- Subscription pricing
- Multiple payment tiers

They can all be added later. Ship the thing.

---

## 19. Success Metrics

| Metric | Target |
|--------|--------|
| Payment conversion (visitor → paid) | > 2% |
| Grace period completion rate | > 60% of sessions reach the end |
| Upgrade click rate from nag overlay | > 10% |
| Audio glitch reports post-AudioWorklet | < 1% of sessions |
| Median MIDI latency | < 10ms |
| Refund rate | < 5% |

---

## 20. Summary of Changes from POC

| Area | POC | Production |
|------|-----|-----------|
| Oscillator engine | ScriptProcessorNode (main thread, 2048 buffer) | AudioWorkletProcessor (worker thread, 128 buffer) |
| Latency | ~46ms | < 10ms |
| Output | Mono | Stereo |
| Export | WebM only, real-time | WAV + WebM, offline rendering |
| Polyphony | Unlimited (CPU-bound) | Configurable limit (default 16) with voice stealing |
| Monetisation | None | $2 lifetime via Stripe |
| Free tier | Full access | Grace period → escalating friction |
| Auth | JWT + bcrypt | Same + tier claim + payment status |
| Presets | Local + cloud (all users) | Local (all) + cloud (paid only) |
| Recording | Volatile, no limit | Persisted, 10s cap (free) / unlimited (paid) |
| Codebase | Single 4,000-line JSX | Modular decomposition |
| State | 45+ useState hooks | Centralised store |
| Testing | None | Unit (engine), integration (API), E2E (smoke) |
| Error tracking | None | Sentry or equivalent |
| CORS | Open | Restricted |
| Password reset | None | Email-based flow |
| Deployment | GitHub Pages (frontend only) | CDN (frontend) + hosted API (backend) |

---

*Build it. Ship it. Charge for it.*
