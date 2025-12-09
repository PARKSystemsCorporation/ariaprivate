// ariaGenerator.js
// =============================================
// ARIA - EMERGENT RESPONSE GENERATION
// =============================================
// ARIA generates responses by:
// 1. Finding relevant word pairs based on input
// 2. Building emergent phrases from overlapping pairs
// 3. Walking the pair graph with category-aware transitions
// 4. NO LLM, NO TEMPLATES - Pure emergent behavior
// =============================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  getMemoryStats,
  getMemoryContext,
  searchByWord,
  getTokenStats,
  getTokensByCategory,
  getTopPairs,
  getEmergentChains,
  getClusterLinks,
  getTopClusterLinks,
  searchClustersByWord
} from './ariaCorrelator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ===============================================
// CONFIGURATION
// ===============================================

const GENERATION_CONFIG = {
  maxWords: 12,              // Maximum words in response
  minWords: 3,               // Minimum words for valid response
  maxAttempts: 10,           // Max graph walk attempts
  strengthThreshold: 0.01,   // Minimum pair strength to follow
  randomnessFactor: 0.25,    // Chance to pick non-top option
  
  // Category transition preferences
  // What categories tend to follow what
  categoryTransitions: {
    stable: ['modifier', 'transition', 'structural'],
    modifier: ['stable', 'structural'],
    transition: ['stable', 'modifier', 'structural'],
    structural: ['stable', 'modifier', 'transition'],
    unclassified: ['stable', 'modifier', 'transition', 'structural']
  },
  
  // Category weights for starting word selection
  startingWeights: {
    stable: 1.5,       // Prefer starting with stable (nouns)
    transition: 1.0,   // Verbs OK
    modifier: 0.7,     // Less likely to start with modifiers
    structural: 0.3,   // Rarely start with structural words
    unclassified: 0.5
  }
};

// ===============================================
// TOKENIZATION
// ===============================================

function extractWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

// ===============================================
// BUILD WORD GRAPH FROM PAIRS
// ===============================================

async function buildWordGraph(pairs) {
  const graph = new Map();
  
  // FIX 2: Extract all unique tokens from pairs
  const allTokens = new Set();
  for (const pair of pairs) {
    if (pair.token_a) allTokens.add(pair.token_a);
    if (pair.token_b) allTokens.add(pair.token_b);
  }
  
  // FIX 2: Batch-fetch all token stats with single Supabase query
  const tokenArray = Array.from(allTokens);
  const categoryMap = new Map();
  
  if (tokenArray.length > 0) {
    const { data: tokenStats } = await supabase
      .from('aria_token_stats')
      .select('token, category')
      .in('token', tokenArray);
    
    if (tokenStats) {
      for (const stat of tokenStats) {
        categoryMap.set(stat.token, stat.category || 'unclassified');
      }
    }
  }
  
  // FIX 2: Build graph without per-pair async calls
  for (const pair of pairs) {
    const { token_a, token_b, strength } = pair;
    if (!token_a || !token_b) continue;
    
    // Only include pairs above strength threshold
    if (strength < GENERATION_CONFIG.strengthThreshold) continue;
    
    // Get categories from batch-fetched map
    const catA = categoryMap.get(token_a) || 'unclassified';
    const catB = categoryMap.get(token_b) || 'unclassified';
    
    // Add edges in both directions
    if (!graph.has(token_a)) {
      graph.set(token_a, { edges: [], category: catA });
    }
    if (!graph.has(token_b)) {
      graph.set(token_b, { edges: [], category: catB });
    }
    
    graph.get(token_a).edges.push({
      word: token_b,
      weight: strength,
      category: catB
    });
    
    graph.get(token_b).edges.push({
      word: token_a,
      weight: strength,
      category: catA
    });
  }
  
  // Sort edges by weight
  for (const [, node] of graph) {
    node.edges.sort((a, b) => b.weight - a.weight);
  }
  
  return graph;
}

// ===============================================
// CATEGORY-AWARE EDGE SELECTION
// ===============================================

