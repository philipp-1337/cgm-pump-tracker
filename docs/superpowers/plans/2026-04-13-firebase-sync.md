# Firebase Auth + Firestore Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Firebase Email/Password Auth and Firestore sync so the tracker's state is available across devices for a single user.

**Architecture:** Two new IIFE modules (`js/auth.js`, `js/sync.js`) integrate with the existing vanilla-JS module pattern. `store.saveState()` is extended to push to Firestore after writing to localStorage. `ui.js` gates app rendering on auth state and renders a login screen for unauthenticated users.

**Tech Stack:** Firebase JS SDK v10 (compat CDN), Firebase Auth (Email/Password), Cloud Firestore

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `js/firebase-config.js` | Create (gitignored) | Firebase project config + `firebase.initializeApp()` |
| `js/firebase-config.example.js` | Create | Template for the config file (committed) |
| `js/auth.js` | Create | Firebase Auth wrapper |
| `js/sync.js` | Create | Firestore push/pull wrapper + sync status |
| `js/store.js` | Modify | `saveState()` calls `sync.push()` |
| `js/ui.js` | Modify | Auth gate, login screen, sync indicator, logout |
| `index.html` | Modify | Firebase SDK scripts, new module scripts, login form HTML, sync indicator markup |
| `styles.css` | Modify | Login screen styles, sync indicator styles |
| `firestore.rules` | Create | Security rules restricting access per UID |
| `.gitignore` | Modify | Ignore `js/firebase-config.js` |

---

## Task 1: Gitignore + Firebase config files

**Files:**
- Modify: `.gitignore`
- Create: `js/firebase-config.example.js`
- Create: `js/firebase-config.js` *(fill in with real values from Firebase Console)*

- [ ] **Step 1: Add firebase-config.js to .gitignore**

