// Mountain Time utilities for Edge Functions
// Add this to your Supabase Edge Functions

/**
 * Convert UTC to Mountain Time for Edge Function logging
 */
export function toMountainTimeString(utcDate = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(utcDate);
}

/**
 * Get current Mountain Time for logging
 */
export function getCurrentMT() {
  return toMountainTimeString(new Date());
}

/**
 * Format console logs with Mountain Time
 */
export function logMT(message: string, data: any = {}) {
  console.log(`[${getCurrentMT()} MT] ${message}`, data);
}

// Example usage in your edge functions:
/*
import { logMT, toMountainTimeString } from './mt-utils.js';

export default async function handler(req) {
  logMT('🚀 Starting odds refresh');
  
  // Your existing code...
  
  logMT('✅ Odds refresh completed', {
    recordsUpdated: count,
    completedAt: getCurrentMT()
  });
}
*/