function selectNextWord(edges, currentCategory, visited, lastCategory) {
  // Filter out visited words
  const available = edges.filter(e => !visited.has(e.word));
  
  if (available.length === 0) return null;
  
  // Get preferred next categories
  const preferredCategories = GENERATION_CONFIG.categoryTransitions[lastCategory] || 
                               GENERATION_CONFIG.categoryTransitions.unclassified;
  
  // Score each available edge
  const scored = available.map(edge => {
    let score = edge.weight;
    
    // Boost if category is preferred transition
    if (preferredCategories.includes(edge.category)) {
      score *= 1.5;
    }
    
    // Add randomness
    score *= (1 + Math.random() * GENERATION_CONFIG.randomnessFactor);
    
    return { ...edge, score };
  });
  
  // Sort by adjusted score
  scored.sort((a, b) => b.score - a.score);
  
  // Usually pick the top, but sometimes pick second or third
  const pickIndex = Math.random() < 0.7 ? 0 : 
                    Math.random() < 0.8 ? Math.min(1, scored.length - 1) :
                    Math.min(2, scored.length - 1);
  
  return scored[pickIndex];
}

// ===============================================
// WALK THE WORD GRAPH
// ===============================================

async function walkGraph(graph, startWord, maxLength, keywords = [], retried = false, retrySet = null) {
  // FIX 3: Initialize retrySet if not provided (persists through recursive fallback attempts)
  if (!retrySet) {
    retrySet = new Set();
  }
  
  // Initialize visited early to prevent circular recursion
  const visited = new Set([startWord]);
  
  if (!graph.has(startWord)) {
    // Dead-end recovery - try alternative start if not retried
    if (!retried && keywords.length > 0) {
      const altStart = await findAlternativeStart(graph, startWord, keywords, visited, retrySet);
      // FIX: Also check !visited.has(altStart) to prevent circular recursion
      if (altStart && altStart !== startWord && !visited.has(altStart)) {
        // FIX 3: Add altStart to retrySet to prevent infinite loops
        retrySet.add(altStart);
        console.log(`   🔄 Dead-end recovery: "${startWord}" → "${altStart}"`);
        return walkGraph(graph, altStart, maxLength, keywords, true, retrySet);
      }
    }
    return [startWord];
  }
  
  const path = [startWord];
  let current = startWord;
  let lastCategory = graph.get(startWord).category;
  
  while (path.length < maxLength) {
    const node = graph.get(current);
    if (!node || node.edges.length === 0) {
      // Dead-end recovery - try alternative start if not retried
      if (!retried && path.length < GENERATION_CONFIG.minWords) {
        const altStart = await findAlternativeStart(graph, current, keywords, visited, retrySet);
        if (altStart) {
          // FIX 3: Add altStart to retrySet to prevent infinite loops
          retrySet.add(altStart);
          console.log(`   🔄 Dead-end at "${current}", recovering with "${altStart}"`);
          // Continue from alternative instead of full restart
          if (!visited.has(altStart)) {
            path.push(altStart);
            visited.add(altStart);
            current = altStart;
            lastCategory = graph.get(altStart)?.category || 'unclassified';
            continue;
          }
        }
      }
      break;
    }
    
    const next = selectNextWord(node.edges, node.category, visited, lastCategory);
    
    if (!next || next.weight < GENERATION_CONFIG.strengthThreshold) {
      // Dead-end recovery on no valid next word
      if (!retried && path.length < GENERATION_CONFIG.minWords) {
        const altStart = await findAlternativeStart(graph, current, keywords, visited, retrySet);
        if (altStart && !visited.has(altStart)) {
          // FIX 3: Add altStart to retrySet to prevent infinite loops
          retrySet.add(altStart);
          console.log(`   🔄 No valid edges from "${current}", trying "${altStart}"`);
          path.push(altStart);
          visited.add(altStart);
          current = altStart;
          lastCategory = graph.get(altStart)?.category || 'unclassified';
          retried = true; // Only retry once
          continue;
        }
      }
      break;
    }
    
    path.push(next.word);
    visited.add(next.word);
    lastCategory = next.category;
    current = next.word;
  }
  
  return path;
}

// ===============================================
// FIND ALTERNATIVE START WORD FOR DEAD-END RECOVERY
// ===============================================

