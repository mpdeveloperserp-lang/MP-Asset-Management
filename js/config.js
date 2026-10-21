/* =====================================================================
   CONFIGURATION — paste your Firebase web app config here
   ===================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyB6IbSQpDJ2FHTZ-uAJekREZJEZ9PUfmck",
  authDomain: "mp-asset-management.firebaseapp.com",
  projectId: "mp-asset-management",
  storageBucket: "mp-asset-management.firebasestorage.app",
  messagingSenderId: "452918267203",
  appId: "1:452918267203:web:7005630e82e56a16fe33f6"
};
const ORG_NAME = "MP Developers";      // shown on login and reports
const IDLE_LOGOUT_MIN = 30;             // auto sign-out after inactivity
const MAX_ROWS = 500;                   // rows rendered in the asset table

export { firebaseConfig, ORG_NAME, IDLE_LOGOUT_MIN, MAX_ROWS };