Open `.gitignore` (create it if it doesn't exist) and add:

```
js/firebase-config.js
```

- [ ] **Step 2: Create the example config file**

Create `js/firebase-config.example.js`:

```js
// Copy this file to js/firebase-config.js and fill in your Firebase project values.
// Get them from: Firebase Console → Project Settings → Your apps → Web app → SDK setup
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
firebase.initializeApp(firebaseConfig);
```

- [ ] **Step 3: Create js/firebase-config.js with real values**

Go to [Firebase Console](https://console.firebase.google.com) → your project → Project Settings → General → Your apps → Web app SDK setup. Copy the config object and create `js/firebase-config.js`:

```js
const firebaseConfig = {
  apiKey: "...",          // from Firebase Console
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
firebase.initializeApp(firebaseConfig);
```

- [ ] **Step 4: Enable Email/Password auth in Firebase Console**

Firebase Console → Authentication → Sign-in method → Email/Password → Enable → Save.

- [ ] **Step 5: Create a user account**

Firebase Console → Authentication → Users → Add user → enter email + password. This will be the account used to log in.

- [ ] **Step 6: Enable Firestore**

Firebase Console → Firestore Database → Create database → Start in production mode → choose a region → Done.

- [ ] **Step 7: Commit**

```bash
git add .gitignore js/firebase-config.example.js
git commit -m "chore: add firebase config template and gitignore"
```

---

## Task 2: Create js/auth.js

**Files:**
- Create: `js/auth.js`

- [ ] **Step 1: Create the file**

Create `js/auth.js`:

```js
(function () {
  const auth = firebase.auth();

  window.CgmTrackerAuth = {
    signIn(email, password) {
      return auth.signInWithEmailAndPassword(email, password);
    },
    signOut() {
      return auth.signOut();
    },
    onStateChange(callback) {
      return auth.onAuthStateChanged(callback);
    },
    get currentUser() {
      return auth.currentUser;
    },
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add js/auth.js
git commit -m "feat: add firebase auth module"
```

---

## Task 3: Create js/sync.js

**Files:**
- Create: `js/sync.js`

- [ ] **Step 1: Create the file**

Create `js/sync.js`:

```js
(function () {
  const db = firebase.firestore();
  let currentUid = null;
  let statusCallback = null;

  function setStatus(status) {
    statusCallback?.(status);
  }

  function userDoc() {
    return db.collection("users").doc(currentUid);
  }

  async function push(state) {
    if (!currentUid) return;
    setStatus("syncing");
    try {
      await userDoc().set({ ...state, updatedAt: new Date().toISOString() });
      setStatus("synced");
    } catch (error) {
      console.error("[sync] push failed:", error);
      setStatus("offline");
    }
  }

  async function pull() {
    if (!currentUid) return null;
    try {
      const doc = await userDoc().get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error("[sync] pull failed:", error);
      return null;
    }
  }

  function setUid(uid) {
    currentUid = uid;
  }

  function onStatusChange(callback) {
    statusCallback = callback;
  }

  window.CgmTrackerSync = { push, pull, setUid, onStatusChange };
})();
```

- [ ] **Step 2: Commit**

```bash
git add js/sync.js
git commit -m "feat: add firestore sync module"
```

---

## Task 4: Modify js/store.js — hook saveState into sync

**Files:**
- Modify: `js/store.js:177-179`

The existing `saveState` function (line 177):
```js
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
}
```

- [ ] **Step 1: Extend saveState to push to Firestore**

Replace `saveState` with:

```js
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
  window.CgmTrackerSync?.push(store.state);
}
```

- [ ] **Step 2: Verify in browser (after all tasks complete)**

After completing all tasks: make a change in the app → open Firebase Console → Firestore → users → your UID document → confirm the state was written.

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "feat: push state to firestore on save"
```

---

## Task 5: Add login screen HTML + sync indicator to index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add Firebase SDK scripts before existing scripts**

In `index.html`, replace:
```html
  <script src="js/utils.js"></script>
  <script src="js/store.js"></script>
  <script src="js/ui.js"></script>
  <script src="app.js"></script>
```

With:
```html
  <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"></script>
  <script src="js/firebase-config.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/sync.js"></script>
  <script src="js/utils.js"></script>
  <script src="js/store.js"></script>
  <script src="js/ui.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 2: Add login screen markup**

Add this block immediately after `<body>` (before `<div class="page-shell">`):

```html
  <div id="auth-screen" class="auth-screen" hidden>
    <div class="auth-card">
      <p class="eyebrow">CGM & Pod Tracker</p>
      <h1 class="auth-title">Anmelden</h1>
      <form id="login-form" class="stack-lg">
        <label class="field">
          <span>E-Mail</span>
          <input type="email" id="login-email" name="login-email" autocomplete="email" required>
        </label>
        <label class="field">
          <span>Passwort</span>
          <input type="password" id="login-password" name="login-password" autocomplete="current-password" required>
        </label>
        <p id="login-error" class="login-error" hidden></p>
        <button type="submit" class="btn btn-primary" id="login-submit">Anmelden</button>
      </form>
    </div>
  </div>
```

- [ ] **Step 3: Update hero-badge to show sync status**

Replace:
```html
      <div class="hero-badge">
        <span>Privat</span>
        <strong>bleibt auf diesem Gerät</strong>
      </div>
```

With:
```html
      <div class="hero-badge" id="sync-badge">
        <span id="sync-status">–</span>
        <strong id="sync-user">–</strong>
      </div>
```

- [ ] **Step 4: Add logout button to action-menu-panel**

In the `<div class="button-row action-menu-panel">`, add a logout button after the reset button:
```html
              <button type="button" class="btn btn-ghost" id="logout-btn">Abmelden</button>
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add login screen and sync indicator markup"
```

---

## Task 6: Add login screen + sync indicator CSS to styles.css

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Read the end of styles.css to find the right insertion point**

Open `styles.css` and scroll to the bottom to find where to append new rules.

- [ ] **Step 2: Append new styles**

Append to the end of `styles.css`:

```css
/* ── Auth screen ─────────────────────────────────────────── */

.auth-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg, #f5f6f3);
  z-index: 100;
  padding: 1.5rem;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  background: #fff;
  border: 1px solid #e4e4e0;
  border-radius: 12px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.auth-title {
  font-size: 1.5rem;
  margin: 0;
}

.login-error {
  color: #c0392b;
  font-size: 0.875rem;
  margin: 0;
}

/* ── Sync status badge ───────────────────────────────────── */

#sync-badge {
  font-variant-numeric: tabular-nums;
  max-width: 14rem;
  overflow: hidden;
}

#sync-user {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}
```

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: add auth screen and sync indicator styles"
```

---

## Task 7: Modify js/ui.js — auth gate, login screen, sync status, logout

**Files:**
- Modify: `js/ui.js`

This task makes `initApp()` async and gates app startup on Firebase Auth state.

- [ ] **Step 1: Add login screen handler functions**

Find the `attachEvents` function (around line 1194). Add these new functions immediately before it:

```js
  function showAuthScreen() {
    document.getElementById("auth-screen").hidden = false;
    document.getElementById("login-email").focus();
  }

  function hideAuthScreen() {
    document.getElementById("auth-screen").hidden = true;
  }

  function setSyncStatus(status) {
    const el = document.getElementById("sync-status");
    if (!el) return;
    const labels = { syncing: "Syncing…", synced: "Synced ✓", offline: "Offline ⚠", idle: "–" };
    el.textContent = labels[status] ?? "–";
  }

  function setSyncUser(email) {
    const el = document.getElementById("sync-user");
    if (!el) return;
    el.textContent = email ?? "–";
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    const submitBtn = document.getElementById("login-submit");

    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Anmelden…";

    try {
      await window.CgmTrackerAuth.signIn(email, password);
    } catch (error) {
      const messages = {
        "auth/invalid-credential": "E-Mail oder Passwort falsch.",
        "auth/user-not-found": "Kein Konto mit dieser E-Mail.",
        "auth/wrong-password": "Passwort falsch.",
        "auth/too-many-requests": "Zu viele Versuche. Bitte später erneut versuchen.",
        "auth/network-request-failed": "Keine Verbindung. Bitte Netzwerk prüfen.",
      };
      errorEl.textContent = messages[error.code] ?? "Anmeldung fehlgeschlagen.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Anmelden";
    }
  }

  async function loadStateAfterLogin(uid) {
    window.CgmTrackerSync.setUid(uid);
    window.CgmTrackerSync.onStatusChange(setSyncStatus);

    const remote = await window.CgmTrackerSync.pull();
    const localUpdatedAt = store.state.updatedAt ?? store.state.createdAt ?? "";
    const remoteUpdatedAt = remote?.updatedAt ?? "";

    if (remote && remoteUpdatedAt > localUpdatedAt) {
      store.setState(remote);
      store.syncStateWithConfig();
      localStorage.setItem(store.STORAGE_KEY, JSON.stringify(store.state));
    }
  }
```

- [ ] **Step 2: Add logout handler to attachEvents**

Inside `attachEvents()`, add after the last existing `addEventListener` call (before the closing `}`):

```js
    document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);
    document.getElementById("logout-btn").addEventListener("click", () => {
      window.CgmTrackerAuth.signOut();
    });
