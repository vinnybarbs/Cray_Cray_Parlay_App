# Cray Cray Parlay App - System Architecture

## 📱 **High-Level System Architecture**

```mermaid
graph TB
    subgraph "Frontend Layer"
        A[React + Vite Frontend<br/>localhost:3001] --> B[Tailwind CSS Styling]
        A --> C[User Interface Components]
    end
    
    subgraph "Backend Layer"
        D[Express.js Server<br/>localhost:5001] --> E[API Endpoints]
        E --> F[Health Check]
        E --> G[Debug Endpoints]
        E --> H[Parlay Generation]
    end
    
    subgraph "Multi-Agent System"
        I[MultiAgentCoordinator] --> J[TargetedOddsAgent]
        I --> K[EnhancedResearchAgent]
        I --> L[ParlayAnalyst]
    end
    
    subgraph "External APIs"
        M[Odds API<br/>Sports Data] --> N[100k calls/month]
        O[Serper API<br/>Research Data] --> P[Real-time insights]
        Q[OpenAI API<br/>GPT-4o-mini] --> R[Parlay generation]
        S[Gemini API<br/>2.0-flash] --> T[Alternative AI model]
    end
    
    subgraph "Infrastructure"
        U[Environment Config<br/>.env.local] --> V[API Keys]
        W[CORS Configuration] --> X[Production HTTPS]
        Y[Vercel Deployment] --> Z[Serverless Functions]
    end
    
    subgraph "Future Enhancements"
        AA[PostgreSQL Database] --> BB[RAG Learning System]
        CC[ParlayTracker Service] --> DD[Outcome Analytics]
        EE[Vector Embeddings] --> FF[Performance Learning]
    end
    
    A --> D
    D --> I
    J --> M
    K --> O
    L --> Q
    L --> S
    I --> A
    U --> D
    W --> D
    Y --> D
    
    style A fill:#e1f5fe
    style D fill:#f3e5f5
    style I fill:#fff3e0
    style M fill:#e8f5e8
    style AA fill:#fce4ec
```

## 🏗️ **Detailed Component Architecture**

### **Frontend Components**
```
React App (Vite)
├── src/
│   ├── App.jsx (Main application)
│   ├── main.jsx (Entry point)
│   ├── index.css (Global styles)
│   └── assets/ (Static resources)
├── Tailwind CSS (Styling framework)
├── Vite Config (Build tool)
└── Proxy to localhost:5001 (API communication)
```

### **Backend Structure**
```
Express.js Server
├── server.js (Main server file)
├── api/
│   ├── generate-parlay.js (Main endpoint)
│   ├── health.js (Health checks)
│   ├── debug-odds.js (Debug utilities)
│   └── agents/ (Multi-agent system)
├── scripts/ (Utility scripts)
├── services/ (Business logic)
└── database/ (Schema & models)
```

### **Multi-Agent System**
```
MultiAgentCoordinator
├── Phase 1: Data Collection (TargetedOddsAgent)
├── Phase 2: Research Enhancement (EnhancedResearchAgent)  
├── Phase 3: AI Generation (ParlayAnalyst)
├── Phase 4: Validation & Odds Calculation
└── Phase 5: Quality Assurance & Formatting
```

## 🔄 **Data Flow Architecture**

```mermaid
sequenceDiagram
    participant U as User Interface
    participant S as Express Server
    participant C as MultiAgentCoordinator
    participant O as OddsAgent
    participant R as ResearchAgent
    participant A as AnalystAgent
    participant E as External APIs
    
    U->>S: POST /api/generate-parlay
    S->>C: Initialize with user preferences
    
    Note over C: Phase 1: Data Collection
    C->>O: Fetch odds for selected sports/books
    O->>E: Query Odds API with caching
    E-->>O: Return sports odds data
    O-->>C: Processed odds with fallbacks
    
    Note over C: Phase 2: Research Enhancement
    C->>R: Enhance games with research
    R->>E: Query Serper API for insights
    E-->>R: Return research data
    R-->>C: Games enriched with research
    
    Note over C: Phase 3: AI Generation
    C->>A: Generate parlay with AI
    A->>E: Query OpenAI/Gemini API
    E-->>A: Return generated parlay
    A-->>C: Raw parlay content
    
    Note over C: Phase 4: Validation
    C->>C: Validate conflicts & calculate odds
    
    Note over C: Phase 5: Quality Assurance
    C->>C: Final formatting & metadata
    
    C-->>S: Complete parlay response
    S-->>U: JSON response with parlay
```

## 🚀 **Deployment Architecture**

### **Development Environment**
```
Local Development
├── Frontend: localhost:3001 (Vite dev server)
├── Backend: localhost:5001 (Express server)
├── Environment: .env.local (API keys)
├── CORS: Enabled for local development
└── Hot Reload: Both frontend and backend
```

### **Production Environment**
```
Vercel Deployment
├── Frontend: Static React build
├── Backend: Serverless functions (/api/*)
├── Environment: Vercel environment variables
├── CORS: Configured for production domains
├── HTTPS: Automatic SSL certificates
└── CDN: Global content delivery
```

## 🔧 **Configuration Architecture**

### **Environment Management**
```
Environment Variables
├── .env.local (Local development)
├── .env (Fallback configuration)
├── API Keys:
│   ├── ODDS_API_KEY (Sports data)
│   ├── SERPER_API_KEY (Research)
│   ├── OPENAI_API_KEY (AI generation)
│   └── GEMINI_API_KEY (Alternative AI)
└── Configuration:
    ├── NODE_ENV (Environment detection)
    └── FRONTEND_URL (CORS configuration)
```

### **Build Configuration**
```
Build Tools
├── Vite (Frontend bundling)
├── Tailwind CSS (Utility-first styling)
├── ESLint (Code quality)
├── PostCSS (CSS processing)
└── Package.json (Dependencies & scripts)
```

## 📊 **Performance & Monitoring**

### **Optimization Features**
```
Performance Optimizations
├── Response Caching (5-minute TTL)
├── Request Deduplication
├── Prop Market Batching (3 markets/call)
├── API Rate Limiting
├── Fallback Sportsbook Logic
└── Error Handling & Retry Logic
```

### **Monitoring Endpoints**
```
Health & Debug
├── /health (System status)
├── /debug/odds-test (API connectivity)
├── Environment validation
├── API key verification
└── Performance metrics
```