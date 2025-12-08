// ariaCorrelator.js
// ARIA - Pure word correlation
// NO POS, NO GRAMMAR, NO SENTENCES
// Words → Correlations → Phrases → Concepts
// NEW: Cluster-to-Cluster links for sentence flow

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

const THRESHOLDS = {
  SHORT_MAX: 0.30,
  MEDIUM_MAX: 0.80,
  DECAY_MIN: 0.05
};

const DECAY_CONFIG = {
  short: { interval: 50, rate: 0.15 },
  medium: { interval: 200, rate: 0.05 },
  long: { interval: 1000, rate: 0.01 }
};

// NEW: Cluster link configuration
const CLUSTER_LINK_CONFIG = {
  windowSize: 3,           // Link clusters within this distance
  baseScore: 0.02,         // Base score for new links
  adjacentBonus: 0.03,     // Extra score for adjacent clusters
  reinforceAmount: 0.015,  // Score added on reinforcement
  decayInterval: 100,      // Messages between decay checks
  decayRate: 0.10          // Decay rate per interval
};

// ===============================================
// TOKENIZATION - Pure word extraction
// ===============================================
function tokenizeMessage(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length >= 2);
  
  // Return words with their position
  return words.map((word, index) => ({
    word,
    position: index
  }));
}

// ===============================================
// NEW: CLUSTER EXTRACTION
// Extract 1-3 word clusters from message
// ===============================================
function extractClusters(tokens) {
  const clusters = [];
  const words = tokens.map(t => t.word);
  
  if (words.length === 0) return clusters;
  
  let position = 0;
  
  // Extract 1-word clusters
  for (let i = 0; i < words.length; i++) {
    clusters.push({
      words: [words[i]],
      key: words[i],
      position: position++,
      size: 1
    });
  }
  
  // Extract 2-word clusters
  for (let i = 0; i < words.length - 1; i++) {
    const cluster = [words[i], words[i + 1]];
    clusters.push({
      words: cluster,
      key: cluster.join('_'),
      position: position++,
      size: 2
    });
  }
  
  // Extract 3-word clusters
  for (let i = 0; i < words.length - 2; i++) {
    const cluster = [words[i], words[i + 1], words[i + 2]];
    clusters.push({
      words: cluster,
      key: cluster.join('_'),
      position: position++,
      size: 3
    });
  }
  
  return clusters;
}

// ===============================================
// SCORING - Pure proximity
// ===============================================

// Score based on word distance in message
function scoreProximity(distance) {
  // Adjacent words = highest score
  if (distance === 1) return 1.0;
  if (distance === 2) return 0.8;
  if (distance <= 4) return 0.5;
  if (distance <= 7) return 0.3;
  return 0.1;
}

// Calculate initial score (just proximity)
function calculateInitialScore(distance) {
  const proximityScore = scoreProximity(distance);
  // Scale to 0-0.1 range for initial correlation
  return proximityScore * 0.1;
}

// ===============================================
// HELPER FUNCTIONS
// ===============================================

function generatePatternKey(word1, word2) {
  const sorted = [word1.toLowerCase(), word2.toLowerCase()].sort();
  return sorted.join('_');
}

function getTierForScore(score) {
  if (score >= THRESHOLDS.MEDIUM_MAX) return 'long';
  if (score >= THRESHOLDS.SHORT_MAX) return 'medium';
  return 'short';
}

