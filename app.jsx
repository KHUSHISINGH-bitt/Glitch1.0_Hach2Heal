import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

// --- Firebase Configuration and Initialization ---
// These global variables are provided by the canvas environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  // Replace with your actual Firebase project config
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase services
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Use a simple, non-blocking check for the initial auth token.
if (initialAuthToken) {
  signInWithCustomToken(auth, initialAuthToken).catch(console.error);
} else {
  signInAnonymously(auth).catch(console.error);
}

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [newReminder, setNewReminder] = useState({ label: '', time: '', receivePhoneNotification: false });
  const [otpSent, setOtpSent] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [showNotificationPopup, setShowNotificationPopup] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');

  // --- Utility Functions ---
  const showCustomNotification = (message) => {
    setNotificationMessage(message);
    setShowNotificationPopup(true);
    setTimeout(() => setShowNotificationPopup(false), 3000); // Hide after 3 seconds
  };

  // --- Firebase Authentication and Data Fetching ---
  useEffect(() => {
    // Listen for authentication state changes
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthenticated(true);
        setUserId(user.uid);
      } else {
        setIsAuthenticated(false);
        setUserId(null);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthenticated && userId) {
      // Create a reference to the public reminders collection
      const remindersCollectionRef = collection(db, `artifacts/${appId}/public/data/reminders`);
      // Create a query to get reminders for the current user
      const q = query(remindersCollectionRef, where("userId", "==", userId));

      // Set up a real-time listener for reminders
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const remindersData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setReminders(remindersData);
      }, (error) => {
        console.error("Error fetching reminders:", error);
      });

      return () => unsubscribe();
    }
  }, [isAuthenticated, userId]);

  // --- Phone Auth Logic ---
  useEffect(() => {
    // Set up the reCAPTCHA verifier on component mount
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      'size': 'invisible',
      'callback': (response) => {
        // reCAPTCHA solved, you can proceed with sign-in
        console.log('reCAPTCHA verified');
      },
    });
    // This is a workaround to handle the reCAPTCHA container properly.
    // The invisible reCAPTCHA is needed to verify the user.
    // This listener ensures it is attached to the body when the component mounts.
    const recaptchaContainer = document.getElementById('recaptcha-container');
    if (!recaptchaContainer) {
      const newDiv = document.createElement('div');
      newDiv.id = 'recaptcha-container';
      document.body.appendChild(newDiv);
    }
  }, []);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    try {
      showCustomNotification('Sending OTP...');
      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
      setConfirmationResult(result);
      setOtpSent(true);
      showCustomNotification('OTP sent successfully!');
    } catch (error) {
      console.error("Error sending OTP:", error);
      showCustomNotification('Error sending OTP. Please try again.');
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!confirmationResult) return;
    try {
      await confirmationResult.confirm(otp);
      showCustomNotification('Phone number verified. You are now logged in!');
      setIsAuthenticated(true);
      setOtpSent(false); // Reset for next login
    } catch (error) {
      console.error("Error verifying OTP:", error);
      showCustomNotification('Invalid OTP. Please try again.');
    }
  };

  // --- Browser Notification Logic ---
  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showCustomNotification('Notification permission granted!');
        } else {
          showCustomNotification('Notification permission denied.');
        }
      });
    } else {
      showCustomNotification('Browser does not support notifications.');
    }
  };

  const scheduleBrowserNotification = (label, time) => {
    const reminderTime = new Date(time);
    const now = new Date();
    const timeToReminder = reminderTime.getTime() - now.getTime();

    if (timeToReminder > 0) {
      setTimeout(() => {
        if (Notification.permission === 'granted') {
          new Notification('Reminder', {
            body: `Don't forget: ${label}`,
            icon: 'https://placehold.co/60x60/88B87B/fff?text=R'
          });
        }
      }, timeToReminder);
    } else {
      // If the time is in the past, notify immediately.
      if (Notification.permission === 'granted') {
        new Notification('Reminder (Missed)', {
          body: `You missed the reminder: ${label}`,
          icon: 'https://placehold.co/60x60/FF6347/fff?text=R'
        });
      }
    }
  };

  // --- Form Handlers ---
  const handleAddReminder = async (e) => {
    e.preventDefault();
    if (!newReminder.label || !newReminder.time) {
      showCustomNotification("Please enter both a label and a time.");
      return;
    }

    // Add reminder to Firestore
    try {
      await addDoc(collection(db, `artifacts/${appId}/public/data/reminders`), {
        userId: userId,
        label: newReminder.label,
        time: newReminder.time,
        receivePhoneNotification: newReminder.receivePhoneNotification,
        createdAt: serverTimestamp(),
      });
      // Schedule browser notification if selected
      if (newReminder.receivePhoneNotification) {
        scheduleBrowserNotification(newReminder.label, newReminder.time);
      }
      setNewReminder({ label: '', time: '', receivePhoneNotification: false });
      showCustomNotification('Reminder added successfully!');
    } catch (e) {
      console.error("Error adding document: ", e);
      showCustomNotification('Failed to add reminder.');
    }
  };

  const handleDeleteReminder = async (id) => {
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/public/data/reminders`, id));
      showCustomNotification('Reminder deleted.');
    } catch (e) {
      console.error("Error deleting document: ", e);
      showCustomNotification('Failed to delete reminder.');
    }
  };

  // --- UI Components ---
  const NotificationPopup = ({ message }) => (
    <div className="fixed bottom-4 right-4 bg-gray-800 text-white p-4 rounded-lg shadow-xl animate-fade-in-up transition-opacity duration-300">
      {message}
    </div>
  );

  const LoginSignup = () => (
    <div className="p-8 w-full max-w-sm rounded-xl bg-white shadow-lg text-center">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Login / Signup</h2>
      {!otpSent ? (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <input
            type="tel"
            className="w-full p-3 rounded-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-200"
            placeholder="Enter Phone Number"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
          <button type="submit" className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition duration-200">
            Send OTP
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <p className="text-gray-600">OTP sent to {phoneNumber}.</p>
          <input
            type="text"
            className="w-full p-3 rounded-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-200"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          <button type="submit" className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition duration-200">
            Verify OTP
          </button>
        </form>
      )}
    </div>
  );

  const ReminderDashboard = () => (
    <div className="w-full max-w-3xl rounded-xl bg-white shadow-lg p-6 md:p-8">
      <div className="flex justify-between items-center mb-6 border-b pb-4">
        <h2 className="text-3xl font-bold text-gray-800">Your Reminders</h2>
        <span className="text-gray-500 text-xs truncate">User ID: {userId}</span>
      </div>

      {/* Add New Reminder Form */}
      <form onSubmit={handleAddReminder} className="space-y-4 mb-8">
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0">
          <input
            type="text"
            className="flex-1 p-3 rounded-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-200"
            placeholder="Reminder Label"
            value={newReminder.label}
            onChange={(e) => setNewReminder({ ...newReminder, label: e.target.value })}
          />
          <input
            type="datetime-local"
            className="flex-1 p-3 rounded-lg border-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition duration-200"
            value={newReminder.time}
            onChange={(e) => setNewReminder({ ...newReminder, time: e.target.value })}
          />
        </div>
        <div className="flex items-center space-x-2">
          <input
            id="notification-check"
            type="checkbox"
            className="form-checkbox h-5 w-5 text-indigo-600 rounded-md border-gray-300"
            checked={newReminder.receivePhoneNotification}
            onChange={(e) => setNewReminder({ ...newReminder, receivePhoneNotification: e.target.checked })}
          />
          <label htmlFor="notification-check" className="text-sm text-gray-700 select-none">
            Receive web notification
          </label>
        </div>
        <button
          type="submit"
          className="w-full py-3 px-4 bg-green-500 text-white rounded-lg hover:bg-green-600 transition duration-200"
        >
          Add Reminder
        </button>
      </form>
      
      {/* List of Reminders */}
      <div className="space-y-4">
        {reminders.length === 0 ? (
          <p className="text-center text-gray-500">No reminders set. Add one above!</p>
        ) : (
          reminders.map((reminder) => (
            <div key={reminder.id} className="bg-gray-100 p-4 rounded-lg flex items-center justify-between shadow-sm hover:shadow-md transition-shadow duration-200">
              <div>
                <p className="font-medium text-gray-800">{reminder.label}</p>
                <p className="text-sm text-gray-600">
                  {new Date(reminder.time).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => handleDeleteReminder(reminder.id)}
                className="text-red-500 hover:text-red-700 transition-colors duration-200 p-1"
                aria-label="Delete reminder"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 112 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mt-8 text-center">
        <button onClick={requestNotificationPermission} className="py-2 px-4 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition duration-200">
          Enable Browser Notifications
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="font-sans w-full flex items-center justify-center">
        {isAuthenticated ? <ReminderDashboard /> : <LoginSignup />}
      </div>
      <div id="recaptcha-container"></div>
      {showNotificationPopup && <NotificationPopup message={notificationMessage} />}
    </div>
  );
};

export default App;
