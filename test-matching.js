function teamsMatch(apiTeamName, legTeamName) {
  if (!apiTeamName || !legTeamName) return false
  
  const apiLower = apiTeamName.toLowerCase().trim()
  const legLower = legTeamName.toLowerCase().trim()
  
  console.log(`Comparing: "${apiLower}" vs "${legLower}"`)
  
  // Direct match
  if (apiLower === legLower) {
    console.log('  -> Direct match!')
    return true
  }

  // Remove common suffixes and try again
  const cleanApi = apiLower.replace(/\s+(gamecocks|miners|falcons|eagles|flames|bears)$/, '')
  const cleanLeg = legLower.replace(/\s+(gamecocks|miners|falcons|eagles|flames|bears)$/, '')
  
  if (cleanApi === cleanLeg) {
    console.log('  -> Clean match!')
    return true
  }

  // Check if one contains the other (for partial matches)
  const contains = apiLower.includes(legLower) || legLower.includes(apiLower)
  if (contains) {
    console.log('  -> Contains match!')
  } else {
    console.log('  -> No match')
  }
  return contains
}

console.log('Team matching tests:');
console.log('1. UTEP:', teamsMatch('UTEP Miners', 'UTEP Miners'));
console.log('2. Jacksonville State:', teamsMatch('Jacksonville State Gamecocks', 'Jacksonville State Gamecocks'));
console.log('3. Eastern Michigan:', teamsMatch('Eastern Michigan Eagles', 'Eastern Michigan Eagles'));
console.log('4. Bowling Green:', teamsMatch('Bowling Green Falcons', 'Bowling Green Falcons'));