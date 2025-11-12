// Enhanced Mountain Time utilities for frontend/API
// Extends the existing lib/timezone-utils.js with more features

const MOUNTAIN_TIMEZONE = 'America/Denver';

class MountainTimeManager {
  constructor() {
    this.timezone = MOUNTAIN_TIMEZONE;
  }

  // Current MT time
  now() {
    return new Date().toLocaleString("en-US", { timeZone: this.timezone });
  }

  // Format any date/time to MT
  formatMT(dateInput, options = {}) {
    const date = new Date(dateInput);
    const defaultOptions = {
      timeZone: this.timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };
    
    return date.toLocaleString('en-US', { ...defaultOptions, ...options });
  }

  // Game time formatting
  formatGameTime(dateInput) {
    const date = new Date(dateInput);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const gameDate = new Date(date.toLocaleDateString('en-US', { timeZone: this.timezone }));
    const todayMT = new Date(today.toLocaleDateString('en-US', { timeZone: this.timezone }));
    const tomorrowMT = new Date(tomorrow.toLocaleDateString('en-US', { timeZone: this.timezone }));
    
    let dayLabel = '';
    if (gameDate.getTime() === todayMT.getTime()) {
      dayLabel = 'Today';
    } else if (gameDate.getTime() === tomorrowMT.getTime()) {
      dayLabel = 'Tomorrow';
    } else {
      dayLabel = date.toLocaleDateString('en-US', { 
        timeZone: this.timezone, 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
    }
    
    const timeString = date.toLocaleTimeString('en-US', {
      timeZone: this.timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return `${dayLabel} ${timeString} MT`;
  }

  // Check if game is prime time (5 PM - 10 PM MT)
  isPrimeTime(dateInput) {
    const date = new Date(dateInput);
    const hour = parseInt(date.toLocaleString('en-US', { 
      timeZone: this.timezone, 
      hour: 'numeric', 
      hour12: false 
    }));
    return hour >= 17 && hour <= 22;
  }

  // Check if game is weekend
  isWeekend(dateInput) {
    const date = new Date(dateInput);
    const day = date.toLocaleDateString('en-US', { 
      timeZone: this.timezone, 
      weekday: 'numeric' 
    });
    return day === '6' || day === '0'; // Saturday or Sunday
  }

  // Get games by time category
  categorizeGameTime(dateInput) {
    const date = new Date(dateInput);
    const hour = parseInt(date.toLocaleString('en-US', { 
      timeZone: this.timezone, 
      hour: 'numeric', 
      hour12: false 
    }));
    
    if (hour >= 10 && hour < 13) return 'Morning';
    if (hour >= 13 && hour < 17) return 'Afternoon';
    if (hour >= 17 && hour < 20) return 'Prime Time';
    if (hour >= 20 && hour <= 23) return 'Night';
    return 'Late Night/Early Morning';
  }

  // Convert UTC timestamp from database to MT display
  fromUTC(utcString) {
    return this.formatMT(utcString + 'Z'); // Ensure UTC interpretation
  }

  // Generate MT timestamp for database insertion
  toUTC(mtDateString = null) {
    const mtDate = mtDateString ? new Date(mtDateString) : new Date();
    // Convert MT input to UTC for database storage
    const utcTime = new Date(mtDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    return utcTime.toISOString();
  }

  // Business hours check (9 AM - 6 PM MT)
  isBusinessHours(dateInput = null) {
    const date = dateInput ? new Date(dateInput) : new Date();
    const hour = parseInt(date.toLocaleString('en-US', { 
      timeZone: this.timezone, 
      hour: 'numeric', 
      hour12: false 
    }));
    const day = parseInt(date.toLocaleDateString('en-US', { 
      timeZone: this.timezone, 
      weekday: 'numeric' 
    }));
    
    return day >= 1 && day <= 5 && hour >= 9 && hour <= 18; // Mon-Fri 9AM-6PM MT
  }
}

// Export singleton instance
const MTTime = new MountainTimeManager();

// Backward compatibility with existing timezone-utils.js
function convertToMountainTime(utcTimestamp) {
  return MTTime.fromUTC(utcTimestamp);
}

function formatMountainTime(utcTimestamp, format = 'full') {
  if (format === 'time') {
    return MTTime.formatMT(utcTimestamp, { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
  }
  return MTTime.formatMT(utcTimestamp);
}

function getCurrentMountainTime() {
  return MTTime.now();
}

module.exports = {
  MTTime,
  convertToMountainTime,
  formatMountainTime,
  getCurrentMountainTime,
  // New enhanced exports
  MountainTimeManager
};