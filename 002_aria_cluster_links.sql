-- =============================================
-- ARIA CLUSTER LINKS - SECOND ORDER CORRELATIONS
-- Connections BETWEEN clusters for sentence flow
-- =============================================

-- ARIA CLUSTER LINKS (cluster-to-cluster correlations)
CREATE TABLE IF NOT EXISTS aria_cluster_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_cluster TEXT NOT NULL,
  to_cluster TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward', 'bidirectional')),
  score FLOAT NOT NULL DEFAULT 0.01,
  reinforcement_count INT NOT NULL DEFAULT 1,
  decay_count INT NOT NULL DEFAULT 0,
  decay_at_message INT NOT NULL,
  last_seen_message_index INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint on cluster pairs (directional)
CREATE UNIQUE INDEX IF NOT EXISTS idx_aria_cluster_links_pair 
  ON aria_cluster_links(from_cluster, to_cluster);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_aria_cluster_links_from 
  ON aria_cluster_links(from_cluster);
CREATE INDEX IF NOT EXISTS idx_aria_cluster_links_to 
  ON aria_cluster_links(to_cluster);
CREATE INDEX IF NOT EXISTS idx_aria_cluster_links_score 
  ON aria_cluster_links(score DESC);
CREATE INDEX IF NOT EXISTS idx_aria_cluster_links_decay 
  ON aria_cluster_links(decay_at_message);

-- Timestamp update trigger
DROP TRIGGER IF EXISTS trigger_aria_cluster_links_updated ON aria_cluster_links;
CREATE TRIGGER trigger_aria_cluster_links_updated
  BEFORE UPDATE ON aria_cluster_links
  FOR EACH ROW
  EXECUTE FUNCTION aria_update_timestamp();

-- Row Level Security
ALTER TABLE aria_cluster_links ENABLE ROW LEVEL SECURITY;

-- Allow read access
CREATE POLICY "Anyone can read aria_cluster_links" 
  ON aria_cluster_links FOR SELECT USING (true);

-- Service role can manage everything
CREATE POLICY "Service manages aria_cluster_links" 
  ON aria_cluster_links FOR ALL USING (true);

-- =============================================
-- ARIA EXTRACTED CLUSTERS TABLE
-- Stores extracted clusters per message for linking
-- =============================================

CREATE TABLE IF NOT EXISTS aria_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key TEXT NOT NULL,
  words TEXT[] NOT NULL,
  position INT NOT NULL,
  message_index INT NOT NULL,
  message_id uuid,
  user_id uuid,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aria_clusters_key 
  ON aria_clusters(cluster_key);
CREATE INDEX IF NOT EXISTS idx_aria_clusters_message 
  ON aria_clusters(message_index);
CREATE INDEX IF NOT EXISTS idx_aria_clusters_position 
  ON aria_clusters(position);

-- Row Level Security
ALTER TABLE aria_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service manages aria_clusters" 
  ON aria_clusters FOR ALL USING (true);
