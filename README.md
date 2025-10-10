# 🎰 Cray Cray for Parlays

An AI-powered parlay betting suggestion tool that uses multi-agent architecture to generate data-driven betting recommendations.

## 🌟 Features

- **Multi-Agent AI System**: Coordinator → Odds Agent → Research Agent → Analyst Agent
- **Real-time Odds**: Fetches live odds from The Odds API for multiple sportsbooks
- **External Research**: Uses Serper API to gather injury reports, news, and analysis
- **AI-Powered Analysis**: OpenAI GPT-4 or Google Gemini for intelligent bet selection
- **Risk Levels**: Low, Medium, and High risk parlay options
- **Multiple Sports**: NFL, NBA, MLB, NHL, Soccer, NCAAF, PGA, Tennis, UFC
- **Bet Types**: Moneyline, Spreads, Player Props, TD Props, Totals, Team Props
- **Smart Caching**: Prevents stale data and optimizes API usage
- **Rate Limiting**: Protects against API abuse

## 🏗️ Architecture

```
User Request
    ↓
Carol (Coordinator Agent)
    ↓
Odd-Job (Odds Agent) → Fetches live odds from The Odds API
    ↓
Randy (Research Agent) → Gathers news, injuries, analysis
    ↓
Andy (Analyst Agent) → AI-powered bet selection
    ↓
Post-Processing → Validates odds calculations
    ↓
Final Parlay Recommendations
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- API Keys (see below)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/vinnybarbs/Cray_Cray_Parlay_App.git
cd Cray_Cray_Parlay_App
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp env.example .env.local
```

Edit `.env.local` and add your API keys:

```env
# Required
ODDS_API_KEY=your_odds_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# Optional (enhances research)
SERPER_API_KEY=your_serper_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

4. **Start the development servers**

Terminal 1 - Backend:
```bash
npm run server:dev
```

Terminal 2 - Frontend:
```bash
npm run dev
```

5. **Open the app**
```
http://localhost:3001
```

## 🔑 API Keys

### The Odds API (Required)
- **Get it**: https://the-odds-api.com/
- **Free tier**: 500 requests/month
- **Cost**: ~$0.50-1.00 per 100 requests
- **Used for**: Live odds data

### OpenAI API (Required)
- **Get it**: https://platform.openai.com/api-keys
- **Cost**: ~$0.03 per 1K tokens (GPT-4)
- **Used for**: AI-powered parlay analysis

### Serper API (Optional but Recommended)
- **Get it**: https://serper.dev/
- **Free tier**: 2,500 searches/month
- **Cost**: ~$0.50 per 100 searches
- **Used for**: Game research, injury reports, news

### Google Gemini API (Optional)
- **Get it**: https://makersuite.google.com/app/apikey
- **Used for**: Alternative to OpenAI

## 📦 Project Structure

```
Cray_Cray_Parlay_App/
├── src/                    # React frontend
│   ├── App.jsx            # Main app component
│   ├── components/        # Reusable components
│   └── main.jsx           # Entry point
├── api/                   # Backend API
│   ├── agents/           # AI agent implementations
│   │   ├── coordinator.js    # Orchestrates the workflow
│   │   ├── odds-agent.js     # Fetches odds data
│   │   ├── research-agent.js # Gathers external research
│   │   └── analyst-agent.js  # AI-powered analysis
│   ├── middleware/       # Express middleware
│   │   ├── validation.js     # Request validation
│   │   └── rateLimiter.js    # Rate limiting
│   └── generate-parlay.js # Main API handler
├── shared/               # Shared utilities
│   ├── constants.js      # Shared constants
│   ├── logger.js         # Structured logging
│   └── oddsCalculations.js # Odds math utilities
├── database/             # Database schema (future)
├── docs/                 # Architecture documentation
└── server.js             # Express server
```

## 🎮 Usage

1. **Select Sports**: Choose one or more sports (NFL, NBA, etc.)
2. **Choose Bet Types**: Moneyline, Player Props, TD Props, etc.
3. **Set Date Range**: 1-4 days of upcoming games
4. **Number of Legs**: 1-10 legs for your parlay
5. **Risk Level**: 
   - **Low**: High probability favorites (+200 to +400)
   - **Medium**: Balanced value (+400 to +600)
   - **High**: Underdogs and high variance (+600+)
6. **Select Sportsbook**: DraftKings, FanDuel, MGM, Caesars, Bet365
7. **Choose AI Model**: OpenAI or Gemini
8. **Generate**: Click to generate your parlay!

## 🧪 Testing

```bash
# Run tests (coming soon)
npm test

# Run linter
npm run lint
```

## 📊 API Rate Limits

- **Parlay Generation**: 10 requests per 15 minutes per IP
- **General Endpoints**: 60 requests per minute per IP

## 🔒 Security

- Input validation and sanitization
- Rate limiting on all endpoints
- API keys stored in environment variables
- CORS protection
- HTTPS enforcement in production

## 🐛 Known Issues

See [FIXES_SUMMARY.md](./FIXES_SUMMARY.md) for recent bug fixes and known issues.

## 📈 Roadmap

- [ ] TypeScript migration
- [ ] Comprehensive test suite
- [ ] Redis caching
- [ ] User authentication (Firebase)
- [ ] Parlay tracking and outcome monitoring
- [ ] RAG learning system for improved predictions
- [ ] Mobile app
- [ ] Social features and leaderboards

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

ISC

## ⚠️ Disclaimer

This tool is for entertainment and educational purposes only. Gambling involves risk. Please gamble responsibly and within your means. This app does not guarantee winning bets.

## 🙏 Acknowledgments

- The Odds API for odds data
- OpenAI for AI capabilities
- Serper for search functionality
- A Bisque Boys Application

---

**Made with ❤️ by the degenerate gamblers, for the degenerate gamblers** 🎰
