-- =============================================
-- ARIA MEMORY SYSTEM - SUPABASE MIGRATIONS
-- Pure word correlation system (no POS, no grammar)
-- =============================================

-- 1. ARIA PURGATORY (temporary word holding)
CREATE TABLE IF NOT EXISTS aria_purgatory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL,
  position int NOT NULL,                      -- position in message
  message_id uuid,
  message_index int NOT NULL,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_purgatory_word ON aria_purgatory(word);
CREATE INDEX IF NOT EXISTS idx_aria_purgatory_message ON aria_purgatory(message_index);

-- 2. ARIA SHORT-TERM (0-30% score)
CREATE TABLE IF NOT EXISTS aria_short (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text UNIQUE NOT NULL,
  word1 text NOT NULL,
  word2 text NOT NULL,
  correlation_score float NOT NULL DEFAULT 0,
  reinforcement_count int NOT NULL DEFAULT 1,
  decay_count int NOT NULL DEFAULT 0,
  decay_at_message int NOT NULL,
  last_seen_message_index int NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_short_pattern ON aria_short(pattern_key);
CREATE INDEX IF NOT EXISTS idx_aria_short_score ON aria_short(correlation_score DESC);
CREATE INDEX IF NOT EXISTS idx_aria_short_words ON aria_short(word1, word2);
CREATE INDEX IF NOT EXISTS idx_aria_short_decay ON aria_short(decay_at_message);

-- 3. ARIA MEDIUM-TERM (30-80% score)
CREATE TABLE IF NOT EXISTS aria_medium (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text UNIQUE NOT NULL,
  word1 text NOT NULL,
  word2 text NOT NULL,
  correlation_score float NOT NULL DEFAULT 0,
  reinforcement_count int NOT NULL DEFAULT 1,
  decay_count int NOT NULL DEFAULT 0,
  decay_at_message int NOT NULL,
  last_seen_message_index int NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_medium_pattern ON aria_medium(pattern_key);
CREATE INDEX IF NOT EXISTS idx_aria_medium_score ON aria_medium(correlation_score DESC);
CREATE INDEX IF NOT EXISTS idx_aria_medium_words ON aria_medium(word1, word2);
CREATE INDEX IF NOT EXISTS idx_aria_medium_decay ON aria_medium(decay_at_message);

-- 4. ARIA LONG-TERM (80%+ score)
CREATE TABLE IF NOT EXISTS aria_long (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key text UNIQUE NOT NULL,
  word1 text NOT NULL,
  word2 text NOT NULL,
  correlation_score float NOT NULL DEFAULT 0,
  reinforcement_count int NOT NULL DEFAULT 1,
  decay_count int NOT NULL DEFAULT 0,
  decay_at_message int NOT NULL,
  last_seen_message_index int NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_long_pattern ON aria_long(pattern_key);
CREATE INDEX IF NOT EXISTS idx_aria_long_score ON aria_long(correlation_score DESC);
CREATE INDEX IF NOT EXISTS idx_aria_long_words ON aria_long(word1, word2);
CREATE INDEX IF NOT EXISTS idx_aria_long_decay ON aria_long(decay_at_message);

-- 5. ARIA PHRASES (multi-word correlations)
CREATE TABLE IF NOT EXISTS aria_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase_key text UNIQUE NOT NULL,
  words text[] NOT NULL,
  source_correlations uuid[] NOT NULL,
  correlation_score float NOT NULL DEFAULT 0,
  reinforcement_count int NOT NULL DEFAULT 1,
  decay_count int NOT NULL DEFAULT 0,
  decay_at_message int NOT NULL,
  tier text NOT NULL DEFAULT 'short' CHECK (tier IN ('short', 'medium', 'long')),
  last_seen_message_index int NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_phrases_key ON aria_phrases(phrase_key);
CREATE INDEX IF NOT EXISTS idx_aria_phrases_score ON aria_phrases(correlation_score DESC);
CREATE INDEX IF NOT EXISTS idx_aria_phrases_tier ON aria_phrases(tier);

-- 6. ARIA DECAY (graveyard for decayed correlations)
CREATE TABLE IF NOT EXISTS aria_decay (
  id uuid PRIMARY KEY,
  pattern_key text NOT NULL,
  word1 text NOT NULL,
  word2 text NOT NULL,
  correlation_score float NOT NULL,
  reinforcement_count int NOT NULL DEFAULT 0,
  decay_count int NOT NULL DEFAULT 0,
  decayed_from text NOT NULL,
  decayed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_decay_pattern ON aria_decay(pattern_key);

-- 7. ARIA MESSAGE COUNTER
CREATE TABLE IF NOT EXISTS aria_message_counter (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_index int NOT NULL DEFAULT 0,
  last_updated timestamptz DEFAULT now()
);

INSERT INTO aria_message_counter (id, current_index) 
VALUES (1, 0) 
ON CONFLICT (id) DO NOTHING;

-- 8. ARIA MESSAGES (separate from KIRA's messages table)
CREATE TABLE IF NOT EXISTS aria_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  bot_id text DEFAULT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_messages_user ON aria_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_aria_messages_bot ON aria_messages(bot_id);
CREATE INDEX IF NOT EXISTS idx_aria_messages_created ON aria_messages(created_at DESC);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to increment message counter
CREATE OR REPLACE FUNCTION aria_increment_message_counter()
RETURNS int AS $$
DECLARE
  new_index int;
BEGIN
  UPDATE aria_message_counter 
  SET current_index = current_index + 1,
      last_updated = now()
  WHERE id = 1
  RETURNING current_index INTO new_index;
  
  RETURN new_index;
END;
$$ LANGUAGE plpgsql;

-- Function to get current message index
CREATE OR REPLACE FUNCTION aria_get_message_index()
RETURNS int AS $$
DECLARE
  idx int;
BEGIN
  SELECT current_index INTO idx FROM aria_message_counter WHERE id = 1;
  RETURN COALESCE(idx, 0);
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION aria_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for timestamp updates
DROP TRIGGER IF EXISTS trigger_aria_short_updated ON aria_short;
CREATE TRIGGER trigger_aria_short_updated
  BEFORE UPDATE ON aria_short
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

DROP TRIGGER IF EXISTS trigger_aria_medium_updated ON aria_medium;
CREATE TRIGGER trigger_aria_medium_updated
  BEFORE UPDATE ON aria_medium
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

DROP TRIGGER IF EXISTS trigger_aria_long_updated ON aria_long;
CREATE TRIGGER trigger_aria_long_updated
  BEFORE UPDATE ON aria_long
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

DROP TRIGGER IF EXISTS trigger_aria_phrases_updated ON aria_phrases;
CREATE TRIGGER trigger_aria_phrases_updated
  BEFORE UPDATE ON aria_phrases
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE aria_purgatory ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_short ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_medium ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_long ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_phrases ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_decay ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_messages ENABLE ROW LEVEL SECURITY;

-- Allow read access
CREATE POLICY "Anyone can read aria_short" ON aria_short FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_medium" ON aria_medium FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_long" ON aria_long FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_phrases" ON aria_phrases FOR SELECT USING (true);
CREATE POLICY "Anyone can read aria_messages" ON aria_messages FOR SELECT USING (true);

-- Service role can manage everything
CREATE POLICY "Service manages aria_purgatory" ON aria_purgatory FOR ALL USING (true);
CREATE POLICY "Service manages aria_short" ON aria_short FOR ALL USING (true);
CREATE POLICY "Service manages aria_medium" ON aria_medium FOR ALL USING (true);
CREATE POLICY "Service manages aria_long" ON aria_long FOR ALL USING (true);
CREATE POLICY "Service manages aria_phrases" ON aria_phrases FOR ALL USING (true);
CREATE POLICY "Service manages aria_decay" ON aria_decay FOR ALL USING (true);
CREATE POLICY "Service manages aria_messages" ON aria_messages FOR ALL USING (true);

-- Allow authenticated users to insert messages
CREATE POLICY "Auth users insert aria_messages" ON aria_messages 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
