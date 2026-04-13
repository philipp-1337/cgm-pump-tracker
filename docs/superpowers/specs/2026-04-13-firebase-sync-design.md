# Design: Firebase Auth + Firestore Sync

**Date:** 2026-04-13  
**Status:** Approved

## Goal

Make the CGM/pump tracker data available across devices using Firebase Authentication (Email + Password) and Firestore as the sync backend. The app currently stores all state in `localStorage` only.

## Architecture

### New Modules

- **`js/auth.js`** — Firebase Auth wrapper. Handles sign-in, sign-out, and auth state observation. Exposes `auth.signIn(email, password)`, `auth.signOut()`, `auth.onStateChange(callback)`.
- **`js/sync.js`** — Firestore wrapper. Handles reading and writing the user's data document. Exposes `sync.push(state)` (write) and `sync.pull()` (read). Called by `store.saveState()` when authenticated.

### Modified Files

- **`js/store.js`** — `saveState()` calls `sync.push(store.state)` after writing to `localStorage`. No other logic changes.
- **`js/ui.js`** — Shows a login screen when the user is not authenticated. Shows a sync status indicator in the header. Adds a logout button to the settings section.
- **`index.html`** — Loads the Firebase SDK (compat or modular via CDN) and the two new modules before `app.js`.

### Firebase Configuration

A `js/firebase-config.js` file (gitignored) holds the Firebase project config object. A `js/firebase-config.example.js` is committed as a template.

## Data Model

### Firestore Path

```
/users/{uid}/data
```

One document per authenticated user. Structure mirrors the existing `localStorage` state exactly, with one added field:

```json
{
  "config": { ... },
  "current": { ... },
  "history": [ ... ],
  "sites": { ... },
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

`updatedAt` is set on every write to enable conflict resolution.

## Key Flows

### App Start (authenticated)

1. Firebase SDK initializes, auth state resolves.
2. `sync.pull()` fetches Firestore document.
3. Compare `updatedAt` of Firestore doc vs. `localStorage`.
4. Load whichever is newer into `store.state`.
5. Render the app.

### App Start (not authenticated)

1. Auth state resolves to `null`.
2. UI renders the login screen (email + password form).
3. After successful sign-in, run the authenticated flow above.

### State Change

1. User action triggers `store.recordChange()` or similar.
2. `store.saveState()` writes to `localStorage` (synchronous, immediate).
3. `store.saveState()` calls `sync.push(store.state)` (async, fire-and-forget with error logging).

### First Login / Migration

On first login after this feature ships, the user's existing `localStorage` data is uploaded to Firestore automatically (it will have a newer `updatedAt` than the empty Firestore doc).

### Second Device

On a second device, `sync.pull()` returns data with a newer `updatedAt` than the empty `localStorage`. That data is loaded and also written to `localStorage` as a local cache.

## Conflict Resolution

Last-write-wins via `updatedAt`. Sufficient for a single user — simultaneous edits from two devices are not a realistic scenario for this app.

## UI

### Login Screen

- Rendered over the full viewport, same background and font as the rest of the app.
- E-Mail field, password field, submit button.
- Inline error messages for wrong credentials, network errors.
- No registration flow — the user creates their account directly in Firebase Console or via a one-time setup step.

### Sync Status Indicator

Small, unobtrusive text/icon in the header area:
- `✓ Synced` — last push succeeded
- `⟳ Syncing...` — push in flight
- `⚠ Offline` — push failed (localStorage still has the data)

### Logout

Added to the existing settings/config section. Clears the local auth session; `localStorage` data is retained locally.

## Error Handling

- Auth errors (wrong password, user not found): shown inline on the login form.
- Firestore write errors: sync indicator shows "Offline", data is safe in `localStorage`, next successful write will sync.
- Firestore read errors on startup: fall back to `localStorage` data, show a warning.

## Security Rules

Firestore security rules ensure each user can only read/write their own document:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Out of Scope

- Registration UI (account created via Firebase Console or CLI)
- Real-time `onSnapshot` listener (pull-on-load is sufficient for this use case)
- Multi-user or sharing features
- Password reset flow (can be added later)
