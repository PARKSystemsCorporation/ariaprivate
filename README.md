# ARIA - Adaptive Resonance Intelligence Architecture

A pure word graph response system for GARI. Unlike KIRA which uses LLMs, ARIA generates responses by walking word correlation graphs built from chat messages.

## NEW: Cluster-to-Cluster Links

ARIA now includes **second-order correlations** - connections between clusters that enable coherent multi-step sequences instead of random word fragments.

### Before (Word-only)
```
Input: "What's the weather like?"
Output: "you me did something weather"  ❌ Incoherent babbling
```

### After (With Cluster Links)
```
Input: "What's the weather like?"
Output: "the weather is beautiful today sunny"  ✅ Coherent sequence
```

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
│                   CLUSTER EXTRACTION (NEW)                       │
│  1-word: [the] [weather] [is] [beautiful] [today]               │
│  2-word: [the_weather] [weather_is] [is_beautiful] [beautiful_today] │
│  3-word: [the_weather_is] [weather_is_beautiful] [is_beautiful_today] │
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
│                   CLUSTER LINKING (NEW)                          │
│  weather → weather_is (0.05)                                    │
│  weather_is → is_beautiful (0.05)                               │
│  is_beautiful → beautiful_today (0.05)                          │
│  (directional links between adjacent clusters)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TIER STORAGE                                   │
│  aria_short  (0-30%):   Fast decay, new correlations            │
│  aria_medium (30-80%):  Medium decay, reinforced correlations   │
│  aria_long   (80%+):    Slow decay, strong memories             │
│  aria_cluster_links:    Cluster-to-cluster connections (NEW)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   RESPONSE GENERATION                            │
│  1. Build cluster graph from links                               │
│  2. Find starting cluster from input keywords                    │
│  3. Walk cluster graph following highest-weighted links          │
│  4. Merge cluster sequence into coherent text                    │
│  5. Fall back to word graph if needed                           │
│  ⚠️ NO LLM - Pure graph walking                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Cluster Link System

### How Cluster Links Work

When a message is processed:
1. Extract all 1-word, 2-word, and 3-word clusters
2. Create **directional links** between adjacent clusters (window size 2-3)
3. Reinforce existing links when patterns repeat

Example from "The weather is beautiful today":
```
Clusters: [the, weather, is, beautiful, today, the_weather, weather_is, ...]

Links created:
  the → weather (forward)
  weather → the (bidirectional, lower weight)
  the → the_weather (forward)
  the_weather → weather_is (forward)
  weather_is → is_beautiful (forward)
  ...
```

### Link Scoring

| Condition | Score Added |
|-----------|-------------|
| Adjacent clusters (distance 1) | +0.05 |
| Distance 2 | +0.035 |
| Distance 3 | +0.02 |
| Reinforcement | +0.015 |

### Response Generation with Clusters

1. **Extract input clusters** from user message
2. **Build cluster graph** from stored links
3. **Find best starting cluster** (matching input keywords)
4. **Walk the graph** following highest-weighted outgoing links
5. **Merge clusters** into text, removing overlapping words
6. **Fall back to word graph** if cluster path is too short

## Key Differences from KIRA

| Feature | KIRA | ARIA |
|---------|------|------|
| Response Generation | LLM (Groq/Ollama) | Graph Walking |
| Word Processing | POS Tagging | Pure Tokens |
| Stopword Removal | Yes | No |
| Grammar Awareness | Yes | No |
| Sequence Learning | No | Yes (Cluster Links) |
| Output Style | Natural sentences | Word associations → Sequences |
| Dependencies | LLM API | None |

## Tier System

| Tier | Score Threshold | Decay Rate | Decay Interval |
|------|-----------------|------------|----------------|
| SHORT | 0% - 30% | 15% | Every 50 messages |
| MEDIUM | 30% - 80% | 5% | Every 200 messages |
| LONG | 80%+ | 1% | Every 1000 messages |
| CLUSTER_LINKS | N/A | 10% | Every 100 messages |

## Database Tables

All tables are prefixed with `aria_` to stay separate from KIRA:

- `aria_purgatory` - Temporary word storage
- `aria_short` - Short-term correlations
- `aria_medium` - Medium-term correlations
- `aria_long` - Long-term correlations
- `aria_phrases` - Multi-word associations
- `aria_cluster_links` - **NEW: Cluster-to-cluster connections**
- `aria_clusters` - **NEW: Extracted clusters per message**
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
   - Run `migrations/002_aria_cluster_links.sql` (NEW)

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

### Existing Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/memory/stats` | GET | Memory statistics (now includes cluster links) |
| `/api/memory/search?q=word` | GET | Search correlations |
| `/api/memory/context` | GET | Full memory context |
| `/api/chat` | POST | Generate ARIA response |
| `/api/aria` | GET | ARIA configuration |
| `/api/aria/respond` | POST | Force ARIA response |

### NEW Cluster Link Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/clusters/links/:cluster` | GET | Get outgoing links from a cluster |
| `/api/clusters/neighbors/:cluster` | GET | Get all neighbors (in + out) |
| `/api/clusters/search?q=word` | GET | Search clusters by word |
| `/api/clusters/top` | GET | Get top cluster links |

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

### View Cluster Links
```bash
curl https://your-railway-url/api/clusters/links/weather
curl https://your-railway-url/api/clusters/top
```

## How ARIA Generates Responses (Updated)

1. **Extract keywords AND clusters** from user input
2. **Build cluster graph** from stored cluster links
3. **Find best starting cluster** matching input
4. **Walk cluster graph** following highest-weighted links
5. **Merge cluster path** into coherent text
6. **Fall back to word graph** if cluster path too short
7. **Return response**

Example:
```
Input: "What's the weather like?"
Keywords: [weather, like]
Input clusters: [weather, like, weather_like, ...]

Cluster graph walk from "weather":
  weather → weather_is → is_beautiful → beautiful_today

Merged output: "weather is beautiful today"
Response: "weather is beautiful today"
```

## Files

```
aria-system/
├── server.js              # Main entry point + API
├── ariaCorrelator.js      # Correlation engine + cluster links
├── ariaGenerator.js       # Response generation (cluster + word graph)
├── aria.html              # Chat interface
├── package.json
├── Dockerfile
├── railway.json
├── .env.example
├── migrations/
│   ├── 001_aria_tables.sql
│   └── 002_aria_cluster_links.sql   # NEW
├── test.js                # Tests including cluster links
└── README.md
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `PORT` | HTTP server port | No (default: 3002) |

## Configuration

### Cluster Link Config (in ariaCorrelator.js)

```javascript
const CLUSTER_LINK_CONFIG = {
  windowSize: 3,           // Link clusters within this distance
  baseScore: 0.02,         // Base score for new links
  adjacentBonus: 0.03,     // Extra score for adjacent clusters
  reinforceAmount: 0.015,  // Score added on reinforcement
  decayInterval: 100,      // Messages between decay checks
  decayRate: 0.10          // Decay rate per interval
};
```

### Generation Config (in ariaGenerator.js)

```javascript
const GENERATION_CONFIG = {
  maxClusters: 8,           // Max clusters in a response
  minClusters: 2,           // Min clusters for valid response
  linkScoreThreshold: 0.01, // Minimum link score to follow
  randomnessFactor: 0.3,    // Chance to pick non-top link
  useClusterLinks: true,    // Enable cluster-based generation
  fallbackToWordGraph: true // Fall back to word graph if no clusters
};
```

## Testing

Run the test suite:
```bash
npm test
```

This includes tests for:
- Message processing
- Word correlations
- Cluster extraction
- Cluster link creation/reinforcement
- Response generation with cluster links
