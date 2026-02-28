import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAUwgb0KwPzQYClbmP38F4MYmwyixn9ueU",
  authDomain: "budget-trak-4.firebaseapp.com",
  projectId: "budget-trak-4",
  storageBucket: "budget-trak-4.firebasestorage.app",
  messagingSenderId: "442190687695",
  appId: "1:442190687695:web:f4cc7528ecd7060ddef6ba",
  measurementId: "G-54RPZ9ETJJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);

export { app, analytics, auth };
