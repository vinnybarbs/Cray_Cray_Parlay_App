// Timezone utility functions for Mountain Time conversion
// Add this to your project for consistent timezone handling

/**
 * Convert UTC timestamp to Mountain Time
 * @param {string|Date} utcTime - UTC timestamp
 * @returns {string} - Formatted Mountain Time string
 */
export function toMountainTime(utcTime) {
  const date = new Date(utcTime);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

/**
 * Get current Mountain Time
 * @returns {string} - Current time in Mountain Time
 */
export function getCurrentMountainTime() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

/**
 * Convert Mountain Time to UTC for database storage
 * @param {string} mountainTime - Mountain Time string
 * @returns {Date} - UTC Date object
 */
export function mountainTimeToUTC(mountainTime) {
  // Create date assuming Mountain Time
  const tempDate = new Date(mountainTime);
  const mtOffset = tempDate.getTimezoneOffset(); // Get current offset
  const denverDate = new Date(mountainTime + ' MST'); // Force MT interpretation
  return new Date(denverDate.getTime() + (denverDate.getTimezoneOffset() * 60000));
}

/**
 * Format game commence time for display
 * @param {string} utcTime - UTC commence time from database
 * @returns {string} - Formatted game time in Mountain Time
 */
export function formatGameTime(utcTime) {
  const date = new Date(utcTime);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Get timezone abbreviation (MST/MDT)
 * @returns {string} - Current MT timezone abbreviation
 */
export function getMountainTimeZone() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Denver',
    timeZoneName: 'short'
  });
  
  return formatter.formatToParts(now)
    .find(part => part.type === 'timeZoneName')?.value || 'MT';
}

// Example usage in your components:
/*
import { toMountainTime, formatGameTime, getCurrentMountainTime } from './timezone-utils.js';

// In your suggest-picks API or components:
const formattedTime = toMountainTime(odds.last_updated);
const gameTime = formatGameTime(odds.commence_time);
const currentTime = getCurrentMountainTime();

console.log('Last updated:', formattedTime);
console.log('Game starts:', gameTime);
console.log('Current MT time:', currentTime);
*/