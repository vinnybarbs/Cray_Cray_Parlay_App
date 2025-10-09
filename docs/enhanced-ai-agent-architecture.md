# Enhanced AI Agent Architecture - Cray Cray Parlay App

## 🏗️ Complete Multi-Agent System Architecture

```mermaid
graph TB
    subgraph "🎯 USER INPUT LAYER"
        UI[User Interface]
        REQ[User Request]
        UI --> REQ
        REQ --> |"Sports, Bet Types, Legs, Risk Level, Sportsbook"| COORD
    end

    subgraph "🧠 MULTI-AGENT COORDINATOR"
        COORD[MultiAgentCoordinator]
        RETRY[Retry Mechanism<br/>3 Attempts Max]
        VALID[Leg Count Validator]
        COORD --> RETRY
        RETRY --> VALID
    end

    subgraph "📊 PHASE 1: ODDS ACQUISITION"
        ODDS[TargetedOddsAgent]
        CACHE[Response Cache<br/>5min TTL]
        BATCH[Request Batching]
        FALLBACK[Fallback Books]
        
        COORD --> ODDS
        ODDS --> CACHE
        ODDS --> BATCH
        ODDS --> FALLBACK
        ODDS --> |"Pre-vetted Options"| RESEARCH
    end

    subgraph "🔍 PHASE 2: RESEARCH ENHANCEMENT"
        RESEARCH[EnhancedResearchAgent]
        SERPER[Serper API]
        INSIGHTS[Research Insights]
        
        RESEARCH --> SERPER
        SERPER --> INSIGHTS
        RESEARCH --> |"Enriched Data"| ANALYST
    end

    subgraph "🎯 PHASE 3: INTELLIGENT ANALYSIS"
        ANALYST[ParlayAnalyst]
        OPENAI[OpenAI GPT-4o-mini]
        GEMINI[Gemini 2.0-flash]
        PROMPT[Dynamic Prompts]
        
        ANALYST --> PROMPT
        PROMPT --> OPENAI
        PROMPT --> GEMINI
        ANALYST --> |"Generated Content"| VALIDATION
    end

    subgraph "✅ PHASE 4: VALIDATION & CORRECTION"
        VALIDATION[Content Validation]
        CONFLICT[Conflict Detection]
        ODDS_CALC[Odds Calculator]
        LEG_COUNT[Leg Counter]
        
        VALIDATION --> CONFLICT
        VALIDATION --> ODDS_CALC
        VALIDATION --> LEG_COUNT
        LEG_COUNT --> |"If ≠ requested legs"| RETRY
        VALIDATION --> |"Corrected Content"| OUTPUT
    end

    subgraph "📤 OUTPUT LAYER"
        OUTPUT[Final Response]
        METADATA[Quality Metadata]
        
        OUTPUT --> METADATA
    end

    subgraph "🔧 EXTERNAL APIS"
        ODDS_API[The Odds API<br/>100k calls/month]
        SERPER_API[Serper API<br/>Research Data]
        OPENAI_API[OpenAI API<br/>GPT-4o-mini]
        GEMINI_API[Google Gemini API<br/>2.0-flash]
        
        ODDS --> ODDS_API
        RESEARCH --> SERPER_API
        OPENAI --> OPENAI_API
        GEMINI --> GEMINI_API
    end

    style COORD fill:#e1f5fe
    style RETRY fill:#fff3e0
    style ANALYST fill:#f3e5f5
    style VALIDATION fill:#e8f5e8
```

## 🔄 Enhanced Agentic Flow Process

### **Phase 1: User-Driven Odds Acquisition**
```mermaid
sequenceDiagram
    participant U as User
    participant C as Coordinator
    participant O as OddsAgent
    participant API as OddsAPI

    U->>C: Request (Sports, BetTypes, Legs, Risk)
    C->>O: Fetch pre-approved options
    O->>API: Pull ALL matching markets
    Note over O: Expand "ALL" to all markets
    Note over O: Cache responses (5min TTL)
    Note over O: Batch prop markets
    API-->>O: Complete odds data
    O-->>C: Pre-vetted option pool
```

### **Phase 2: Research Enhancement**
```mermaid
sequenceDiagram
    participant C as Coordinator
    participant R as ResearchAgent
    participant S as SerperAPI

    C->>R: Enrich odds data
    R->>S: Query team/player insights
    Note over R: Injury reports, trends, form
    S-->>R: Research insights
    R-->>C: Enriched data pool
```

