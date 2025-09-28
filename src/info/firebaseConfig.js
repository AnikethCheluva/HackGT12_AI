// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
import { getAuth } from "firebase/auth";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBhTE16HMjIv9ySO8cqL6lWnVeD7gsAwyc",
  authDomain: "hackgt12project.firebaseapp.com",
  projectId: "hackgt12project",
  storageBucket: "hackgt12project.firebasestorage.app",
  messagingSenderId: "471641380199",
  appId: "1:471641380199:web:58c4df8eb02fbaf2d28bc2"
};

// Initialize Firebase
const fbApp = initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);

// Google provider and helper functions
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("https://www.googleapis.com/auth/calendar.events.readonly");
googleProvider.addScope("https://www.googleapis.com/auth/gmail.readonly");

async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(fbAuth, googleProvider);
    // result.user contains the signed in user
    return result;
  } catch (err) {
    throw err;
  }
}

async function signOut() {
  return firebaseSignOut(fbAuth);
}

const db = getDatabase(fbApp);

export { fbApp, fbAuth, googleProvider, signInWithGoogle, signOut, db };