async function findAlternativeStart(graph, excludeWord, keywords, visited = new Set(), retrySet = new Set()) {
  // Priority 1: Other keywords in graph
  for (const keyword of keywords) {
    // FIX 3: Never choose a token that exists in retrySet
    if (keyword !== excludeWord && graph.has(keyword) && !visited.has(keyword) && !retrySet.has(keyword)) {
      const node = graph.get(keyword);
      if (node.edges.length > 0) {
        return keyword;
      }
    }
  }
  
  // Priority 2: Stable tokens with most connections
  let bestStable = null;
  let bestStableScore = 0;
  
  for (const [word, node] of graph) {
    // FIX 3: Never choose a token that exists in retrySet
    if (word === excludeWord || visited.has(word) || retrySet.has(word)) continue;
    if (node.category === 'stable' && node.edges.length > bestStableScore) {
      bestStable = word;
      bestStableScore = node.edges.length;
    }
  }
  
  if (bestStable) return bestStable;
  
  // Priority 3: Any word with highest degree
  let bestWord = null;
  let bestDegree = 0;
  
  for (const [word, node] of graph) {
    // FIX 3: Never choose a token that exists in retrySet
    if (word === excludeWord || visited.has(word) || retrySet.has(word)) continue;
    if (node.edges.length > bestDegree) {
      bestWord = word;
      bestDegree = node.edges.length;
    }
  }
  
  return bestWord;
}

// ===============================================
// FIND BEST STARTING WORD
// ===============================================

async function findBestStartWord(keywords, graph) {
  // Priority 1: Keywords that exist in graph
  const keywordsInGraph = keywords.filter(k => graph.has(k));
  
  if (keywordsInGraph.length > 0) {
    // Score by category weight and connection count
    const scored = [];
    
    for (const keyword of keywordsInGraph) {
      const node = graph.get(keyword);
      const categoryWeight = GENERATION_CONFIG.startingWeights[node.category] || 0.5;
      const connectionScore = Math.min(1, node.edges.length / 10);
      
      scored.push({
        word: keyword,
        score: categoryWeight * (1 + connectionScore) * (1 + Math.random() * 0.3)
      });
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0].word;
  }
  
  // Priority 2: Highest-connected stable word
  let bestWord = null;
  let bestScore = 0;
  
  for (const [word, node] of graph) {
    if (node.category === 'stable' && node.edges.length > bestScore) {
      bestWord = word;
      bestScore = node.edges.length;
    }
  }
  
  if (bestWord) return bestWord;
  
  // Priority 3: Any word with most connections
  for (const [word, node] of graph) {
    if (node.edges.length > bestScore) {
      bestWord = word;
      bestScore = node.edges.length;
    }
  }
  
  // Guarantee fallback - never return null if graph has nodes
  return bestWord || Array.from(graph.keys())[0];
}

// ===============================================
// EMERGENT PHRASE DISCOVERY
// Build longer phrases from overlapping pairs
// ===============================================

async function discoverEmergentPhrases(keywords, maxPhrases = 3) {
  const phrases = [];
  
  for (const keyword of keywords.slice(0, 5)) {
    // Get chains starting from this keyword
    const chains = await getEmergentChains(keyword, 5);
    
    for (const chain of chains) {
      if (chain.length >= 2) {
        phrases.push({
          words: chain,
          strength: 1.0 / chain.length // Shorter chains are stronger
        });
      }
    }
  }
  
  // Sort by strength and return top phrases
  phrases.sort((a, b) => b.strength - a.strength);
  return phrases.slice(0, maxPhrases);
}

// ===============================================
// GENERATE RESPONSE
// ===============================================

