// ariaCorrelator.js
// =============================================
// ARIA - EMERGENT LINGUISTIC SYSTEM
// =============================================
// ARIA is NOT an LLM. It learns ONLY through correlations and memory.
// Categories emerge from behavioral patterns, not meaning.
//
// FOUR EMERGENT CATEGORIES:
//   stable     — noun-like (persistent anchors)
//   transition — verb-like (motion/change connectors)
//   modifier   — adjective-like (quality differences)
//   structural — function-word-like (sentence glue)
//
// ONLY two-word pairs. Longer phrases EMERGE from overlapping pairs.
// =============================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================================
// CONFIGURATION
// ===============================================

const CONFIG = {
  // Score thresholds for tier promotion
  THRESHOLDS: {
    SHORT_MAX: 0.30,
    MEDIUM_MAX: 0.80,
    DECAY_MIN: 0.01
  },
  
  // Decay configuration per tier
  DECAY: {
    short: { interval: 50, rate: 0.15 },
    medium: { interval: 200, rate: 0.05 },
    long: { interval: 1000, rate: 0.01 }
  },
  
  // Reinforcement rates
  REINFORCEMENT: {
    base: 0.02,           // Base reinforcement for pairs
    tokenBoost: 0.01,     // Token score boost on reinforcement
    maxScore: 1.0         // Maximum score cap
  },
  
  // Adjacency window size for statistics
  ADJACENCY_WINDOW: 2,
  
  // Minimum occurrences before category assignment
  MIN_OCCURRENCES_FOR_CATEGORY: 2,
  
  // Category score threshold
  CATEGORY_THRESHOLD: 0.15,
  
  // Promotion speed modifiers by category
  PROMOTION_MODIFIERS: {
    stable: 1.5,          // Faster promotion
    structural: 0.6,      // Slower promotion
    transition: 1.0,      // Normal
    modifier: 1.0,        // Normal
    unclassified: 0.8     // Slightly slower
  }
};

// Temporal markers for detecting transition behavior
const TEMPORAL_MARKERS = new Set([
  'then', 'now', 'before', 'after', 'when', 'while', 'during', 'until',
  'since', 'already', 'soon', 'later', 'earlier', 'yesterday', 'today',
  'tomorrow', 'always', 'never', 'once', 'first', 'last', 'next',
  'finally', 'eventually', 'immediately', 'suddenly', 'gradually',
  'recently', 'formerly', 'meanwhile'
]);

// Contrast pairs for modifier detection
const CONTRAST_PAIRS = [
  ['good', 'bad'], ['big', 'small'], ['hot', 'cold'], ['fast', 'slow'],
  ['old', 'new'], ['high', 'low'], ['light', 'dark'], ['happy', 'sad'],
  ['strong', 'weak'], ['hard', 'soft'], ['loud', 'quiet'], ['clean', 'dirty'],
  ['rich', 'poor'], ['safe', 'dangerous'], ['full', 'empty'], ['long', 'short'],
  ['thick', 'thin'], ['wide', 'narrow'], ['deep', 'shallow'], ['young', 'old']
];

// Build contrast lookup
const CONTRAST_LOOKUP = new Map();
for (const [a, b] of CONTRAST_PAIRS) {
  CONTRAST_LOOKUP.set(a, b);
  CONTRAST_LOOKUP.set(b, a);
}

// ===============================================
// TOKENIZATION
// ===============================================

function tokenizeMessage(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length >= 2);
}

// ===============================================
// MESSAGE COUNTER
// ===============================================

async function getAndIncrementMessageIndex() {
  const { data, error } = await supabase.rpc('aria_increment_message_counter');
  
  if (error) {
    const { data: counter } = await supabase
      .from('aria_message_counter')
      .select('current_index')
      .eq('id', 1)
      .single();
    
    const newIndex = (counter?.current_index || 0) + 1;
    
    await supabase
      .from('aria_message_counter')
      .update({ current_index: newIndex, last_updated: new Date().toISOString() })
      .eq('id', 1);
    
    return newIndex;
  }
  
  return data;
}

// ===============================================
// GLOBAL STATISTICS
// ===============================================

let globalStatsCache = null;
let globalStatsCacheTime = 0;

async function getGlobalStats() {
  // Cache for 5 seconds
  if (globalStatsCache && Date.now() - globalStatsCacheTime < 5000) {
    return globalStatsCache;
  }
  
  const { data, error } = await supabase
    .from('aria_global_stats')
    .select('*')
    .eq('id', 1)
    .single();
  
  if (error || !data) {
    return {
      total_contexts_seen: 1,
      total_adj_windows: 1,
      max_positional_variance: 1,
      total_tokens_seen: 1
    };
  }
  
  globalStatsCache = data;
  globalStatsCacheTime = Date.now();
  return data;
}

