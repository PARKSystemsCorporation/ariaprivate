# ARIA - Adaptive Resonance Intelligence Architecture

A pure word graph response system for GARI. Unlike KIRA which uses LLMs, ARIA generates responses by walking word correlation graphs built from chat messages.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER MESSAGES                               │
│  "The weather is beautiful today"                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TOKENIZER                                   │
│  [the] [weather] [is] [beautiful] [today]                       │
│  (pure words, no POS tagging, no stopword removal)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PAIR EXTRACTION                                │
│  weather↔beautiful, weather↔today, beautiful↔today              │
│  (all pairs scored by proximity)                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PROXIMITY SCORING                              │
│  Adjacent (distance 1):     score = 0.10                        │
│  Distance 2:                score = 0.08                        │
│  Distance 3-4:              score = 0.05                        │
│  Distance 5-7:              score = 0.03                        │
│  Further:                   score = 0.01                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TIER STORAGE                                   │
│  aria_short  (0-30%):   Fast decay, new correlations            │
│  aria_medium (30-80%):  Medium decay, reinforced correlations   │
│  aria_long   (80%+):    Slow decay, strong memories             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PHRASE BUILDING                                │
│  weather↔beautiful + beautiful↔today = "weather beautiful today"│
│  (connected correlations form phrases)                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   RESPONSE GENERATION                            │
│  Build word graph from correlations                              │
│  Walk graph from input keywords                                  │
│  Join paths into response fragments                              │
│  ⚠️ NO LLM - Pure graph walking                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Differences from KIRA

| Feature | KIRA | ARIA |
|---------|------|------|
| Response Generation | LLM (Groq/Ollama) | Graph Walking |
| Word Processing | POS Tagging | Pure Tokens |
| Stopword Removal | Yes | No |
| Grammar Awareness | Yes | No |
| Output Style | Natural sentences | Word associations |
| Dependencies | LLM API | None |

## Tier System

| Tier | Score Threshold | Decay Rate | Decay Interval |
|------|-----------------|------------|----------------|
| SHORT | 0% - 30% | 15% | Every 50 messages |
| MEDIUM | 30% - 80% | 5% | Every 200 messages |
| LONG | 80%+ | 1% | Every 1000 messages |

## Database Tables

All tables are prefixed with `aria_` to stay separate from KIRA:

- `aria_purgatory` - Temporary word storage
- `aria_short` - Short-term correlations
- `aria_medium` - Medium-term correlations
- `aria_long` - Long-term correlations
- `aria_phrases` - Multi-word associations
- `aria_decay` - Graveyard for forgotten correlations
- `aria_messages` - Chat message history
- `aria_message_counter` - Global message index

## Installation

1. **Clone and install:**
```bash
git clone <your-aria-repo>
cd aria-system
npm install
```

2. **Set up environment:**
```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

3. **Run migrations:**
   - Go to Supabase SQL Editor
   - Run `migrations/001_aria_tables.sql`

4. **Start:**
```bash
npm start
```

## Deployment on Railway

1. Create new Railway project
2. Connect to your GitHub repo
3. Set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy automatically detects Dockerfile

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/memory/stats` | GET | Memory statistics |
| `/api/memory/search?q=word` | GET | Search correlations |
| `/api/memory/context` | GET | Full memory context |
| `/api/chat` | POST | Generate ARIA response |
| `/api/aria` | GET | ARIA configuration |
| `/api/aria/respond` | POST | Force ARIA response |

## Usage

### Chat Interface
Access at `thisisgari.com/aria.html`

### API Chat
```bash
curl -X POST https://your-railway-url/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What do you know about weather?"}'
```

### Search Memory
```bash
curl https://your-railway-url/api/memory/search?q=weather
```

## How ARIA Generates Responses

1. **Extract keywords** from user input
2. **Search correlations** containing those keywords
3. **Build word graph** from all related correlations
4. **Walk the graph** from starting keywords
5. **Collect paths** as response fragments
6. **Join fragments** into final response

Example:
```
Input: "What's the weather like?"
Keywords: [weather, like]
Graph walk from "weather": weather → beautiful → day → sunny
Response: "weather beautiful day sunny"
```

## Files

```
aria-system/
├── server.js              # Main entry point + API
├── ariaCorrelator.js      # Correlation engine
├── ariaGenerator.js       # Response generation (graph walking)
├── aria.html              # Chat interface
├── package.json
├── Dockerfile
├── railway.json
├── .env.example
├── migrations/
│   └── 001_aria_tables.sql
└── README.md
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `PORT` | HTTP server port | No (default: 3002) |