export async function generateResponse(userMessage, options = {}) {
  const { maxLength = 150 } = options;
  
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║ ARIA GENERATING: "${userMessage.substring(0, 30)}..."`);
  console.log(`╚════════════════════════════════════════════════╝`);
  
  // Get memory stats
  const stats = await getMemoryStats();
  const totalPairs = stats.tiers.short + stats.tiers.medium + stats.tiers.long;
  
  console.log(`📊 Memory: ${totalPairs} pairs, ${stats.tokens} tokens`);
  console.log(`   Categories: S:${stats.categories.stable} T:${stats.categories.transition} M:${stats.categories.modifier} St:${stats.categories.structural}`);
  
  // Empty memory = silence
  if (totalPairs === 0) {
    console.log(`   ⚠️ No memory - returning silence`);
    return "...";
  }
  
  // Extract keywords from input
  const keywords = extractWords(userMessage);
  console.log(`   Keywords: ${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? '...' : ''}`);
  
  let response = '';
  
  // ===== METHOD 1: Try emergent phrase discovery =====
  console.log(`\n🌱 Attempting emergent phrase discovery...`);
  
  try {
    const emergentPhrases = await discoverEmergentPhrases(keywords);
    
    if (emergentPhrases.length > 0) {
      console.log(`   Found ${emergentPhrases.length} emergent phrases`);
      
      // Use the best emergent phrases
      const usedWords = new Set();
      const fragments = [];
      
      for (const phrase of emergentPhrases) {
        // Skip if too much overlap with used words
        const overlap = phrase.words.filter(w => usedWords.has(w)).length;
        if (overlap > phrase.words.length * 0.5) continue;
        
        fragments.push(phrase.words.join(' '));
        phrase.words.forEach(w => usedWords.add(w));
        
        if (usedWords.size >= GENERATION_CONFIG.maxWords) break;
      }
      
      if (fragments.length > 0) {
        response = fragments.join(' ');
        console.log(`   ✅ Emergent: "${response}"`);
      }
    }
  } catch (error) {
    console.log(`   ⚠️ Emergent discovery error: ${error.message}`);
  }
  
  // ===== METHOD 2: Graph walking =====
  if (!response || response.split(' ').length < GENERATION_CONFIG.minWords) {
    console.log(`\n📈 Attempting graph walk...`);
    
    try {
      // Get relevant pairs
      const relevantPairs = [];
      
      // Search for pairs containing keywords
      for (const keyword of keywords.slice(0, 10)) {
        const pairs = await searchByWord(keyword);
        relevantPairs.push(...pairs);
      }
      
      // Get top pairs from memory
      const topPairs = await getTopPairs({ limit: 100 });
      relevantPairs.push(...topPairs);
      
      // Deduplicate
      const seen = new Set();
      const uniquePairs = relevantPairs.filter(p => {
        const key = p.pattern_key;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      console.log(`   Building graph from ${uniquePairs.length} pairs`);
      
      if (uniquePairs.length > 0) {
        // Build word graph
        const graph = await buildWordGraph(uniquePairs);
        console.log(`   Graph: ${graph.size} words`);
        
        if (graph.size > 0) {
          // Find best starting word
          const startWord = await findBestStartWord(keywords, graph);
          
          if (startWord) {
            console.log(`   Starting from: "${startWord}"`);
            
            // Walk the graph (pass keywords for dead-end recovery)
            const path = await walkGraph(graph, startWord, GENERATION_CONFIG.maxWords, keywords);
            
            if (path.length >= GENERATION_CONFIG.minWords) {
              response = path.join(' ');
              console.log(`   ✅ Graph walk: "${response}"`);
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️ Graph walk error: ${error.message}`);
    }
  }
  
  // ===== METHOD 3: Category-based composition =====
  if (!response || response.split(' ').length < GENERATION_CONFIG.minWords) {
    console.log(`\n🏷️ Attempting category-based composition...`);
    
    try {
      const fragments = [];
      
      // Get stable words (nouns) first
      const stableTokens = await getTokensByCategory('stable', 5);
      
      if (stableTokens.length > 0) {
        // Find stable tokens related to keywords
        const relevantStable = stableTokens.filter(t => 
          keywords.some(k => t.token.includes(k) || k.includes(t.token))
        );
        
        const baseToken = relevantStable.length > 0 ? relevantStable[0] : stableTokens[0];
        
        // Find pairs for this token
        const pairs = await searchByWord(baseToken.token);
        
        // FIX 1: Extract all unique "other" tokens and batch-fetch their categories
        // Use Set to deduplicate - prevents massive .in() clause truncation
        const otherTokens = [...new Set(
          pairs.map(p => 
            p.token_a === baseToken.token ? p.token_b : p.token_a
          ).filter(Boolean)
        )];
        
        const categoryMap = new Map();
        if (otherTokens.length > 0) {
          const { data: tokenStats } = await supabase
            .from('aria_token_stats')
            .select('token, category')
            .in('token', otherTokens);
          
          if (tokenStats) {
            for (const stat of tokenStats) {
              categoryMap.set(stat.token, stat.category || 'unclassified');
            }
          }
        }
        
        // FIX 1: Filter pairs by dynamically fetched category (not category_pattern)
        const modifierPairs = pairs.filter(p => {
          const other = p.token_a === baseToken.token ? p.token_b : p.token_a;
          return categoryMap.get(other) === 'modifier';
        });
        
        // FIX 7: Add variability - 30% chance to skip modifier
        const skipModifier = Math.random() < 0.3;
        
        let modifier = null;
        if (!skipModifier && modifierPairs.length > 0) {
          modifier = modifierPairs[0].token_a === baseToken.token 
            ? modifierPairs[0].token_b 
            : modifierPairs[0].token_a;
        }
        
        // FIX 1: Filter transition pairs by dynamically fetched category
        const transitionPairs = pairs.filter(p => {
          const other = p.token_a === baseToken.token ? p.token_b : p.token_a;
          return categoryMap.get(other) === 'transition';
        });
        
        let transition = null;
        if (transitionPairs.length > 0) {
          transition = transitionPairs[0].token_a === baseToken.token
            ? transitionPairs[0].token_b
            : transitionPairs[0].token_a;
        }
        
        // FIX 7: 20% chance to insert structural word between stable and transition
        let structural = null;
        if (Math.random() < 0.2) {
          // FIX 1: Filter structural pairs by dynamically fetched category
          const structuralPairs = pairs.filter(p => {
            const other = p.token_a === baseToken.token ? p.token_b : p.token_a;
            return categoryMap.get(other) === 'structural';
          });
          if (structuralPairs.length > 0) {
            structural = structuralPairs[0].token_a === baseToken.token
              ? structuralPairs[0].token_b
              : structuralPairs[0].token_a;
          }
        }
        
        // FIX 7: Randomize order - sometimes modifier → stable, sometimes stable → modifier
        const reverseModifierOrder = Math.random() < 0.3;
        
        // Build fragments with variability
        if (modifier && !reverseModifierOrder) {
          fragments.push(modifier);
        }
        
        fragments.push(baseToken.token);
        
        if (modifier && reverseModifierOrder) {
          fragments.push(modifier);
        }
        
        if (structural && transition) {
          // Insert structural between stable and transition
          fragments.push(structural);
        }
        
        if (transition) {
          fragments.push(transition);
        }
      }
      
      if (fragments.length > 0) {
        response = fragments.join(' ');
        console.log(`   ✅ Category composition: "${response}"`);
      }
    } catch (error) {
      console.log(`   ⚠️ Category composition error: ${error.message}`);
    }
  }
  
  // ===== METHOD 4: Raw pair fallback =====
  if (!response || response.split(' ').length < 2) {
    console.log(`\n🔗 Falling back to raw pairs...`);
    
    try {
      const topPairs = await getTopPairs({ limit: 5 });
      
      if (topPairs.length > 0) {
        // Find pairs related to keywords
        const relevantPairs = topPairs.filter(p =>
          keywords.some(k => p.token_a.includes(k) || p.token_b.includes(k) ||
                            k.includes(p.token_a) || k.includes(p.token_b))
        );
        
        const usePairs = relevantPairs.length > 0 ? relevantPairs : topPairs;
        
        response = usePairs
          .slice(0, 3)
          .map(p => `${p.token_a} ${p.token_b}`)
          .join(' ');
        
        console.log(`   ✅ Raw pairs: "${response}"`);
      }
    } catch (error) {
      console.log(`   ⚠️ Raw pair error: ${error.message}`);
    }
  }
  
  // ===== FINAL CLEANUP =====
  if (!response) {
    console.log(`   ⚠️ No response generated`);
    return "...";
  }
  
  // Clean up response
  response = response
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove duplicate consecutive words
  const words = response.split(' ');
  const deduped = words.filter((word, i) => i === 0 || word !== words[i - 1]);
  response = deduped.join(' ');
  
  // Truncate if too long
  if (response.length > maxLength) {
    response = response.substring(0, maxLength).trim();
    const lastSpace = response.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) {
      response = response.substring(0, lastSpace);
    }
  }
  
  console.log(`\n✨ FINAL: "${response}"`);
  
  return response || "...";
}

