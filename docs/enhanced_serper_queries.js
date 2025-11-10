// Enhanced Serper search queries for sophisticated AI analysis
// Current vs Enhanced comparison

const ENHANCED_INTELLIGENCE_CONFIG = {
  searchCategories: {
    // ============================================
    // EXISTING (Working well)
    // ============================================
    injuries: {
      priority: 1,
      searchesPerSport: 6,
      queryTemplate: "{team} injury report latest news",
      expiresHours: 12
    },

    // ============================================
    // ENHANCED ANALYST INTELLIGENCE
    // ============================================
    expert_analysis: {
      priority: 2,
      searchesPerSport: 5,
      queries: [
        "{team} expert picks predictions betting analysis", // Current
        "{team} vs {opponent} matchup analysis expert preview", // NEW: Head-to-head
        "sharp money {team} {sport} betting line movement", // NEW: Sharp action
        "{team} advanced analytics efficiency ratings", // NEW: Analytics-based
        "{team} fade or follow expert consensus {sport}" // NEW: Contrarian signals
      ],
      expiresHours: 24
    },

    // ============================================
    // SITUATIONAL INTELLIGENCE (NEW CATEGORY)
    // ============================================
    situational_edges: {
      priority: 2.5, 
      searchesPerSport: 4,
      queries: [
        "{team} revenge game narrative {sport}", 
        "{team} rest advantage back to back {sport}",
        "{team} home field advantage weather {sport}",
        "{team} trap game look ahead spot {sport}"
      ],
      expiresHours: 48
    },

    // ============================================
    // ENHANCED MARKET INTELLIGENCE
    // ============================================
    market_sentiment: {
      priority: 3,
      searchesPerSport: 4,
      queries: [
        "{sport} public betting percentages fade the public", // Current enhanced
        "{team} line movement steam moves sharp action", // NEW: Line movement
        "{team} contrarian betting value overreaction", // NEW: Contrarian spots
        "{sport} betting model predictions vs Vegas" // NEW: Model divergence
      ],
      expiresHours: 6
    },

    // ============================================
    // INSIDER INFORMATION (NEW CATEGORY)
    // ============================================
    insider_intelligence: {
      priority: 4,
      searchesPerSport: 3,
      queries: [
        "{team} insider reports locker room chemistry",
        "{team} coaching changes game plan adjustments", 
        "{team} motivation factors playoff implications"
      ],
      expiresHours: 24
    },

    // ============================================
    // HISTORICAL CONTEXT (NEW CATEGORY)  
    // ============================================
    historical_trends: {
      priority: 5,
      searchesPerSport: 2,
      queries: [
        "{team} historical performance similar situations",
        "{team} vs {opponent} head to head betting trends"
      ],
      expiresHours: 72 // Less frequent, more stable
    }
  }
};