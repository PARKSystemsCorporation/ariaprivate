# ARIA - Adaptive Resonance Intelligence Architecture

## Emergent Linguistic System v2.0

ARIA is a **pure emergent linguistic system** that learns language patterns through statistical behavior analysis, NOT through templates or LLMs. Words are categorized based on how they behave, and responses emerge from overlapping two-word pairs.

## Core Principles

1. **ARIA is NOT an LLM** - It learns ONLY through correlations and memory
2. **Categories emerge from behavior** - Not from meaning or grammar
3. **ONLY two-word pairs** - Longer phrases emerge from overlapping pairs
4. **No stopword removal** - Every word contributes to the pattern

## Four Emergent Categories

Categories are assigned based on statistical patterns, not semantic meaning:

| Category | Behavior | Analogy |
|----------|----------|---------|
| **stable** | Persistent anchors, appear in many contexts | Noun-like |
| **transition** | Connect ideas, signal change/motion | Verb-like |
| **modifier** | Appear adjacent to stable words, show contrast | Adjective-like |
| **structural** | High frequency, low uniqueness, sentence glue | Function words |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER MESSAGE                                │
│  "The weather is beautiful today"                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TOKENIZATION                                │
│  [the] [weather] [is] [beautiful] [today]                       │
│  (lowercase, no stopword removal)                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TOKEN STATISTICS                               │
│  For each token, update:                                        │
│  • total_occurrences += 1                                       │
│  • context_count (unique messages)                              │
│  • unique_adjacency_count (±2 window)                           │
│  • positional_variance                                          │
│  • bridge_count (between stable tokens)                         │
│  • temporal_adj_count (near temporal markers)                   │
│  • adjacent_to_stable                                           │
│  • contrast_pair_count                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SCORE CALCULATION                              │
│                                                                  │
│  StabilityScore = context_ratio + adj_ratio - variance_ratio    │
│  TransitionScore = bridge_ratio + temporal_ratio + variance     │
│  DependencyScore = stable_adj - standalone_ratio + contrast     │
│  StructuralScore = frequency - adj_ratio - standalone - var     │
│                                                                  │
│  All scores clamped to [0, 1]                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CATEGORY ASSIGNMENT                            │
│  if occurrences >= 5:                                           │
│    category = max_score category if max_score > 0.5             │
│  else:                                                          │
│    category = 'unclassified'                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TWO-WORD PAIRS                                 │
│  ONLY adjacent tokens form pairs:                               │
│  [the_weather] [weather_is] [is_beautiful] [beautiful_today]    │
│                                                                  │
│  Each pair tracks:                                              │
│  • frequency                                                    │
│  • strength (0-1, affected by reinforcement/decay)              │
│  • category_pattern (e.g., "structural->stable")                │
│  • tier (short/medium/long/decay)                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   EMERGENT PHRASES                               │
│  Longer phrases emerge from OVERLAPPING pairs:                  │
│                                                                  │
│  If pair1 = (A, B) and pair2 = (B, C):                         │
│    emergent_phrase = A + B + C                                  │
│                                                                  │
│  Example: weather_is + is_beautiful = "weather is beautiful"    │
│  ⚠️ NOT stored - discovered at query time                       │
└─────────────────────────────────────────────────────────────────┘
```

## Score Calculation Formulas

### StabilityScore
```
StabilityScore = (context_count / totalContextsSeen)
               + (unique_adjacency_count / totalAdjWindows)
               - (positional_variance / maxVariance)
```

### TransitionScore
```
TransitionScore = (bridge_count / total_occurrences)
                + (temporal_adj_count / total_occurrences)
                + (positional_variance / maxVariance)
```

### DependencyScore (Modifier)
```
DependencyScore = (adjacent_to_stable / total_occurrences)
                + (contrast_pair_count / total_occurrences)
                - (standalone_count / total_occurrences)
```

### StructuralScore
```
StructuralScore = (total_occurrences / totalContextsSeen)
                + (temporal_adj_count / total_occurrences)
                - (unique_adjacency_count / totalAdjWindows)
                - (standalone_count / total_occurrences)
                - (positional_variance / maxVariance)