```

- [ ] **Step 3: Replace initApp with async version**

Replace the existing `initApp` function (lines 1233–1249):

```js
  function initApp() {
    store.syncStateWithConfig();
    populateStaticSelects();
    populateChangeDeviceSelect();
    renderStaticLabels();
    renderConfigForm();
    seedSetupDefaults();
    bootstrapHistoryFromCurrent();
    attachEvents();

    if (store.state.current) {
      primeChangeForm();
    }

    renderAll();
    store.saveState();
  }
```

With:

```js
  async function initApp() {
    attachEvents();

    window.CgmTrackerAuth.onStateChange(async (user) => {
      if (!user) {
        setSyncUser(null);
        setSyncStatus("idle");
        showAuthScreen();
        return;
      }

      hideAuthScreen();
      setSyncUser(user.email);
      setSyncStatus("syncing");

      await loadStateAfterLogin(user.uid);

      store.syncStateWithConfig();
      populateStaticSelects();
      populateChangeDeviceSelect();
      renderStaticLabels();
      renderConfigForm();
      seedSetupDefaults();
      bootstrapHistoryFromCurrent();

      if (store.state.current) {
        primeChangeForm();
      }

      renderAll();
      store.saveState();
    });
  }
```

- [ ] **Step 4: Update resetTracker to sign out**

Find `resetTracker` (around line 1150) and add a sign-out call after `renderAll()`:

Current:
```js
  function resetTracker() {
    const confirmed = confirm("Tracker und Logbuch wirklich zurücksetzen?");
    if (!confirmed) return;

    localStorage.removeItem(store.STORAGE_KEY);
    localStorage.removeItem(store.LEGACY_STORAGE_KEY);
    store.resetState();
    seedSetupDefaults();
    renderAll();
  }
