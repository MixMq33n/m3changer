// Public Firebase web config for the m3changer project. These values are meant to ship with the site;
// accounts are protected by Firebase Auth and the Firestore rules in firestore.rules, not by hiding this file.
export const firebaseConfig = {
  apiKey: 'AIzaSyA2V1kpJxlM0bGxnoszEiihHsOWsCErPrM',
  authDomain: 'm3changer.firebaseapp.com',
  projectId: 'm3changer',
  storageBucket: 'm3changer.firebasestorage.app',
  messagingSenderId: '930081621755',
  appId: '1:930081621755:web:746745a61df3d66021925e'
};

// OAuth "Web client" ID for the Google button (Google Identity Services). Firebase creates it automatically:
// Authentication → Sign-in method → Google → Web SDK configuration → Web client ID. Empty = Google button off.
export const googleClientId = '';

// Installer link shown in the account after sign-in. Empty = "появится позже".
export const download = { url: '', version: '7.0.9' };
