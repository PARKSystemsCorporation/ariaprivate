-- =============================================
-- ARIA EMERGENT LINGUISTIC SYSTEM
-- Migration 003: Token Statistics & Two-Word Pairs
-- Implements behavioral category emergence
-- =============================================

-- 1. TOKEN STATISTICS TABLE
-- Tracks behavioral patterns to derive categories
CREATE TABLE IF NOT EXISTS aria_token_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  
  -- Occurrence tracking
  total_occurrences integer DEFAULT 0,
  context_count integer DEFAULT 0,               -- unique message appearances
  
  -- Adjacency statistics
  unique_adjacency_count integer DEFAULT 0,      -- unique neighbors within ±2 window
  positional_variance float DEFAULT 0,           -- variance of positions in messages
  
  -- Transition behavior signals
  bridge_count integer DEFAULT 0,                -- times between two stable tokens
  temporal_adj_count integer DEFAULT 0,          -- adjacency to temporal markers
  
  -- Modifier behavior signals
  adjacent_to_stable integer DEFAULT 0,          -- times next to stable tokens
  contrast_pair_count integer DEFAULT 0,         -- part of contrast pairs
  standalone_count integer DEFAULT 0,            -- appeared alone in message
  
  -- Computed scores (0-1 range)
  stability_score float DEFAULT 0,
  transition_score float DEFAULT 0,
  dependency_score float DEFAULT 0,
  structural_score float DEFAULT 0,
  
  -- Emergent category
  category text DEFAULT 'unclassified' CHECK (
    category IN ('stable', 'transition', 'modifier', 'structural', 'unclassified')
  ),
  
  -- Category inertia fields (require 3 consecutive contexts before switching)
  pending_category text DEFAULT NULL CHECK (
    pending_category IS NULL OR pending_category IN ('stable', 'transition', 'modifier', 'structural', 'unclassified')
  ),
  pending_count integer DEFAULT 0,
  
  -- Track last message for context_count logic
  last_message_index integer DEFAULT NULL,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_token_stats_token ON aria_token_stats(token);
CREATE INDEX IF NOT EXISTS idx_aria_token_stats_category ON aria_token_stats(category);
CREATE INDEX IF NOT EXISTS idx_aria_token_stats_occurrences ON aria_token_stats(total_occurrences DESC);
CREATE INDEX IF NOT EXISTS idx_aria_token_stats_stability ON aria_token_stats(stability_score DESC);
CREATE INDEX IF NOT EXISTS idx_aria_token_stats_transition ON aria_token_stats(transition_score DESC);

-- 2. TWO-WORD PAIRS TABLE
-- ONLY two-word correlations - longer phrases emerge from overlapping pairs
CREATE TABLE IF NOT EXISTS aria_word_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text UNIQUE NOT NULL,              -- tokenA_tokenB (sorted alphabetically)
  token_a text NOT NULL,
  token_b text NOT NULL,
  
  -- Core metrics
  frequency integer DEFAULT 1,
  strength float DEFAULT 0.01,
  
  -- Category pattern (e.g., "stable->transition")
  category_pattern text DEFAULT 'unclassified->unclassified',
  
  -- Reinforcement tracking
  reinforcement_count integer DEFAULT 1,
  decay_count integer DEFAULT 0,
  
  -- Tier system
  tier text DEFAULT 'short' CHECK (tier IN ('short', 'medium', 'long', 'decay')),
  decay_at_message integer NOT NULL,
  last_seen_message_index integer NOT NULL,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_word_pairs_pattern ON aria_word_pairs(pattern_key);
CREATE INDEX IF NOT EXISTS idx_aria_word_pairs_strength ON aria_word_pairs(strength DESC);
CREATE INDEX IF NOT EXISTS idx_aria_word_pairs_tier ON aria_word_pairs(tier);
CREATE INDEX IF NOT EXISTS idx_aria_word_pairs_tokens ON aria_word_pairs(token_a, token_b);
CREATE INDEX IF NOT EXISTS idx_aria_word_pairs_category ON aria_word_pairs(category_pattern);
CREATE INDEX IF NOT EXISTS idx_aria_word_pairs_decay ON aria_word_pairs(decay_at_message);

-- 3. GLOBAL STATISTICS TABLE
-- Tracks corpus-wide metrics for score normalization
CREATE TABLE IF NOT EXISTS aria_global_stats (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_contexts_seen integer DEFAULT 0,         -- total unique messages processed
  total_adj_windows integer DEFAULT 0,           -- total adjacency windows counted
  max_positional_variance float DEFAULT 1,       -- maximum variance seen
  total_tokens_seen integer DEFAULT 0,           -- total token occurrences
  
  updated_at timestamptz DEFAULT now()
);