```

Replace with:
```js
  function resetTracker() {
    const confirmed = confirm("Tracker und Logbuch wirklich zurücksetzen?");
    if (!confirmed) return;

    localStorage.removeItem(store.STORAGE_KEY);
    localStorage.removeItem(store.LEGACY_STORAGE_KEY);
    store.resetState();
    store.saveState();
    window.CgmTrackerAuth.signOut();
  }
```

- [ ] **Step 5: Commit**

```bash
git add js/ui.js
git commit -m "feat: gate app on firebase auth, add login screen and sync status"
```

---

## Task 8: Add Firestore security rules

**Files:**
- Create: `firestore.rules`
- Modify: `firebase.json`

- [ ] **Step 1: Create firestore.rules**

Create `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

- [ ] **Step 2: Update firebase.json to reference the rules file**

Replace the contents of `firebase.json` with:

```json
{
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      "firestore.rules",
      "**/.*",
      "**/node_modules/**",
      "docs/**"
    ]
  },
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

- [ ] **Step 3: Deploy rules**

Run:
```bash
npx firebase-tools deploy --only firestore:rules
```

Expected: `✔ firestore: released rules firestore.rules to cloud.firestore`

If firebase-tools is not installed: `npm install -g firebase-tools && firebase login` first.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules firebase.json
git commit -m "feat: add firestore security rules"
```

---

## Task 9: End-to-end verification

No automated test framework exists in this project. Verify manually in the browser.

- [ ] **Step 1: Open the app locally**

Open `index.html` in a browser (via a local HTTP server — `python3 -m http.server 8080` or `npx serve .`). Do not open as a `file://` URL as Firebase Auth requires HTTP(S).

Expected: login screen appears, app content is not visible.

- [ ] **Step 2: Log in with wrong password**

Enter the email with a wrong password → click Anmelden.

Expected: inline error message "E-Mail oder Passwort falsch." appears. No page reload.

- [ ] **Step 3: Log in with correct credentials**

Enter the correct email + password.

Expected: login screen disappears, app renders normally, hero-badge shows email + "Synced ✓".

- [ ] **Step 4: Make a change and verify Firestore write**

Record a device change in the app. Open Firebase Console → Firestore → users → your UID document.

Expected: the document contains `history`, `current`, `config`, `sites`, `updatedAt` fields with the latest change reflected.

- [ ] **Step 5: Verify sync on second device**

Open the app on a second device or browser (private window). Log in with the same credentials.

Expected: the same state (history, current position) loads on the second device.

- [ ] **Step 6: Verify logout**

Click Aktionen → Abmelden.

Expected: app hides, login screen appears. Firestore data is not deleted.

- [ ] **Step 7: Verify reset**

Log in, click Aktionen → Neu einrichten → confirm.

Expected: data is cleared from localStorage, Firestore document is updated to empty initial state, login screen appears (signed out).

- [ ] **Step 8: Deploy to Firebase Hosting**

```bash
npx firebase-tools deploy --only hosting
```

Expected: `✔ hosting: File upload complete` and live URL returned.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat: firebase auth and firestore sync complete"
```