```

## Memory Tier System

| Tier | Score Range | Decay Rate | Decay Interval | Description |
|------|-------------|------------|----------------|-------------|
| SHORT | 0% - 30% | 15% | 50 messages | New correlations |
| MEDIUM | 30% - 80% | 5% | 200 messages | Reinforced patterns |
| LONG | 80%+ | 1% | 1000 messages | Strong memories |
| DECAY | < 1% | N/A | N/A | Graveyard |

### Promotion Rules by Category
- **stable** → 1.5x faster promotion
- **structural** → 0.6x slower promotion
- **transition/modifier** → Normal rate
- **unclassified** → 0.8x slightly slower

## Database Schema

### aria_token_stats
```sql
token                    text UNIQUE NOT NULL
total_occurrences        integer
context_count            integer
unique_adjacency_count   integer
positional_variance      float
bridge_count             integer
temporal_adj_count       integer
adjacent_to_stable       integer
contrast_pair_count      integer
standalone_count         integer
stability_score          float
transition_score         float
dependency_score         float
structural_score         float
category                 text (stable|transition|modifier|structural|unclassified)
```

### aria_word_pairs
```sql
pattern_key              text UNIQUE NOT NULL
token_a                  text NOT NULL
token_b                  text NOT NULL
frequency                integer
strength                 float
category_pattern         text (e.g., "stable->transition")
tier                     text (short|medium|long|decay)
reinforcement_count      integer
decay_count              integer
decay_at_message         integer
last_seen_message_index  integer
```

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
   - Run `migrations/003_aria_token_stats.sql`

4. **Start:**
```bash
npm start
```

## API Endpoints

### Core
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/aria` | GET | ARIA info and configuration |

### Memory
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/stats` | GET | Memory statistics |
| `/api/memory/search?q=word` | GET | Search memory |
| `/api/memory/context` | GET | Full memory context |

### Token Statistics
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tokens/:token` | GET | Get token statistics |
| `/api/tokens/category/:cat` | GET | Get tokens by category |
| `/api/categories` | GET | Analyze all categories |

### Word Pairs
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pairs` | GET | Get top pairs |
| `/api/pairs/search?q=word` | GET | Search pairs by word |

### Emergent Phrases
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chains/:word` | GET | Get emergent chains from word |

### Chat
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Chat with ARIA |
| `/api/aria/respond` | POST | Force ARIA response |

## Response Generation

ARIA generates responses through multiple methods:

1. **Emergent Phrase Discovery** - Find overlapping pairs to build phrases
2. **Category-Aware Graph Walking** - Walk pairs respecting category transitions
3. **Category Composition** - Build responses from category combinations
4. **Raw Pair Fallback** - Use strongest pairs directly

### Category Transitions
The system prefers certain category sequences:
- `stable` → `modifier`, `transition`, `structural`
- `modifier` → `stable`, `structural`
- `transition` → `stable`, `modifier`, `structural`
- `structural` → `stable`, `modifier`, `transition`

## Example Response Generation

```
Input: "What about the weather?"
Keywords: [weather]

Step 1: Search pairs containing "weather"
  Found: weather_is (0.15), beautiful_weather (0.12), weather_today (0.08)

Step 2: Build emergent chains
  weather → is → beautiful
  weather → today
  beautiful → weather → is

Step 3: Category-aware selection
  "weather" (stable) + "is" (structural) + "beautiful" (modifier)

Output: "weather is beautiful today"
```

## Files

```
aria-system/
├── server.js              # Main entry point + API
├── ariaCorrelator.js      # Token stats + pair correlation engine
├── ariaGenerator.js       # Emergent response generation
├── package.json
├── Dockerfile
├── railway.json
├── .env.example
├── migrations/
│   ├── 001_aria_tables.sql
│   └── 003_aria_token_stats.sql
├── test.js
└── README.md
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `PORT` | HTTP server port | No (default: 3002) |

## Testing

Run the test suite:
```bash
npm test
```

Tests include:
- Message processing
- Token statistics
- Category assignment
- Word pair creation/reinforcement
- Emergent phrase discovery
- Response generation

## Key Differences from Previous Version

| Feature | v1.0 (Cluster Links) | v2.0 (Emergent Linguistic) |
|---------|---------------------|---------------------------|
| Word Categories | None | 4 emergent categories |
| Pair Types | All word combinations | Adjacent pairs ONLY |
| Phrase Storage | Explicit 3-word clusters | Emergent from overlap |
| Category Learning | N/A | Statistical behavior |
| Response Method | Cluster graph walking | Category-aware emergence |

## Contributing

ARIA is designed to be deterministic and simple. When contributing:
- Do NOT add LLM integration
- Do NOT add grammar rules
- Do NOT remove stopwords
- Keep the emergent philosophy

## License

MIT
