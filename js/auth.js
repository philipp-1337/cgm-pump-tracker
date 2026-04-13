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
