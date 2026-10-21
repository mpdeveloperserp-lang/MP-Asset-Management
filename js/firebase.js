/* Firebase initialisation. SDK version is pinned; every SDK function the app uses is re-exported from here,
   so no other module imports from gstatic directly. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  sendPasswordResetEmail, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  orderBy, limit, startAfter, runTransaction, serverTimestamp, writeBatch, arrayUnion, increment,
  persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from './config.js';

/* Emulator mode — ONLY on localhost and only with ?emulator in the URL. Used by the automated test suite.
   It can never activate on the GitHub Pages site. */
const EMULATOR = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');
const cfg = EMULATOR ? {...firebaseConfig, apiKey: 'demo-key', projectId: 'demo-mp-assets', authDomain: 'localhost'} : firebaseConfig;

const app = initializeApp(cfg);
const auth = getAuth(app);
let db;
try {
  // Persistent cache: reloads resume from the local cache instead of re-reading every document (saves Firestore reads).
  db = initializeFirestore(app, EMULATOR ? {ignoreUndefinedProperties: true}
    : {ignoreUndefinedProperties: true, localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})});
} catch (e){
  console.warn('Persistent cache unavailable, using memory cache', e);
  db = initializeFirestore(app, {ignoreUndefinedProperties: true});
}
if (EMULATOR){
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
/* Secondary app instance, used by admins to create login accounts without signing themselves out. */
let secondary = null;
function secondaryAuth(){
  if (!secondary){
    secondary = getAuth(initializeApp(cfg, 'secondary'));
    if (EMULATOR) connectAuthEmulator(secondary, 'http://127.0.0.1:9099', {disableWarnings: true});
  }
  return secondary;
}

export { app, auth, db, EMULATOR, secondaryAuth,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, startAfter,
  runTransaction, serverTimestamp, writeBatch, arrayUnion, increment };
