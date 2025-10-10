/**
 * Custom React hook for localStorage with JSON serialization
 */
import { useState, useEffect } from 'react';

export function useLocalStorage(key, initialValue) {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    
    try {
      // Get from local storage by key
      const item = window.localStorage.getItem(key);
      // Parse stored json or if none return initialValue
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      // If error also return initialValue
      console.error(`Error loading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage.
  const setValue = (value) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      // Save state
      setStoredValue(valueToStore);
      // Save to local storage
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      // A more advanced implementation would handle the error case
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue];
}

/**
 * Hook to manage parlay history in localStorage
 */
export function useParlayHistory(maxItems = 10) {
  const [history, setHistory] = useLocalStorage('parlayHistory', []);

  const addToHistory = (parlay) => {
    const newEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...parlay
    };

    setHistory((prev) => {
      const updated = [newEntry, ...prev];
      // Keep only the most recent maxItems
      return updated.slice(0, maxItems);
    });
  };

  const clearHistory = () => {
    setHistory([]);
  };

  const removeFromHistory = (id) => {
    setHistory((prev) => prev.filter(item => item.id !== id));
  };

  return {
    history,
    addToHistory,
    clearHistory,
    removeFromHistory
  };
}