// ===============================================
// QUERY MEMORY (for API)
// ===============================================

export async function queryMemory(query) {
  const keywords = extractWords(query);
  
  const results = [];
  for (const keyword of keywords) {
    const pairs = await searchByWord(keyword);
    results.push(...pairs);
  }
  
  // Deduplicate
  const seen = new Set();
  const unique = results.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  
  unique.sort((a, b) => b.strength - a.strength);
  
  // Get token stats for keywords
  const tokenStats = [];
  for (const keyword of keywords.slice(0, 5)) {
    const stats = await getTokenStats(keyword);
    if (stats) {
      tokenStats.push(stats);
    }
  }
  
  // Get emergent chains
  const chains = [];
  for (const keyword of keywords.slice(0, 3)) {
    const keywordChains = await getEmergentChains(keyword, 4);
    chains.push(...keywordChains.map(c => c.join(' ')));
  }
  
  return {
    keywords,
    pairs: unique.slice(0, 50),
    tokenStats,
    emergentChains: [...new Set(chains)].slice(0, 10)
  };
}

// ===============================================
// BUILD MEMORY CONTEXT (for API inspection)
// ===============================================

export async function buildMemoryContext(userMessage) {
  const stats = await getMemoryStats();
  const keywords = extractWords(userMessage || '');
  const topMemory = await getMemoryContext({ limit: 30 });
  
  let context = `═══════════════════════════════════════\n`;
  context += `ARIA EMERGENT LINGUISTIC SYSTEM\n`;
  context += `═══════════════════════════════════════\n\n`;
  
  context += `📊 MEMORY STATE\n`;
  context += `   Pairs: ${stats.tiers.short + stats.tiers.medium + stats.tiers.long}\n`;
  context += `   └─ Short: ${stats.tiers.short}\n`;
  context += `   └─ Medium: ${stats.tiers.medium}\n`;
  context += `   └─ Long: ${stats.tiers.long}\n`;
  context += `   └─ Decay: ${stats.decay}\n`;
  context += `   Tokens: ${stats.tokens}\n`;
  context += `   Messages: ${stats.messagesProcessed}\n\n`;
  
  context += `🏷️ EMERGENT CATEGORIES\n`;
  context += `   Stable (noun-like): ${stats.categories.stable}\n`;
  context += `   Transition (verb-like): ${stats.categories.transition}\n`;
  context += `   Modifier (adjective-like): ${stats.categories.modifier}\n`;
  context += `   Structural (function words): ${stats.categories.structural}\n\n`;
  
  if (topMemory.long.length > 0) {
    context += `🔗 STRONG PAIRS (long-term)\n`;
    for (const pair of topMemory.long.slice(0, 10)) {
      context += `   ${pair.token_a} + ${pair.token_b} (${pair.strength.toFixed(3)}) [${pair.category_pattern}]\n`;
    }
    context += `\n`;
  }
  
  if (keywords.length > 0) {
    context += `🔍 QUERY KEYWORDS: ${keywords.join(', ')}\n\n`;
    
    // Show emergent chains for keywords
    for (const keyword of keywords.slice(0, 2)) {
      const chains = await getEmergentChains(keyword, 4);
      if (chains.length > 0) {
        context += `   Chains from "${keyword}":\n`;
        for (const chain of chains.slice(0, 3)) {
          context += `   └─ ${chain.join(' → ')}\n`;
        }
      }
    }
  }
  
  return context;
}

// ===============================================
// CATEGORY ANALYSIS (for API)
// ===============================================

export async function analyzeCategories() {
  const stable = await getTokensByCategory('stable', 20);
  const transition = await getTokensByCategory('transition', 20);
  const modifier = await getTokensByCategory('modifier', 20);
  const structural = await getTokensByCategory('structural', 20);
  
  return {
    stable: stable.map(t => ({
      token: t.token,
      occurrences: t.total_occurrences,
      score: t.stability_score
    })),
    transition: transition.map(t => ({
      token: t.token,
      occurrences: t.total_occurrences,
      score: t.transition_score
    })),
    modifier: modifier.map(t => ({
      token: t.token,
      occurrences: t.total_occurrences,
      score: t.dependency_score
    })),
    structural: structural.map(t => ({
      token: t.token,
      occurrences: t.total_occurrences,
      score: t.structural_score
    }))
  };
}

export default {
  generateResponse,
  queryMemory,
  buildMemoryContext,
  analyzeCategories,
  getMemoryStats
};