INSERT INTO aria_global_stats (id, total_contexts_seen, total_adj_windows, max_positional_variance, total_tokens_seen)
VALUES (1, 0, 0, 1, 0)
ON CONFLICT (id) DO NOTHING;

-- 4. TOKEN POSITION HISTORY
-- Stores position history for variance calculation
CREATE TABLE IF NOT EXISTS aria_token_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  position integer NOT NULL,
  message_index integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_token_positions_token ON aria_token_positions(token);
CREATE INDEX IF NOT EXISTS idx_aria_token_positions_message ON aria_token_positions(message_index);

-- 5. TEMPORAL MARKERS TABLE
-- Words that signal temporal context
CREATE TABLE IF NOT EXISTS aria_temporal_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marker text UNIQUE NOT NULL
);

-- Insert default temporal markers
INSERT INTO aria_temporal_markers (marker) VALUES
  ('then'), ('now'), ('before'), ('after'), ('when'),
  ('while'), ('during'), ('until'), ('since'), ('already'),
  ('soon'), ('later'), ('earlier'), ('yesterday'), ('today'),
  ('tomorrow'), ('always'), ('never'), ('once'), ('first'),
  ('last'), ('next'), ('finally'), ('eventually'), ('immediately'),
  ('suddenly'), ('gradually'), ('recently'), ('formerly'), ('meanwhile')
ON CONFLICT (marker) DO NOTHING;

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to update global stats
CREATE OR REPLACE FUNCTION aria_update_global_stats(
  add_contexts integer DEFAULT 0,
  add_adj_windows integer DEFAULT 0,
  new_max_variance float DEFAULT NULL,
  add_tokens integer DEFAULT 0
)
RETURNS void AS $$
BEGIN
  UPDATE aria_global_stats
  SET 
    total_contexts_seen = total_contexts_seen + add_contexts,
    total_adj_windows = total_adj_windows + add_adj_windows,
    max_positional_variance = GREATEST(max_positional_variance, COALESCE(new_max_variance, max_positional_variance)),
    total_tokens_seen = total_tokens_seen + add_tokens,
    updated_at = now()
  WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get global stats
CREATE OR REPLACE FUNCTION aria_get_global_stats()
RETURNS TABLE (
  total_contexts_seen integer,
  total_adj_windows integer,
  max_positional_variance float,
  total_tokens_seen integer
) AS $$
BEGIN
  RETURN QUERY SELECT 
    g.total_contexts_seen,
    g.total_adj_windows,
    g.max_positional_variance,
    g.total_tokens_seen
  FROM aria_global_stats g WHERE g.id = 1;
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamps
DROP TRIGGER IF EXISTS trigger_aria_token_stats_updated ON aria_token_stats;
CREATE TRIGGER trigger_aria_token_stats_updated
  BEFORE UPDATE ON aria_token_stats
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

DROP TRIGGER IF EXISTS trigger_aria_word_pairs_updated ON aria_word_pairs;
CREATE TRIGGER trigger_aria_word_pairs_updated
  BEFORE UPDATE ON aria_word_pairs
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE aria_token_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_word_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_global_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_token_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_temporal_markers ENABLE ROW LEVEL SECURITY;

-- Read access
CREATE POLICY "Anyone can read aria_token_stats" ON aria_token_stats FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_word_pairs" ON aria_word_pairs FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_global_stats" ON aria_global_stats FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_temporal_markers" ON aria_temporal_markers FOR SELECT USING (true);

-- Service role full access
CREATE POLICY "Service manages aria_token_stats" ON aria_token_stats FOR ALL USING (true);
CREATE POLICY "Service manages aria_word_pairs" ON aria_word_pairs FOR ALL USING (true);
CREATE POLICY "Service manages aria_global_stats" ON aria_global_stats FOR ALL USING (true);
CREATE POLICY "Service manages aria_token_positions" ON aria_token_positions FOR ALL USING (true);
CREATE POLICY "Service manages aria_temporal_markers" ON aria_temporal_markers FOR ALL USING (true);

-- =============================================
-- MIGRATION COMPLETE
-- =============================================
-- After running this migration:
-- 1. Token statistics track behavioral patterns
-- 2. Categories emerge from statistical behavior
-- 3. Two-word pairs are the ONLY direct correlations
-- 4. Longer phrases emerge from overlapping pairs
-- =============================================