### **Phase 3: Intelligent Analysis with Retry**
```mermaid
sequenceDiagram
    participant C as Coordinator
    participant A as Analyst
    participant AI as AI Model
    participant V as Validator

    loop Up to 3 attempts
        C->>A: Generate parlay (attempt #)
        A->>AI: Enhanced prompt with retry warnings
        Note over AI: Focus on WIN PROBABILITY
        Note over AI: Conflict prevention
        Note over AI: Exact leg count enforcement
        AI-->>A: Generated content
        A-->>C: Parlay content
        C->>V: Count legs & validate
        alt Correct leg count
            V-->>C: ✅ Success
        else Wrong leg count
            V-->>C: ❌ Retry needed
            Note over C: Increment attempt counter
        end
    end
```

## 🎯 Agent Specializations & Responsibilities

### **1. MultiAgentCoordinator**
```mermaid
graph LR
    subgraph "Coordinator Responsibilities"
        ORCH[Orchestration]
        RETRY[Retry Logic]
        VALID[Validation]
        ERROR[Error Handling]
        META[Metadata Tracking]
    end
    
    ORCH --> |"5-Phase Workflow"| RETRY
    RETRY --> |"3 Attempts Max"| VALID
    VALID --> |"Quality Assurance"| ERROR
    ERROR --> |"Comprehensive Logging"| META
```

**Key Features:**
- **5-Phase Workflow Management**
- **Retry Mechanism** (up to 3 attempts)
- **Leg Count Validation**
- **Quality Assurance**
- **Performance Monitoring**

### **2. TargetedOddsAgent**
```mermaid
graph LR
    subgraph "Odds Agent Capabilities"
        EXPAND[ALL Expansion]
        CACHE[Smart Caching]
        BATCH[Request Batching]
        FALLBACK[Fallback Books]
        FILTER[Data Filtering]
    end
    
    EXPAND --> |"All Markets"| CACHE
    CACHE --> |"5min TTL"| BATCH
    BATCH --> |"Efficiency"| FALLBACK
    FALLBACK --> |"Reliability"| FILTER
```

**Key Features:**
- **"ALL" Bet Type Expansion** to all available markets
- **Response Caching** (5-minute TTL)
- **Request Deduplication**
- **Prop Market Batching** (3 markets per call)
- **Smart Fallback Logic**

### **3. EnhancedResearchAgent**
```mermaid
graph LR
    subgraph "Research Agent Intelligence"
        SERPER[Serper Integration]
        INJURY[Injury Reports]
        TRENDS[Performance Trends]
        CONTEXT[Contextual Analysis]
        ENRICH[Data Enrichment]
    end
    
    SERPER --> |"Real-time Data"| INJURY
    INJURY --> |"Player Status"| TRENDS
    TRENDS --> |"Recent Form"| CONTEXT
    CONTEXT --> |"Match Analysis"| ENRICH
```

**Key Features:**
- **Real-time Research** via Serper API
- **Injury Report Integration**
- **Performance Trend Analysis**
- **Contextual Game Analysis**
- **Data Enrichment Pipeline**

### **4. ParlayAnalyst (Enhanced)**
```mermaid
graph LR
    subgraph "Analyst Intelligence"
        SELECT[Smart Selection]
        CONFLICT[Conflict Prevention]
        WINPROB[Win Probability Focus]
        RISK[Risk Adaptation]
        PROMPT[Dynamic Prompting]
    end
    
    SELECT --> |"Pre-vetted Pool"| CONFLICT
    CONFLICT --> |"Same-game Support"| WINPROB
    WINPROB --> |"ALL-OR-NOTHING"| RISK
    RISK --> |"Risk-appropriate"| PROMPT
```

**Key Features:**
- **Win Probability Prioritization** over flashy odds
- **Intelligent Conflict Prevention**
- **Same-game Parlay Mastery**
- **Risk-appropriate Selection Strategies**
- **Dynamic Prompt Engineering**

## 🔍 Conflict Detection & Resolution