function getTableForTier(tier) {
  return `aria_${tier}`;
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
// FIND EXISTING CORRELATION
// ===============================================
async function findExistingCorrelation(patternKey) {
  const tiers = ['short', 'medium', 'long'];
  
  for (const tier of tiers) {
    const { data, error } = await supabase
      .from(getTableForTier(tier))
      .select('*')
      .eq('pattern_key', patternKey)
      .single();
    
    if (data && !error) {
      return { ...data, currentTier: tier };
    }
  }
  
  // Check decay
  const { data: decayed } = await supabase
    .from('aria_decay')
    .select('*')
    .eq('pattern_key', patternKey)
    .single();
  
  if (decayed) {
    return { ...decayed, currentTier: 'decay' };
  }
  
  return null;
}

// ===============================================
// MOVE CORRELATION BETWEEN TIERS
// ===============================================
async function moveCorrelation(correlation, fromTier, toTier) {
  const fromTable = fromTier === 'decay' ? 'aria_decay' : getTableForTier(fromTier);
  const toTable = getTableForTier(toTier);
  
  await supabase.from(fromTable).delete().eq('id', correlation.id);
  
  const newRecord = {
    id: correlation.id,
    pattern_key: correlation.pattern_key,
    word1: correlation.word1,
    word2: correlation.word2,
    correlation_score: correlation.correlation_score,
    reinforcement_count: correlation.reinforcement_count,
    decay_count: correlation.decay_count || 0,
    decay_at_message: correlation.decay_at_message,
    last_seen_message_index: correlation.last_seen_message_index,
    created_at: correlation.created_at,
    updated_at: new Date().toISOString()
  };
  
  const { error } = await supabase.from(toTable).insert(newRecord);
  
  if (error) {
    console.error(`   ❌ Failed to move to ${toTier}:`, error.message);
    return false;
  }
  
  console.log(`   🔄 ${correlation.pattern_key}: ${fromTier} → ${toTier}`);
  return true;
}

// ===============================================
// STEP 1: WORDS → PURGATORY
// ===============================================
async function wordsToPurgatory(messageText, messageId, userId, messageIndex) {
  const tokens = tokenizeMessage(messageText);
  
  if (tokens.length === 0) return [];
  
  const words = tokens.map(t => ({
    id: uuidv4(),
    word: t.word,
    position: t.position,
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
  
  console.log(`   📥 ${words.length} words → purgatory`);
  return words;
}

// ===============================================
// STEP 2: CORRELATOR
// ===============================================
async function runCorrelator(messageIndex) {
  console.log('\n🔗 Correlating...');
  
  const { data: words, error } = await supabase
    .from('aria_purgatory')
    .select('*')
    .eq('message_index', messageIndex)
    .order('position', { ascending: true });
  
  if (error || !words || words.length < 2) {
    console.log('   Not enough words');
    return { newCorrelations: 0, reinforced: 0, promoted: 0 };
  }
  
  console.log(`   📊 ${words.length} words`);
  
  let newCorrelations = 0;
  let reinforced = 0;
  let promoted = 0;
  
  // Create pairs from all words in message
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const wordA = words[i];
      const wordB = words[j];
      const distance = j - i;
      
      // Skip if same word
      if (wordA.word === wordB.word) continue;
      
      const patternKey = generatePatternKey(wordA.word, wordB.word);
      const existing = await findExistingCorrelation(patternKey);
      
      if (existing) {
        // REINFORCE
        const addScore = calculateInitialScore(distance);
        const newScore = Math.min(1.0, existing.correlation_score + addScore);
        const newTier = getTierForScore(newScore);
        const currentTier = existing.currentTier;
        
        const currentTable = currentTier === 'decay' ? 'aria_decay' : getTableForTier(currentTier);
        
        await supabase
          .from(currentTable)
          .update({
            correlation_score: newScore,
            reinforcement_count: existing.reinforcement_count + 1,
            last_seen_message_index: messageIndex,
            decay_at_message: messageIndex + (DECAY_CONFIG[newTier]?.interval || 50),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        
        console.log(`   📈 ${patternKey} +${addScore.toFixed(3)} = ${newScore.toFixed(3)}`);
        reinforced++;
        
        // Check promotion
        if (currentTier !== 'decay' && newTier !== currentTier) {
          existing.correlation_score = newScore;
          existing.reinforcement_count = existing.reinforcement_count + 1;
          existing.last_seen_message_index = messageIndex;
          existing.decay_at_message = messageIndex + DECAY_CONFIG[newTier].interval;
          
          await moveCorrelation(existing, currentTier, newTier);
          promoted++;
        }
        
        // Resurrect from decay
        if (currentTier === 'decay') {
          existing.correlation_score = newScore;
          existing.reinforcement_count = existing.reinforcement_count + 1;
          existing.last_seen_message_index = messageIndex;
          existing.decay_at_message = messageIndex + DECAY_CONFIG[newTier].interval;
          
          await moveCorrelation(existing, 'decay', newTier);
          console.log(`   🔮 Resurrected: ${patternKey}`);
          promoted++;
        }
        
      } else {
        // NEW CORRELATION
        const initialScore = calculateInitialScore(distance);
        const tier = getTierForScore(initialScore);
        
        const newCorr = {
          id: uuidv4(),
          pattern_key: patternKey,
          word1: wordA.word < wordB.word ? wordA.word : wordB.word,
          word2: wordA.word < wordB.word ? wordB.word : wordA.word,
          correlation_score: initialScore,
          reinforcement_count: 1,
          decay_count: 0,
          decay_at_message: messageIndex + DECAY_CONFIG[tier].interval,
          last_seen_message_index: messageIndex
        };
        
        const { error: insertError } = await supabase
          .from(getTableForTier(tier))
          .insert(newCorr);
        
        if (!insertError) {
          console.log(`   ✨ ${patternKey} = ${initialScore.toFixed(3)}`);
          newCorrelations++;
        }
      }
    }
  }
  
  return { newCorrelations, reinforced, promoted };
}

// ===============================================
// STEP 3: BUILD PHRASES
// ===============================================
async function buildPhrases(messageIndex) {
  console.log('\n📚 Building phrases...');
  
  // Get recent correlations from this message
  const { data: recentCorrs } = await supabase
    .from('aria_short')
    .select('*')
    .eq('last_seen_message_index', messageIndex);
  
  const { data: mediumCorrs } = await supabase
    .from('aria_medium')
    .select('*')
    .eq('last_seen_message_index', messageIndex);
  
  const { data: longCorrs } = await supabase
    .from('aria_long')
    .select('*')
    .eq('last_seen_message_index', messageIndex);
  
  const allCorrs = [...(recentCorrs || []), ...(mediumCorrs || []), ...(longCorrs || [])];
  
  if (allCorrs.length < 2) {
    console.log('   Not enough correlations for phrases');
    return 0;
  }
  
  let newPhrases = 0;
  const processedPairs = new Set();
  
  // Find correlations that share a word
  for (const corrA of allCorrs) {
    for (const corrB of allCorrs) {
      if (corrA.id === corrB.id) continue;
      
      // Find shared word
      let shared = null;
      let otherA = null;
      let otherB = null;
      
      if (corrA.word1 === corrB.word1) {
        shared = corrA.word1;
        otherA = corrA.word2;
        otherB = corrB.word2;
      } else if (corrA.word1 === corrB.word2) {
        shared = corrA.word1;
        otherA = corrA.word2;
        otherB = corrB.word1;
      } else if (corrA.word2 === corrB.word1) {
        shared = corrA.word2;
        otherA = corrA.word1;
        otherB = corrB.word2;
      } else if (corrA.word2 === corrB.word2) {
        shared = corrA.word2;
        otherA = corrA.word1;
        otherB = corrB.word1;
      }
      
      if (!shared || otherA === otherB) continue;
      
      // Create phrase key (sorted)
      const allWords = [otherA, shared, otherB].sort();
      const phraseKey = allWords.join('_');
      
      if (processedPairs.has(phraseKey)) continue;
      processedPairs.add(phraseKey);
      
      const { data: existing } = await supabase
        .from('aria_phrases')
        .select('*')
        .eq('phrase_key', phraseKey)
        .single();
      
      if (existing) {
        // Reinforce
        const combinedScore = Math.min(1.0, corrA.correlation_score + corrB.correlation_score);
        const newScore = Math.min(1.0, existing.correlation_score + combinedScore * 0.5);
        const newTier = getTierForScore(newScore);
        
        await supabase
          .from('aria_phrases')
          .update({
            correlation_score: newScore,
            reinforcement_count: existing.reinforcement_count + 1,
            tier: newTier,
            decay_at_message: messageIndex + DECAY_CONFIG[newTier].interval,
            last_seen_message_index: messageIndex
          })
          .eq('id', existing.id);
        
      } else {
        // New phrase
        const combinedScore = Math.min(1.0, (corrA.correlation_score + corrB.correlation_score) * 0.5);
        const tier = getTierForScore(combinedScore);
        
        const newPhrase = {
          id: uuidv4(),
          phrase_key: phraseKey,
          words: allWords,
          source_correlations: [corrA.id, corrB.id],
          correlation_score: combinedScore,
          reinforcement_count: 1,
          decay_count: 0,
          decay_at_message: messageIndex + DECAY_CONFIG[tier].interval,
          tier: tier,
          last_seen_message_index: messageIndex
        };
        
        const { error } = await supabase
          .from('aria_phrases')
          .insert(newPhrase);
        
        if (!error) {
          console.log(`   📚 "${allWords.join(' ')}"`);
          newPhrases++;
        }
      }
    }
  }
  
  return newPhrases;
}

// ===============================================
// NEW STEP: CLUSTER EXTRACTION & STORAGE
// ===============================================
async function extractAndStoreClusters(messageText, messageId, userId, messageIndex) {
  console.log('\n🧩 Extracting clusters...');
  
  const tokens = tokenizeMessage(messageText);
  const clusters = extractClusters(tokens);
  
  if (clusters.length === 0) {
    console.log('   No clusters extracted');
    return [];
  }
  
  // Store clusters for this message
  const clusterRecords = clusters.map(c => ({
    id: uuidv4(),
    cluster_key: c.key,
    words: c.words,
    position: c.position,
    message_index: messageIndex,
    message_id: messageId,
    user_id: userId
  }));
  
  const { error } = await supabase
    .from('aria_clusters')
    .insert(clusterRecords);
  
  if (error) {
    // Table might not exist yet - that's OK
    if (!error.message.includes('does not exist')) {
      console.error('   ❌ Cluster storage error:', error.message);
    }
    return clusters; // Return clusters anyway for linking
  }
  
  console.log(`   🧩 ${clusters.length} clusters extracted`);
  return clusters;
}

// ===============================================
// NEW STEP: BUILD CLUSTER LINKS
// Creates connections between clusters
// ===============================================
async function buildClusterLinks(clusters, messageIndex) {
  console.log('\n🔗 Building cluster links...');
  
  if (clusters.length < 2) {
    console.log('   Not enough clusters for linking');
    return { newLinks: 0, reinforced: 0 };
  }
  
  let newLinks = 0;
  let reinforcedLinks = 0;
  const processedPairs = new Set();
  
  // Sort clusters by their original position in the message
  // For multi-word clusters, use average position
  const sortedClusters = [...clusters].sort((a, b) => {
    // Single words have clearer positions
    // Multi-word clusters: use first word position
    return a.position - b.position;
  });
  
  // Create links between clusters within window
  for (let i = 0; i < sortedClusters.length; i++) {
    for (let j = i + 1; j < sortedClusters.length && j <= i + CLUSTER_LINK_CONFIG.windowSize; j++) {
      const clusterA = sortedClusters[i];
      const clusterB = sortedClusters[j];
      
      // Skip identical clusters
      if (clusterA.key === clusterB.key) continue;
      
      // Skip if already processed this pair
      const pairKey = `${clusterA.key}|${clusterB.key}`;
      const reversePairKey = `${clusterB.key}|${clusterA.key}`;
      if (processedPairs.has(pairKey) || processedPairs.has(reversePairKey)) continue;
      processedPairs.add(pairKey);
      
      const distance = j - i;
      
      // Calculate link score based on distance
      let linkScore = CLUSTER_LINK_CONFIG.baseScore;
      if (distance === 1) {
        linkScore += CLUSTER_LINK_CONFIG.adjacentBonus;
      } else if (distance === 2) {
        linkScore += CLUSTER_LINK_CONFIG.adjacentBonus * 0.5;
      }
      
      // Create FORWARD link (A → B)
      const forwardResult = await upsertClusterLink(
        clusterA.key,
        clusterB.key,
        'forward',
        linkScore,
        messageIndex
      );
      
      if (forwardResult.isNew) {
        newLinks++;
        console.log(`   🔗 ${clusterA.key} → ${clusterB.key} (${linkScore.toFixed(3)})`);
      } else if (forwardResult.reinforced) {
        reinforcedLinks++;
      }
      
      // Create BIDIRECTIONAL link (for semantic association)
      const biResult = await upsertClusterLink(
        clusterB.key,
        clusterA.key,
        'bidirectional',
        linkScore * 0.5, // Lower score for reverse direction
        messageIndex
      );
      
      if (biResult.isNew) {
        newLinks++;
      } else if (biResult.reinforced) {
        reinforcedLinks++;
      }
    }
  }
  
  console.log(`   ✅ ${newLinks} new links, ${reinforcedLinks} reinforced`);
  return { newLinks, reinforced: reinforcedLinks };
}

// ===============================================
// UPSERT CLUSTER LINK
// ===============================================
async function upsertClusterLink(fromCluster, toCluster, direction, addScore, messageIndex) {
  // Check if link exists
  const { data: existing, error: findError } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .eq('from_cluster', fromCluster)
    .eq('to_cluster', toCluster)
    .single();
  
  if (findError && !findError.message.includes('does not exist') && 
      !findError.message.includes('No rows found') &&
      !findError.message.includes('JSON object requested')) {
    // Table might not exist - skip silently
    return { isNew: false, reinforced: false };
  }
  
  if (existing) {
    // REINFORCE existing link
    const newScore = Math.min(1.0, existing.score + CLUSTER_LINK_CONFIG.reinforceAmount);
    
    await supabase
      .from('aria_cluster_links')
      .update({
        score: newScore,
        reinforcement_count: existing.reinforcement_count + 1,
        last_seen_message_index: messageIndex,
        decay_at_message: messageIndex + CLUSTER_LINK_CONFIG.decayInterval,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
    
    return { isNew: false, reinforced: true };
    
  } else {
    // CREATE new link
    const newLink = {
      id: uuidv4(),
      from_cluster: fromCluster,
      to_cluster: toCluster,
      direction: direction,
      score: addScore,
      reinforcement_count: 1,
      decay_count: 0,
      decay_at_message: messageIndex + CLUSTER_LINK_CONFIG.decayInterval,
      last_seen_message_index: messageIndex
    };
    
    const { error: insertError } = await supabase
      .from('aria_cluster_links')
      .insert(newLink);
    
    if (insertError) {
      // Table might not exist
      if (!insertError.message.includes('does not exist')) {
        console.error('   ❌ Link insert error:', insertError.message);
      }
      return { isNew: false, reinforced: false };
    }
    
    return { isNew: true, reinforced: false };
  }
}

// ===============================================
// NEW: DECAY CLUSTER LINKS
// ===============================================
async function decayClusterLinks(currentMessageIndex) {
  const { data: dueForDecay, error } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .lte('decay_at_message', currentMessageIndex);
  
  if (error || !dueForDecay || dueForDecay.length === 0) return 0;
  
  let decayedCount = 0;
  let removedCount = 0;
  
  for (const link of dueForDecay) {
    const newScore = link.score * (1 - CLUSTER_LINK_CONFIG.decayRate);
    
    if (newScore < 0.005) {
      // Remove very weak links
      await supabase
        .from('aria_cluster_links')
        .delete()
        .eq('id', link.id);
      removedCount++;
    } else {
      // Decay the link
      await supabase
        .from('aria_cluster_links')
        .update({
          score: newScore,
          decay_count: (link.decay_count || 0) + 1,
          decay_at_message: currentMessageIndex + CLUSTER_LINK_CONFIG.decayInterval
        })
        .eq('id', link.id);
      decayedCount++;
    }
  }
  
  if (decayedCount + removedCount > 0) {
    console.log(`   📉 Cluster links: ${decayedCount} decayed, ${removedCount} removed`);
  }
  
  return decayedCount + removedCount;
}

// ===============================================
// STEP 4: DECAY CHECK
// ===============================================
async function checkDecay(currentMessageIndex) {
  const tiers = ['short', 'medium', 'long'];
  let totalDecayed = 0;
  let totalDemoted = 0;
  let totalToGraveyard = 0;
  
  for (const tier of tiers) {
    const table = getTableForTier(tier);
    const config = DECAY_CONFIG[tier];
    
    const { data: dueForDecay } = await supabase
      .from(table)
      .select('*')
      .lte('decay_at_message', currentMessageIndex);
    
    if (!dueForDecay || dueForDecay.length === 0) continue;
    
    for (const corr of dueForDecay) {
      const newScore = corr.correlation_score * (1 - config.rate);
      const newDecayCount = (corr.decay_count || 0) + 1;
      
      if (newScore < THRESHOLDS.DECAY_MIN) {
        // To graveyard
        await supabase.from(table).delete().eq('id', corr.id);
        
        await supabase.from('aria_decay').insert({
          id: corr.id,
          pattern_key: corr.pattern_key,
          word1: corr.word1,
          word2: corr.word2,
          correlation_score: newScore,
          reinforcement_count: corr.reinforcement_count,
          decay_count: newDecayCount,
          decayed_from: tier,
          decayed_at: new Date().toISOString()
        });
        
        totalToGraveyard++;
        
      } else {
        const newTier = getTierForScore(newScore);
        
        if (newTier !== tier) {
          corr.correlation_score = newScore;
          corr.decay_count = newDecayCount;
          corr.decay_at_message = currentMessageIndex + DECAY_CONFIG[newTier].interval;
          
          await moveCorrelation(corr, tier, newTier);
          totalDemoted++;
        } else {
          await supabase
            .from(table)
            .update({
              correlation_score: newScore,
              decay_count: newDecayCount,
              decay_at_message: currentMessageIndex + config.interval
            })
            .eq('id', corr.id);
          
          totalDecayed++;
        }
      }
    }
  }
  
  // NEW: Also decay cluster links
  await decayClusterLinks(currentMessageIndex);
  
  if (totalDecayed + totalDemoted + totalToGraveyard > 0) {
    console.log(`   📉 Decay: ${totalDecayed} decayed, ${totalDemoted} demoted, ${totalToGraveyard} buried`);
  }
  
  return { decayed: totalDecayed, demoted: totalDemoted, toGraveyard: totalToGraveyard };
}

// ===============================================
// MAIN: PROCESS MESSAGE
// ===============================================
export async function processMessage(messageText, messageId, userId) {
  if (!messageText || !userId) {
    return { processed: false, reason: 'Empty message or no user' };
  }
  
  console.log(`\n📝 "${messageText.substring(0, 50)}..."`);
  
  const messageIndex = await getAndIncrementMessageIndex();
  console.log(`   #${messageIndex}`);
  
  const words = await wordsToPurgatory(messageText, messageId, userId, messageIndex);
  
  if (words.length < 2) {
    return { processed: true, messageIndex, newCorrelations: 0, reinforced: 0 };
  }
  
  const corrResult = await runCorrelator(messageIndex);
  const newPhrases = await buildPhrases(messageIndex);
  
  // NEW: Extract clusters and build cluster links
  const clusters = await extractAndStoreClusters(messageText, messageId, userId, messageIndex);
  const clusterLinkResult = await buildClusterLinks(clusters, messageIndex);
  
  const decayResult = await checkDecay(messageIndex);
  
  console.log(`\n📊 ${words.length} words, ${corrResult.newCorrelations} new, ${corrResult.reinforced} reinforced`);
  console.log(`   🔗 ${clusterLinkResult.newLinks} new cluster links, ${clusterLinkResult.reinforced} reinforced`);
  
  return {
    processed: true,
    messageIndex,
    wordsProcessed: words.length,
    ...corrResult,
    newPhrases,
    clusterLinks: clusterLinkResult,
    ...decayResult
  };
}

// ===============================================
// QUERY FUNCTIONS
// ===============================================
export async function getMemoryContext(options = {}) {
  const { limit = 50 } = options;
  
  const { data: shortMem } = await supabase
    .from('aria_short')
    .select('*')
    .order('correlation_score', { ascending: false })
    .limit(limit);
  
  const { data: mediumMem } = await supabase
    .from('aria_medium')
    .select('*')
    .order('correlation_score', { ascending: false })
    .limit(limit);
  
  const { data: longMem } = await supabase
    .from('aria_long')
    .select('*')
    .order('correlation_score', { ascending: false })
    .limit(limit);
  
  const { data: phrases } = await supabase
    .from('aria_phrases')
    .select('*')
    .order('correlation_score', { ascending: false })
    .limit(20);
  
  return {
    short: shortMem || [],
    medium: mediumMem || [],
    long: longMem || [],
    phrases: phrases || []
  };
}

export async function searchByWord(word) {
  const normalized = word.toLowerCase();
  const results = [];
  
  for (const table of ['aria_short', 'aria_medium', 'aria_long']) {
    const { data } = await supabase
      .from(table)
      .select('*')
      .or(`word1.eq.${normalized},word2.eq.${normalized}`)
      .order('correlation_score', { ascending: false });
    
    if (data) {
      data.forEach(d => {
        d.tier = table.replace('aria_', '');
        results.push(d);
      });
    }
  }
  
  return results;
}

// ===============================================
// NEW: CLUSTER LINK QUERY FUNCTIONS
// ===============================================

// Get outgoing links from a cluster
export async function getClusterLinks(clusterKey, options = {}) {
  const { limit = 20, minScore = 0.01 } = options;
  
  const { data: outgoing, error } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .eq('from_cluster', clusterKey)
    .gte('score', minScore)
    .order('score', { ascending: false })
    .limit(limit);
  
  if (error) {
    // Table might not exist
    return [];
  }
  
  return outgoing || [];
}

// Get all links involving a cluster (both directions)
export async function getClusterNeighbors(clusterKey, options = {}) {
  const { limit = 30, minScore = 0.01 } = options;
  
  const { data: outgoing } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .eq('from_cluster', clusterKey)
    .gte('score', minScore)
    .order('score', { ascending: false })
    .limit(limit);
  
  const { data: incoming } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .eq('to_cluster', clusterKey)
    .gte('score', minScore)
    .order('score', { ascending: false })
    .limit(limit);
  
  return {
    outgoing: outgoing || [],
    incoming: incoming || []
  };
}

// Search for clusters containing a word
export async function searchClustersByWord(word, options = {}) {
  const { limit = 50 } = options;
  const normalized = word.toLowerCase();
  
  // Get all cluster links where from_cluster or to_cluster contains the word
  const { data: fromLinks } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .ilike('from_cluster', `%${normalized}%`)
    .order('score', { ascending: false })
    .limit(limit);
  
  const { data: toLinks } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .ilike('to_cluster', `%${normalized}%`)
    .order('score', { ascending: false })
    .limit(limit);
  
  // Collect unique clusters
  const clusters = new Map();
  
  for (const link of [...(fromLinks || []), ...(toLinks || [])]) {
    if (link.from_cluster.includes(normalized)) {
      if (!clusters.has(link.from_cluster) || clusters.get(link.from_cluster).score < link.score) {
        clusters.set(link.from_cluster, { key: link.from_cluster, score: link.score });
      }
    }
    if (link.to_cluster.includes(normalized)) {
      if (!clusters.has(link.to_cluster) || clusters.get(link.to_cluster).score < link.score) {
        clusters.set(link.to_cluster, { key: link.to_cluster, score: link.score });
      }
    }
  }
  
  return Array.from(clusters.values()).sort((a, b) => b.score - a.score);
}

// Get top cluster links overall
export async function getTopClusterLinks(options = {}) {
  const { limit = 100 } = options;
  
  const { data, error } = await supabase
    .from('aria_cluster_links')
    .select('*')
    .order('score', { ascending: false })
    .limit(limit);
  
  if (error) return [];
  return data || [];
}

// Get cluster link stats
export async function getClusterLinkStats() {
  const { count: totalLinks } = await supabase
    .from('aria_cluster_links')
    .select('*', { count: 'exact', head: true });
  
  const { data: topLinks } = await supabase
    .from('aria_cluster_links')
    .select('score')
    .order('score', { ascending: false })
    .limit(10);
  
  const avgScore = topLinks && topLinks.length > 0 
    ? topLinks.reduce((sum, l) => sum + l.score, 0) / topLinks.length 
    : 0;
  
  return {
    totalLinks: totalLinks || 0,
    avgTopScore: avgScore
  };
}

// ===============================================
// MEMORY STATS (updated to include cluster links)
// ===============================================
export async function getMemoryStats() {
  const { count: shortCount } = await supabase
    .from('aria_short')
    .select('*', { count: 'exact', head: true });
  
  const { count: mediumCount } = await supabase
    .from('aria_medium')
    .select('*', { count: 'exact', head: true });
  
  const { count: longCount } = await supabase
    .from('aria_long')
    .select('*', { count: 'exact', head: true });
  
  const { count: decayCount } = await supabase
    .from('aria_decay')
    .select('*', { count: 'exact', head: true });
  
  const { count: phraseCount } = await supabase
    .from('aria_phrases')
    .select('*', { count: 'exact', head: true });
  
  const { data: counter } = await supabase
    .from('aria_message_counter')
    .select('current_index')
    .eq('id', 1)
    .single();
  
  // NEW: Get cluster link stats
  const clusterStats = await getClusterLinkStats();
  
  return {
    tiers: {
      short: shortCount || 0,
      medium: mediumCount || 0,
      long: longCount || 0
    },
    decay: decayCount || 0,
    phrases: phraseCount || 0,
    clusterLinks: clusterStats.totalLinks,
    messagesProcessed: counter?.current_index || 0
  };
}

export default {
  processMessage,
  getMemoryContext,
  searchByWord,
  getMemoryStats,
  // NEW exports for cluster links
  getClusterLinks,
  getClusterNeighbors,
  searchClustersByWord,
  getTopClusterLinks,
  getClusterLinkStats
};