async function updateGlobalStats(updates) {
  const { addContexts = 0, addAdjWindows = 0, newMaxVariance = null, addTokens = 0 } = updates;
  
  await supabase
    .from('aria_global_stats')
    .update({
      total_contexts_seen: supabase.sql`total_contexts_seen + ${addContexts}`,
      total_adj_windows: supabase.sql`total_adj_windows + ${addAdjWindows}`,
      max_positional_variance: newMaxVariance 
        ? supabase.sql`GREATEST(max_positional_variance, ${newMaxVariance})`
        : supabase.sql`max_positional_variance`,
      total_tokens_seen: supabase.sql`total_tokens_seen + ${addTokens}`,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);
  
  // Invalidate cache
  globalStatsCache = null;
}

// ===============================================
// TOKEN STATISTICS
// ===============================================

async function getOrCreateTokenStats(token) {
  const { data: existing } = await supabase
    .from('aria_token_stats')
    .select('*')
    .eq('token', token)
    .single();
  
  if (existing) return existing;
  
  // Create new token stats
  const newStats = {
    id: uuidv4(),
    token,
    total_occurrences: 0,
    context_count: 0,
    unique_adjacency_count: 0,
    positional_variance: 0,
    bridge_count: 0,
    temporal_adj_count: 0,
    adjacent_to_stable: 0,
    contrast_pair_count: 0,
    standalone_count: 0,
    stability_score: 0,
    transition_score: 0,
    dependency_score: 0,
    structural_score: 0,
    category: 'unclassified'
  };
  
  const { data: created, error } = await supabase
    .from('aria_token_stats')
    .insert(newStats)
    .select()
    .single();
  
  if (error) {
    // Handle race condition - another process might have created it
    const { data: retry } = await supabase
      .from('aria_token_stats')
      .select('*')
      .eq('token', token)
      .single();
    return retry || newStats;
  }
  
  return created;
}

async function updateTokenStats(token, updates) {
  const { error } = await supabase
    .from('aria_token_stats')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('token', token);
  
  if (error) {
    console.error(`   ❌ Token stats update error for "${token}":`, error.message);
  }
}

// ===============================================
// POSITIONAL VARIANCE CALCULATION
// ===============================================

async function calculatePositionalVariance(token) {
  const { data: positions } = await supabase
    .from('aria_token_positions')
    .select('position')
    .eq('token', token)
    .limit(100); // Use last 100 positions
  
  if (!positions || positions.length < 2) return 0;
  
  const values = positions.map(p => p.position);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  
  return variance;
}

async function recordTokenPosition(token, position, messageIndex) {
  await supabase
    .from('aria_token_positions')
    .insert({
      id: uuidv4(),
      token,
      position,
      message_index: messageIndex
    });
}

// ===============================================
// SCORE CALCULATIONS
// Exactly as specified in the architecture
// ===============================================

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function calculateStabilityScore(stats, globalStats) {
  // StabilityScore = (context_count / totalContextsSeen) 
  //                + (unique_adjacency_count / totalAdjWindows) 
  //                - (positional_variance / maxVariance)
  
  const contextRatio = stats.context_count / Math.max(1, globalStats.total_contexts_seen);
  const adjRatio = stats.unique_adjacency_count / Math.max(1, globalStats.total_adj_windows);
  const varianceRatio = stats.positional_variance / Math.max(1, globalStats.max_positional_variance);
  
  return clamp(contextRatio + adjRatio - varianceRatio);
}

function calculateTransitionScore(stats, globalStats) {
  // TransitionScore = (bridge_count / total_occurrences) 
  //                 + (temporal_adj_count / total_occurrences) 
  //                 + (positional_variance / maxVariance)
  
  const bridgeRatio = stats.bridge_count / Math.max(1, stats.total_occurrences);
  const temporalRatio = stats.temporal_adj_count / Math.max(1, stats.total_occurrences);
  const varianceRatio = stats.positional_variance / Math.max(1, globalStats.max_positional_variance);
  
  return clamp(bridgeRatio + temporalRatio + varianceRatio);
}

function calculateDependencyScore(stats) {
  // DependencyScore = (adjacent_to_stable / total_occurrences) 
  //                 + (contrast_pair_count / total_occurrences) 
  //                 - (standalone_count / total_occurrences)
  
  const stableRatio = stats.adjacent_to_stable / Math.max(1, stats.total_occurrences);
  const contrastRatio = stats.contrast_pair_count / Math.max(1, stats.total_occurrences);
  const standaloneRatio = stats.standalone_count / Math.max(1, stats.total_occurrences);
  
  return clamp(stableRatio + contrastRatio - standaloneRatio);
}

function calculateStructuralScore(stats, globalStats) {
  // StructuralScore = (total_occurrences / totalContextsSeen) 
  //                 + (temporal_adj_count / total_occurrences) 
  //                 - (unique_adjacency_count / totalAdjWindows) 
  //                 - (standalone_count / total_occurrences) 
  //                 - (positional_variance / maxVariance)
  
  const occurrenceRatio = stats.total_occurrences / Math.max(1, globalStats.total_contexts_seen);
  const temporalRatio = stats.temporal_adj_count / Math.max(1, stats.total_occurrences);
  const adjRatio = stats.unique_adjacency_count / Math.max(1, globalStats.total_adj_windows);
  const standaloneRatio = stats.standalone_count / Math.max(1, stats.total_occurrences);
  const varianceRatio = stats.positional_variance / Math.max(1, globalStats.max_positional_variance);
  
  return clamp(occurrenceRatio + temporalRatio - adjRatio - standaloneRatio - varianceRatio);
}

// ===============================================
// CATEGORY ASSIGNMENT
// Exactly as specified in the architecture
// ===============================================

function assignCategory(stats) {
  if (stats.total_occurrences < CONFIG.MIN_OCCURRENCES_FOR_CATEGORY) {
    return 'unclassified';
  }
  
  const scores = {
    stable: stats.stability_score,
    transition: stats.transition_score,
    modifier: stats.dependency_score,
    structural: stats.structural_score
  };
  
  const maxScore = Math.max(...Object.values(scores));
  
  if (maxScore <= CONFIG.CATEGORY_THRESHOLD) {
    return 'unclassified';
  }
  
  if (scores.stable === maxScore && scores.stable > CONFIG.CATEGORY_THRESHOLD) {
    return 'stable';
  }
  if (scores.transition === maxScore && scores.transition > CONFIG.CATEGORY_THRESHOLD) {
    return 'transition';
  }
  if (scores.modifier === maxScore && scores.modifier > CONFIG.CATEGORY_THRESHOLD) {
    return 'modifier';
  }
  if (scores.structural === maxScore && scores.structural > CONFIG.CATEGORY_THRESHOLD) {
    return 'structural';
  }
  
  return 'unclassified';
}

// ===============================================
// PATTERN KEY GENERATION
// ===============================================

function generatePatternKey(word1, word2) {
  const sorted = [word1.toLowerCase(), word2.toLowerCase()].sort();
  return sorted.join('_');
}

// ===============================================
// TIER MANAGEMENT
// ===============================================

function getTierForScore(score) {
  if (score >= CONFIG.THRESHOLDS.MEDIUM_MAX) return 'long';
  if (score >= CONFIG.THRESHOLDS.SHORT_MAX) return 'medium';
  return 'short';
}

// ===============================================
// STEP 1: PROCESS TOKEN STATISTICS
// ===============================================

async function processTokenStatistics(tokens, messageIndex, isStandalone) {
  console.log('\n📊 Processing token statistics...');
  
  const globalStats = await getGlobalStats();
  const tokenSet = new Set(tokens);
  const adjacencyData = new Map();
  
  // Collect all updates in local structure for batching
  const tokenUpdates = new Map();
  
  // Track stable tokens for bridge detection
  const stableTokensInMessage = new Set();
  
  // First pass: Get existing categories to identify stable tokens
  for (const token of tokenSet) {
    const stats = await getOrCreateTokenStats(token);
    if (stats.category === 'stable') {
      stableTokensInMessage.add(token);
    }
    // Initialize update structure for this token
    tokenUpdates.set(token, {
      total_occurrences_add: 0,
      context_count_add: 0,
      bridge_count_add: 0,
      temporal_adj_count_add: 0,
      adjacent_to_stable_add: 0,
      contrast_pair_count_add: 0,
      standalone_count_add: 0,
      currentStats: stats
    });
  }
  
  // Process each token occurrence
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const updates = tokenUpdates.get(token);
    const stats = updates.currentStats;
    
    // Update basic occurrence (count each occurrence)
    updates.total_occurrences_add++;
    
    // FIX 2: Check if this is a NEW message (not seen before by this token)
    // Only increment context_count for genuinely new messages
    if (stats.last_message_index !== messageIndex && updates.context_count_add === 0) {
      updates.context_count_add = 1;
    }
    
    // Record position
    await recordTokenPosition(token, i, messageIndex);
    
    // Calculate adjacency window (±2)
    const neighbors = new Set();
    for (let j = Math.max(0, i - CONFIG.ADJACENCY_WINDOW); j <= Math.min(tokens.length - 1, i + CONFIG.ADJACENCY_WINDOW); j++) {
      if (j !== i) {
        neighbors.add(tokens[j]);
      }
    }
    
    // Track unique adjacencies
    if (!adjacencyData.has(token)) {
      adjacencyData.set(token, new Set());
    }
    for (const neighbor of neighbors) {
      adjacencyData.get(token).add(neighbor);
    }
    
    // Detect transition behavior: token between two stable tokens
    if (i > 0 && i < tokens.length - 1) {
      const prevToken = tokens[i - 1];
      const nextToken = tokens[i + 1];
      if (stableTokensInMessage.has(prevToken) && stableTokensInMessage.has(nextToken)) {
        updates.bridge_count_add++;
      }
    }
    
    // Detect temporal adjacency (count once per token per message)
    if (updates.temporal_adj_count_add === 0) {
      for (const neighbor of neighbors) {
        if (TEMPORAL_MARKERS.has(neighbor)) {
          updates.temporal_adj_count_add = 1;
          break;
        }
      }
    }
    
    // Detect modifier behavior: adjacent to stable token (count once per token per message)
    if (updates.adjacent_to_stable_add === 0) {
      for (const neighbor of neighbors) {
        if (stableTokensInMessage.has(neighbor)) {
          updates.adjacent_to_stable_add = 1;
          break;
        }
      }
    }
    
    // Detect contrast pair membership (count once per token per message)
    if (updates.contrast_pair_count_add === 0 && CONTRAST_LOOKUP.has(token)) {
      const contrast = CONTRAST_LOOKUP.get(token);
      if (tokenSet.has(contrast)) {
        updates.contrast_pair_count_add = 1;
      }
    }
  }
  
  // Standalone detection (applies to all tokens in message if standalone)
  if (isStandalone) {
    for (const [token, updates] of tokenUpdates) {
      updates.standalone_count_add = 1;
    }
  }
  
  // BATCH UPDATE: Perform one database update per token
  for (const [token, updates] of tokenUpdates) {
    const stats = updates.currentStats;
    
    // Calculate new unique adjacency count
    const newUniqueAdjacencyCount = adjacencyData.has(token)
      ? Math.max(stats.unique_adjacency_count || 0, adjacencyData.get(token).size)
      : stats.unique_adjacency_count || 0;
    
    // Single batched update per token
    await updateTokenStats(token, {
      total_occurrences: (stats.total_occurrences || 0) + updates.total_occurrences_add,
      context_count: (stats.context_count || 0) + updates.context_count_add,
      unique_adjacency_count: newUniqueAdjacencyCount,
      bridge_count: (stats.bridge_count || 0) + updates.bridge_count_add,
      temporal_adj_count: (stats.temporal_adj_count || 0) + updates.temporal_adj_count_add,
      adjacent_to_stable: (stats.adjacent_to_stable || 0) + updates.adjacent_to_stable_add,
      contrast_pair_count: (stats.contrast_pair_count || 0) + updates.contrast_pair_count_add,
      standalone_count: (stats.standalone_count || 0) + updates.standalone_count_add,
      last_message_index: messageIndex
    });
  }
  
  // Update global stats (single update)
  await supabase
    .from('aria_global_stats')
    .update({
      total_contexts_seen: globalStats.total_contexts_seen + 1,
      total_adj_windows: globalStats.total_adj_windows + Math.max(0, tokens.length - 1),
      total_tokens_seen: globalStats.total_tokens_seen + tokens.length,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);
  
  console.log(`   ✅ ${tokenSet.size} unique tokens processed`);
  return tokenSet.size;
}

// ===============================================
// STEP 2: CALCULATE SCORES & ASSIGN CATEGORIES
// ===============================================

async function calculateScoresAndCategories(tokens) {
  console.log('\n🧮 Calculating scores and categories...');
  
  let globalStats = await getGlobalStats();
  const tokenSet = new Set(tokens);
  let categorized = 0;
  
  // FIRST PASS: Calculate all variances and update max variance BEFORE score calculations
  const varianceMap = new Map();
  let maxVarianceFound = globalStats.max_positional_variance;
  
  for (const token of tokenSet) {
    const variance = await calculatePositionalVariance(token);
    varianceMap.set(token, variance);
    if (variance > maxVarianceFound) {
      maxVarianceFound = variance;
    }
  }
  
  // Update global max variance if needed (before score calculations)
  if (maxVarianceFound > globalStats.max_positional_variance) {
    await supabase
      .from('aria_global_stats')
      .update({ 
        max_positional_variance: maxVarianceFound,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);
    
    // Refresh global stats with updated max variance
    globalStats = { ...globalStats, max_positional_variance: maxVarianceFound };
    globalStatsCache = null; // Invalidate cache
  }
  
  // SECOND PASS: Calculate scores using updated max variance
  for (const token of tokenSet) {
    const stats = await getOrCreateTokenStats(token);
    const variance = varianceMap.get(token);
    
    // Update stats with variance
    stats.positional_variance = variance;
    
    // Calculate all scores using UPDATED globalStats
    const stabilityScore = calculateStabilityScore(stats, globalStats);
    const transitionScore = calculateTransitionScore(stats, globalStats);
    const dependencyScore = calculateDependencyScore(stats);
    const structuralScore = calculateStructuralScore(stats, globalStats);
    
    // Update score values for category assignment
    stats.stability_score = stabilityScore;
    stats.transition_score = transitionScore;
    stats.dependency_score = dependencyScore;
    stats.structural_score = structuralScore;
    
    // Determine new category
    const newCategory = assignCategory(stats);
    
    // CATEGORY INERTIA: Require 3 consecutive contexts before switching
    let finalCategory = stats.category || 'unclassified';
    let pendingCategory = stats.pending_category || null;
    let pendingCount = stats.pending_count || 0;
    
    if (newCategory !== stats.category) {
      // Category would change
      if (newCategory === pendingCategory) {
        // Same pending category - increment count
        pendingCount++;
        if (pendingCount >= 3) {
          // Threshold reached - switch category
          finalCategory = newCategory;
          pendingCategory = null;
          pendingCount = 0;
          console.log(`   🏷️ "${token}" → ${finalCategory} (confirmed after 3 contexts)`);
        }
      } else {
        // New pending category - start counting
        pendingCategory = newCategory;
        pendingCount = 1;
      }
    } else {
      // Category stable - reset pending
      pendingCategory = null;
      pendingCount = 0;
    }
    
    // Update in database
    await updateTokenStats(token, {
      positional_variance: variance,
      stability_score: stabilityScore,
      transition_score: transitionScore,
      dependency_score: dependencyScore,
      structural_score: structuralScore,
      category: finalCategory,
      pending_category: pendingCategory,
      pending_count: pendingCount
    });
    
    if (finalCategory !== 'unclassified' && finalCategory !== stats.category) {
      categorized++;
      console.log(`   🏷️ "${token}" → ${finalCategory} (S:${stabilityScore.toFixed(2)} T:${transitionScore.toFixed(2)} D:${dependencyScore.toFixed(2)} St:${structuralScore.toFixed(2)})`);
    }
  }
  
  console.log(`   ✅ ${categorized}/${tokenSet.size} tokens categorized`);
  return categorized;
}

// ===============================================
// STEP 3: CREATE/REINFORCE TWO-WORD PAIRS
// ONLY adjacent tokens form pairs
// ===============================================

async function processWordPairs(tokens, messageIndex) {
  console.log('\n🔗 Processing two-word pairs...');
  
  if (tokens.length < 2) {
    console.log('   Not enough tokens for pairs');
    return { newPairs: 0, reinforced: 0, promoted: 0 };
  }
  
  let newPairs = 0;
  let reinforced = 0;
  let promoted = 0;
  
  // Process ONLY adjacent pairs
  for (let i = 0; i < tokens.length - 1; i++) {
    const tokenA = tokens[i];
    const tokenB = tokens[i + 1];
    
    // Skip if same token
    if (tokenA === tokenB) continue;
    
    const patternKey = generatePatternKey(tokenA, tokenB);
    
    // FIX 1: Always fetch FRESH categories from token_stats
    // Do NOT rely on stored category_pattern from aria_word_pairs
    // category_pattern is stored for reference only, never used for logic
    const statsA = await getOrCreateTokenStats(tokenA);
    const statsB = await getOrCreateTokenStats(tokenB);
    const categoryPattern = `${statsA.category}->${statsB.category}`;
    
    // Use fresh categories for promotion modifiers
    const categoryModifierA = CONFIG.PROMOTION_MODIFIERS[statsA.category] || 1;
    const categoryModifierB = CONFIG.PROMOTION_MODIFIERS[statsB.category] || 1;
    
    // Check for existing pair
    const { data: existing } = await supabase
      .from('aria_word_pairs')
      .select('*')
      .eq('pattern_key', patternKey)
      .single();
    
    if (existing) {
      // REINFORCE existing pair using FRESH categories (not stored category_pattern)
      const categoryModifier = Math.max(categoryModifierA, categoryModifierB);
      
      const addStrength = CONFIG.REINFORCEMENT.base * categoryModifier;
      const newStrength = Math.min(CONFIG.REINFORCEMENT.maxScore, existing.strength + addStrength);
      const newTier = getTierForScore(newStrength);
      
      await supabase
        .from('aria_word_pairs')
        .update({
          frequency: existing.frequency + 1,
          strength: newStrength,
          category_pattern: categoryPattern,
          reinforcement_count: existing.reinforcement_count + 1,
          tier: newTier,
          decay_at_message: messageIndex + CONFIG.DECAY[newTier].interval,
          last_seen_message_index: messageIndex,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      
      reinforced++;
      
      // Check for tier promotion
      if (newTier !== existing.tier) {
        promoted++;
        console.log(`   📈 ${patternKey}: ${existing.tier} → ${newTier} (${newStrength.toFixed(3)})`);
      }
      
    } else {
      // CREATE new pair
      const tier = 'short';
      const sorted = [tokenA, tokenB].sort();
      
      const newPair = {
        id: uuidv4(),
        pattern_key: patternKey,
        token_a: sorted[0],
        token_b: sorted[1],
        frequency: 1,
        strength: CONFIG.REINFORCEMENT.base,
        category_pattern: categoryPattern,
        reinforcement_count: 1,
        decay_count: 0,
        tier: tier,
        decay_at_message: messageIndex + CONFIG.DECAY[tier].interval,
        last_seen_message_index: messageIndex
      };
      
      const { error } = await supabase
        .from('aria_word_pairs')
        .insert(newPair);
      
      if (!error) {
        newPairs++;
        console.log(`   ✨ ${patternKey} [${categoryPattern}]`);
      }
    }
  }
  
  console.log(`   ✅ ${newPairs} new, ${reinforced} reinforced, ${promoted} promoted`);
  return { newPairs, reinforced, promoted };
}

// ===============================================
// STEP 4: DECAY PROCESSING
// ===============================================

async function processDecay(currentMessageIndex) {
  console.log('\n📉 Processing decay...');
  
  let totalDecayed = 0;
  let totalRemoved = 0;
  
  // Get pairs due for decay
  const { data: dueForDecay } = await supabase
    .from('aria_word_pairs')
    .select('*')
    .lte('decay_at_message', currentMessageIndex)
    .neq('tier', 'decay');
  
  if (!dueForDecay || dueForDecay.length === 0) {
    console.log('   No pairs due for decay');
    return { decayed: 0, removed: 0 };
  }
  
  for (const pair of dueForDecay) {
    const config = CONFIG.DECAY[pair.tier] || CONFIG.DECAY.short;
    const newStrength = pair.strength * (1 - config.rate);
    
    if (newStrength < CONFIG.THRESHOLDS.DECAY_MIN) {
      // Move to decay tier (graveyard)
      await supabase
        .from('aria_word_pairs')
        .update({
          tier: 'decay',
          strength: newStrength,
          decay_count: pair.decay_count + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', pair.id);
      
      totalRemoved++;
      
    } else {
      // Apply decay
      const newTier = getTierForScore(newStrength);
      
      await supabase
        .from('aria_word_pairs')
        .update({
          strength: newStrength,
          tier: newTier,
          decay_count: pair.decay_count + 1,
          decay_at_message: currentMessageIndex + CONFIG.DECAY[newTier].interval,
          updated_at: new Date().toISOString()
        })
        .eq('id', pair.id);
      
      totalDecayed++;
    }
  }
  
  // Also process token stats decay (reduce scores slightly)
  const { data: tokensDue } = await supabase
    .from('aria_token_stats')
    .select('*')
    .lt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Older than 24 hours
    .limit(100);
  
  if (tokensDue && tokensDue.length > 0) {
    for (const token of tokensDue) {
      await supabase
        .from('aria_token_stats')
        .update({
          stability_score: token.stability_score * 0.99,
          transition_score: token.transition_score * 0.99,
          dependency_score: token.dependency_score * 0.99,
          structural_score: token.structural_score * 0.99,
          updated_at: new Date().toISOString()
        })
        .eq('id', token.id);
    }
  }
  
  if (totalDecayed + totalRemoved > 0) {
    console.log(`   ✅ ${totalDecayed} decayed, ${totalRemoved} removed to graveyard`);
  }
  
  return { decayed: totalDecayed, removed: totalRemoved };
}

// ===============================================
// LEGACY SUPPORT: Process old-style purgatory
// ===============================================

async function wordsToPurgatory(messageText, messageId, userId, messageIndex) {
  const tokens = tokenizeMessage(messageText);
  
  if (tokens.length === 0) return [];
  
  const words = tokens.map((word, index) => ({
    id: uuidv4(),
    word,
    position: index,
    message_id: messageId,
    message_index: messageIndex,
    user_id: userId
  }));
  
  const { error } = await supabase
    .from('aria_purgatory')
    .insert(words);
  
  if (error) {
    console.error('   ❌ Purgatory error:', error.message);
    return [];
  }
  
  return words;
}

// ===============================================
// MAIN: PROCESS MESSAGE
// ===============================================

export async function processMessage(messageText, messageId, userId) {
  if (!messageText || !userId) {
    return { processed: false, reason: 'Empty message or no user' };
  }
  
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║ ARIA PROCESSING: "${messageText.substring(0, 35)}..."`);
  console.log(`╚════════════════════════════════════════════════╝`);
  
  const messageIndex = await getAndIncrementMessageIndex();
  console.log(`Message #${messageIndex}`);
  
  // Tokenize
  const tokens = tokenizeMessage(messageText);
  
  if (tokens.length === 0) {
    return { processed: true, messageIndex, reason: 'No tokens' };
  }
  
  const isStandalone = tokens.length === 1;
  
  // Legacy: Store in purgatory for backward compatibility
  await wordsToPurgatory(messageText, messageId, userId, messageIndex);
  
  // Step 1: Process token statistics
  const tokensProcessed = await processTokenStatistics(tokens, messageIndex, isStandalone);
  
  // Step 2: Calculate scores and assign categories
  const categorized = await calculateScoresAndCategories(tokens);
  
  // Step 3: Create/reinforce two-word pairs
  const pairResult = await processWordPairs(tokens, messageIndex);
  
  // Step 4: Process decay
  const decayResult = await processDecay(messageIndex);
  
  console.log(`\n📊 SUMMARY: ${tokensProcessed} tokens, ${categorized} categorized, ${pairResult.newPairs} new pairs, ${pairResult.reinforced} reinforced`);
  
  return {
    processed: true,
    messageIndex,
    tokensProcessed,
    categorized,
    newPairs: pairResult.newPairs,
    reinforced: pairResult.reinforced,
    promoted: pairResult.promoted,
    decayed: decayResult.decayed,
    removed: decayResult.removed
  };
}

// ===============================================
// QUERY FUNCTIONS
// ===============================================

export async function getMemoryStats() {
  const { count: shortCount } = await supabase
    .from('aria_word_pairs')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'short');
  
  const { count: mediumCount } = await supabase
    .from('aria_word_pairs')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'medium');
  
  const { count: longCount } = await supabase
    .from('aria_word_pairs')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'long');
  
  const { count: decayCount } = await supabase
    .from('aria_word_pairs')
    .select('*', { count: 'exact', head: true })
    .eq('tier', 'decay');
  
  const { count: tokenCount } = await supabase
    .from('aria_token_stats')
    .select('*', { count: 'exact', head: true });
  
  const { data: categoryCounts } = await supabase
    .from('aria_token_stats')
    .select('category')
    .not('category', 'eq', 'unclassified');
  
  const categories = {
    stable: 0,
    transition: 0,
    modifier: 0,
    structural: 0
  };
  
  if (categoryCounts) {
    for (const row of categoryCounts) {
      if (categories[row.category] !== undefined) {
        categories[row.category]++;
      }
    }
  }
  
  const { data: counter } = await supabase
    .from('aria_message_counter')
    .select('current_index')
    .eq('id', 1)
    .single();
  
  return {
    tiers: {
      short: shortCount || 0,
      medium: mediumCount || 0,
      long: longCount || 0
    },
    decay: decayCount || 0,
    tokens: tokenCount || 0,
    categories,
    messagesProcessed: counter?.current_index || 0
  };
}

export async function getMemoryContext(options = {}) {
  const { limit = 50 } = options;
  
  const { data: shortPairs } = await supabase
    .from('aria_word_pairs')
    .select('*')
    .eq('tier', 'short')
    .order('strength', { ascending: false })
    .limit(limit);
  
  const { data: mediumPairs } = await supabase
    .from('aria_word_pairs')
    .select('*')
    .eq('tier', 'medium')
    .order('strength', { ascending: false })
    .limit(limit);
  
  const { data: longPairs } = await supabase
    .from('aria_word_pairs')
    .select('*')
    .eq('tier', 'long')
    .order('strength', { ascending: false })
    .limit(limit);
  
  return {
    short: shortPairs || [],
    medium: mediumPairs || [],
    long: longPairs || []
  };
}

export async function searchByWord(word) {
  const normalized = word.toLowerCase();
  
  const { data: pairs } = await supabase
    .from('aria_word_pairs')
    .select('*')
    .or(`token_a.eq.${normalized},token_b.eq.${normalized}`)
    .neq('tier', 'decay')
    .order('strength', { ascending: false });
  
  return pairs || [];
}

export async function getTokenStats(token) {
  const { data } = await supabase
    .from('aria_token_stats')
    .select('*')
    .eq('token', token.toLowerCase())
    .single();
  
  return data;
}

export async function getTokensByCategory(category, limit = 50) {
  const { data } = await supabase
    .from('aria_token_stats')
    .select('*')
    .eq('category', category)
    .order('total_occurrences', { ascending: false })
    .limit(limit);
  
  return data || [];
}

export async function getTopPairs(options = {}) {
  const { limit = 100, tier = null } = options;
  
  let query = supabase
    .from('aria_word_pairs')
    .select('*')
    .neq('tier', 'decay')
    .order('strength', { ascending: false })
    .limit(limit);
  
  if (tier) {
    query = query.eq('tier', tier);
  }
  
  const { data } = await query;
  return data || [];
}

export async function getEmergentChains(startWord, maxLength = 5) {
  // Find chains by following overlapping pairs
  const chains = [];
  const visited = new Set();
  
  async function buildChain(currentWord, chain) {
    if (chain.length >= maxLength) {
      chains.push([...chain]);
      return;
    }
    
    // Find pairs containing this word
    const pairs = await searchByWord(currentWord);
    
    for (const pair of pairs.slice(0, 5)) {
      const nextWord = pair.token_a === currentWord ? pair.token_b : pair.token_a;
      
      if (!visited.has(nextWord)) {
        visited.add(nextWord);
        chain.push(nextWord);
        await buildChain(nextWord, chain);
        chain.pop();
        visited.delete(nextWord);
      }
    }
    
    if (chain.length >= 2 && !chains.some(c => c.join('_') === chain.join('_'))) {
      chains.push([...chain]);
    }
  }
  
  visited.add(startWord);
  await buildChain(startWord, [startWord]);
  
  return chains;
}

// ===============================================
// LEGACY COMPATIBILITY
// ===============================================

// Cluster link functions (for backward compatibility with existing code)
export async function getClusterLinks(clusterKey, options = {}) {
  // Map to word pairs
  const words = clusterKey.split('_');
  const results = [];
  
  for (const word of words) {
    const pairs = await searchByWord(word);
    for (const pair of pairs) {
      results.push({
        from_cluster: clusterKey,
        to_cluster: pair.token_a === word ? pair.token_b : pair.token_a,
        score: pair.strength,
        direction: 'forward'
      });
    }
  }
  
  return results.slice(0, options.limit || 20);
}

export async function getClusterNeighbors(clusterKey, options = {}) {
  const links = await getClusterLinks(clusterKey, options);
  return {
    outgoing: links,
    incoming: []
  };
}

export async function searchClustersByWord(word, options = {}) {
  const pairs = await searchByWord(word);
  return pairs.map(p => ({
    key: p.pattern_key,
    score: p.strength
  })).slice(0, options.limit || 50);
}

export async function getTopClusterLinks(options = {}) {
  const pairs = await getTopPairs(options);
  return pairs.map(p => ({
    from_cluster: p.token_a,
    to_cluster: p.token_b,
    score: p.strength,
    direction: 'forward'
  }));
}

export async function getClusterLinkStats() {
  const stats = await getMemoryStats();
  return {
    totalLinks: stats.tiers.short + stats.tiers.medium + stats.tiers.long,
    avgTopScore: 0
  };
}

export default {
  processMessage,
  getMemoryStats,
  getMemoryContext,
  searchByWord,
  getTokenStats,
  getTokensByCategory,
  getTopPairs,
  getEmergentChains,
  // Legacy exports
  getClusterLinks,
  getClusterNeighbors,
  searchClustersByWord,
  getTopClusterLinks,
  getClusterLinkStats
};