### **Conflict Prevention Matrix**
```mermaid
graph TB
    subgraph "❌ FORBIDDEN CONFLICTS"
        REDUND[Redundant Bets<br/>Eagles ML + Eagles Spread]
        OPPOSE[Opposing Sides<br/>Eagles -7 + Giants +7]
        TOTAL[Conflicting Totals<br/>Over 47.5 + Under 47.5]
        PROP[Conflicting Props<br/>Hurts Over/Under 250 yards]
        DUPE[Duplicate Bets<br/>Same exact bet twice]
    end
    
    subgraph "✅ SMART COMBINATIONS"
        SAMEGAME[Same Game Different Types<br/>Eagles -7 + Over 47.5 + Hurts yards]
        MULTIGAME[Different Games<br/>Eagles -7 + Cowboys ML + Bills Over]
        PLAYERS[Multiple Players<br/>Hurts + Saquon + Brown + Smith]
        MARKETS[Different Markets<br/>Game total + Team total + Props]
    end
```

## 📊 Win Probability Strategy by Risk Level

### **Risk-Appropriate Selection Framework**
```mermaid
graph TB
    subgraph "🟢 LOW RISK (8-9/10 confidence)"
        LOWSTRAT[Heavy Favorites<br/>Conservative Lines<br/>Safe Bets<br/>High Win Probability]
    end
    
    subgraph "🟡 MEDIUM RISK (6-9/10 confidence)"
        MEDSTRAT[Balanced Selections<br/>Reasonable Favorites<br/>Moderate Risk<br/>Good Win Probability]
    end
    
    subgraph "🔴 HIGH RISK (3-9/10 confidence)"
        HIGHSTRAT[Strategic Variance<br/>Higher Payouts<br/>Calculated Risks<br/>Win Probability Still Priority]
    end
    
    LOWSTRAT --> |"ALL-OR-NOTHING Mindset"| RESULT[Parlay Success]
    MEDSTRAT --> |"ALL-OR-NOTHING Mindset"| RESULT
    HIGHSTRAT --> |"ALL-OR-NOTHING Mindset"| RESULT
```

## 🔄 Retry & Validation Workflow

### **Quality Assurance Pipeline**
```mermaid
graph TB
    subgraph "Validation Layers"
        LEG[Leg Count Check]
        CONF[Conflict Detection]
        ODDS[Odds Calculation]
        DATE[Date Validation]
        RESEARCH[Research Integration]
    end
    
    LEG --> |"Exact count required"| RETRY_DECISION{Retry Needed?}
    CONF --> |"No conflicts allowed"| RETRY_DECISION
    ODDS --> |"Automatic correction"| RETRY_DECISION
    DATE --> |"Accurate game dates"| RETRY_DECISION
    RESEARCH --> |"Data-driven reasoning"| RETRY_DECISION
    
    RETRY_DECISION --> |"Yes (< 3 attempts)"| RETRY[Generate Again]
    RETRY_DECISION --> |"No or Max attempts"| SUCCESS[Final Output]
    
    RETRY --> |"Enhanced prompt"| LEG
```

## 🚀 Performance Optimizations

### **System Efficiency Features**
- **Response Caching** - 5-minute TTL for odds data
- **Request Deduplication** - Avoid duplicate API calls
- **Prop Market Batching** - 3 markets per API call
- **Smart Fallbacks** - Multiple sportsbook options
- **Retry Mechanism** - Up to 3 attempts for quality
- **Conflict Pre-filtering** - Prevent invalid combinations

### **API Efficiency Metrics**
- **Odds API**: 100k calls/month with optimization
- **Serper API**: Real-time research integration  
- **OpenAI/Gemini**: Lower temperature (0.3) for consistency
- **Cache Hit Rate**: Target 70%+ for repeated requests
- **Response Time**: < 10 seconds for complex parlays

## 📈 Quality Monitoring

### **Success Metrics**
- **Leg Count Accuracy**: 100% (via retry mechanism)
- **Conflict Prevention**: 0 invalid combinations
- **Research Integration**: 90%+ legs with research context
- **Risk Compliance**: Selections match risk tolerance
- **Win Probability Focus**: Prioritized over flashy odds

This enhanced architecture represents a sophisticated multi-agent system that prioritizes **win probability**, implements **intelligent retry mechanisms**, and provides **comprehensive quality assurance** while maintaining the flexibility to support both same-game and multi-game parlay strategies.