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
