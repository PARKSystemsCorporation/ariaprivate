// ariaGenerator.js
// ARIA - Pure word graph response generation
// NO LLM, NO GRAMMAR, NO TEMPLATES
// Just walks the word correlation graph
// NEW: Uses cluster links for coherent multi-cluster sequences

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { 
  getMemoryContext, 
  searchByWord, 
  getMemoryStats,
  getClusterLinks,
  getClusterNeighbors,
  searchClustersByWord,
  getTopClusterLinks
} from './ariaCorrelator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ===============================================
// CONFIGURATION
// ===============================================
const GENERATION_CONFIG = {
  maxClusters: 8,           // Max clusters in a response
  minClusters: 2,           // Min clusters for valid response
  linkScoreThreshold: 0.01, // Minimum link score to follow
  randomnessFactor: 0.3,    // Chance to pick non-top link
  useClusterLinks: true,    // Enable cluster-based generation
  fallbackToWordGraph: true // Fall back to word graph if no clusters
};

// ===============================================
// EXTRACT WORDS (no filtering)
// ===============================================
function extractWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

// ===============================================
// EXTRACT CLUSTERS FROM INPUT
// ===============================================
function extractInputClusters(text) {
  const words = extractWords(text);
  const clusters = [];
  
  // Single words
  for (const word of words) {
    clusters.push({ key: word, words: [word], size: 1 });
  }
  
  // Two-word clusters
  for (let i = 0; i < words.length - 1; i++) {
    const key = `${words[i]}_${words[i+1]}`;
    clusters.push({ key, words: [words[i], words[i+1]], size: 2 });
  }
  
  // Three-word clusters
  for (let i = 0; i < words.length - 2; i++) {
    const key = `${words[i]}_${words[i+1]}_${words[i+2]}`;
    clusters.push({ key, words: [words[i], words[i+1], words[i+2]], size: 3 });
  }
  
  return clusters;
}

// ===============================================
// BUILD WORD GRAPH (existing logic)
// ===============================================
function buildWordGraph(correlations) {
  const graph = new Map();
  
  for (const corr of correlations) {
    const { word1, word2, correlation_score } = corr;
    if (!word1 || !word2) continue;
    
    const weight = correlation_score || 0.1;
    
    if (!graph.has(word1)) graph.set(word1, []);
    if (!graph.has(word2)) graph.set(word2, []);
    
    graph.get(word1).push({ word: word2, weight });
    graph.get(word2).push({ word: word1, weight });
  }
  
  // Sort edges by weight
  for (const [, edges] of graph) {
    edges.sort((a, b) => b.weight - a.weight);
  }
  
  return graph;
}

// ===============================================
// WALK THE WORD GRAPH (existing logic)
// ===============================================
function walkGraph(graph, startWord, maxLength = 8) {
  if (!graph.has(startWord)) return [startWord];
  
  const path = [startWord];
  const visited = new Set([startWord]);
  let current = startWord;
  
  while (path.length < maxLength) {
    const edges = graph.get(current);
    if (!edges || edges.length === 0) break;
    
    // Pick next word - weighted random
    let next = null;
    for (const edge of edges) {
      if (!visited.has(edge.word)) {
        // Higher weight = more likely to be picked
        if (!next || Math.random() < edge.weight * 0.5) {
          next = edge.word;
          if (Math.random() < 0.7) break; // Usually take first valid
        }
      }
    }
    
    if (!next) break;
    
    path.push(next);
    visited.add(next);
    current = next;
  }
  
  return path;
}

// ===============================================
// NEW: BUILD CLUSTER GRAPH
// Creates a graph where nodes are clusters and
// edges are weighted cluster links
// ===============================================
async function buildClusterGraph(inputClusters, keywords) {
  const graph = new Map();
  const clusterScores = new Map();
  
  // Find relevant clusters from input
  const relevantClusters = new Set();
  
  // Add input clusters
  for (const cluster of inputClusters) {
    relevantClusters.add(cluster.key);
  }
  
  // Search for clusters containing keywords
  for (const keyword of keywords.slice(0, 5)) {
    const found = await searchClustersByWord(keyword, { limit: 20 });
    for (const cluster of found) {
      relevantClusters.add(cluster.key);
      clusterScores.set(cluster.key, Math.max(
        clusterScores.get(cluster.key) || 0,
        cluster.score
      ));
    }
  }
  
  // Get top cluster links overall (for fallback)
  const topLinks = await getTopClusterLinks({ limit: 100 });
  
  // Build graph from cluster links
  for (const link of topLinks) {
    const { from_cluster, to_cluster, score } = link;
    
    if (!graph.has(from_cluster)) {
      graph.set(from_cluster, []);
    }
    
    graph.get(from_cluster).push({
      cluster: to_cluster,
      weight: score,
      direction: link.direction
    });
    
    // Also add reverse for bidirectional links
    if (link.direction === 'bidirectional') {
      if (!graph.has(to_cluster)) {
        graph.set(to_cluster, []);
      }
      graph.get(to_cluster).push({
        cluster: from_cluster,
        weight: score * 0.8, // Slightly lower for reverse
        direction: 'bidirectional'
      });
    }
  }
  
  // Sort edges by weight
  for (const [, edges] of graph) {
    edges.sort((a, b) => b.weight - a.weight);
  }
  
  // Add neighbors for relevant clusters
  for (const clusterKey of relevantClusters) {
    const links = await getClusterLinks(clusterKey, { limit: 10 });
    
    if (!graph.has(clusterKey)) {
      graph.set(clusterKey, []);
    }
    
    for (const link of links) {
      // Check if edge already exists
      const exists = graph.get(clusterKey).some(e => e.cluster === link.to_cluster);
      if (!exists) {
        graph.get(clusterKey).push({
          cluster: link.to_cluster,
          weight: link.score,
          direction: link.direction
        });
      }
    }
    
    // Re-sort
    graph.get(clusterKey).sort((a, b) => b.weight - a.weight);
  }
  
  return { graph, relevantClusters: Array.from(relevantClusters), clusterScores };
}

// ===============================================
// NEW: WALK CLUSTER GRAPH
// Follows cluster links to build a coherent sequence
// ===============================================
function walkClusterGraph(graph, startCluster, maxClusters = 6) {
  if (!graph.has(startCluster)) {
    return [startCluster];
  }
  
  const path = [startCluster];
  const visitedClusters = new Set([startCluster]);
  // Track individual words to avoid too much repetition
  const usedWords = new Set(startCluster.split('_'));
  let current = startCluster;
  
  while (path.length < maxClusters) {
    const edges = graph.get(current);
    if (!edges || edges.length === 0) break;
    
    // Find next cluster
    let next = null;
    let nextWeight = 0;
    
    for (const edge of edges) {
      if (visitedClusters.has(edge.cluster)) continue;
      
      // Check word overlap - avoid too much repetition
      const clusterWords = edge.cluster.split('_');
      const overlapCount = clusterWords.filter(w => usedWords.has(w)).length;
      
      // Allow some overlap (for continuity) but not too much
      if (overlapCount > clusterWords.length * 0.5) continue;
      
      // Weight includes link score plus randomness
      const effectiveWeight = edge.weight * (1 + Math.random() * GENERATION_CONFIG.randomnessFactor);
      
      if (!next || effectiveWeight > nextWeight) {
        next = edge.cluster;
        nextWeight = effectiveWeight;
      }
      
      // Sometimes accept first good option
      if (Math.random() < 0.6 && edge.weight > GENERATION_CONFIG.linkScoreThreshold) {
        break;
      }
    }
    
    if (!next) break;
    
    path.push(next);
    visitedClusters.add(next);
    
    // Track words
    for (const word of next.split('_')) {
      usedWords.add(word);
    }
    
    current = next;
  }
  
  return path;
}

// ===============================================
// NEW: MERGE CLUSTER SEQUENCE INTO TEXT
// Intelligently joins clusters, removing duplicates
// ===============================================
function mergeClustersToText(clusterPath) {
  if (clusterPath.length === 0) return '';
  if (clusterPath.length === 1) return clusterPath[0].replace(/_/g, ' ');
  
  const result = [];
  let lastWords = [];
  
  for (const clusterKey of clusterPath) {
    const words = clusterKey.split('_');
    
    // Find overlap with previous cluster
    let overlapStart = 0;
    if (lastWords.length > 0) {
      // Check if first word(s) of current cluster match last word(s) of previous
      for (let i = 1; i <= Math.min(words.length, lastWords.length); i++) {
        const prevEnd = lastWords.slice(-i);
        const currStart = words.slice(0, i);
        if (prevEnd.join('_') === currStart.join('_')) {
          overlapStart = i;
        }
      }
    }
    
    // Add non-overlapping words
    const newWords = words.slice(overlapStart);
    result.push(...newWords);
    
    lastWords = words;
  }
  
  return result.join(' ');
}

// ===============================================
// NEW: FIND BEST STARTING CLUSTER
// ===============================================
async function findBestStartCluster(inputClusters, keywords, graph, relevantClusters) {
  // Priority 1: Input clusters that exist in graph with outgoing edges
  for (const cluster of inputClusters) {
    if (graph.has(cluster.key) && graph.get(cluster.key).length > 0) {
      return cluster.key;
    }
  }
  
  // Priority 2: Relevant clusters from keyword search
  for (const clusterKey of relevantClusters) {
    if (graph.has(clusterKey) && graph.get(clusterKey).length > 0) {
      return clusterKey;
    }
  }
  
  // Priority 3: Any cluster containing a keyword
  for (const keyword of keywords) {
    for (const [clusterKey, edges] of graph) {
      if (clusterKey.includes(keyword) && edges.length > 0) {
        return clusterKey;
      }
    }
  }
  
  // Priority 4: Highest-connected cluster
  let bestCluster = null;
  let bestEdgeCount = 0;
  
  for (const [clusterKey, edges] of graph) {
    if (edges.length > bestEdgeCount) {
      bestCluster = clusterKey;
      bestEdgeCount = edges.length;
    }
  }
  
  return bestCluster;
}

// ===============================================
// GENERATE RESPONSE
// ===============================================
export async function generateResponse(userMessage, options = {}) {
  const { maxLength = 150 } = options;
  
  console.log(`\n🧠 ARIA: "${userMessage.substring(0, 40)}..."`);
  
  // Get memory stats
  const ariaStats = await getMemoryStats();
  const ariaTotal = ariaStats.tiers.short + ariaStats.tiers.medium + ariaStats.tiers.long;
  
  console.log(`   ARIA: ${ariaTotal} correlations, ${ariaStats.clusterLinks || 0} cluster links`);
  
  // Empty memory = silence
  if (ariaTotal === 0 && (!ariaStats.clusterLinks || ariaStats.clusterLinks === 0)) {
    console.log(`   ⚠️ No memory`);
    return "...";
  }
  
  // Extract words and clusters from user message
  const keywords = extractWords(userMessage);
  const inputClusters = extractInputClusters(userMessage);
  console.log(`   Words: ${keywords.slice(0, 5).join(', ')}...`);
  console.log(`   Input clusters: ${inputClusters.length}`);
  
  let response = '';
  
  // ===== TRY CLUSTER-BASED GENERATION FIRST =====
  if (GENERATION_CONFIG.useClusterLinks && ariaStats.clusterLinks > 0) {
    console.log(`   🔗 Attempting cluster-based generation...`);
    
    try {
      // Build cluster graph
      const { graph, relevantClusters, clusterScores } = await buildClusterGraph(inputClusters, keywords);
      
      console.log(`   📊 Cluster graph: ${graph.size} nodes`);
      
      if (graph.size > 0) {
        // Find best starting cluster
        const startCluster = await findBestStartCluster(inputClusters, keywords, graph, relevantClusters);
        
        if (startCluster) {
          console.log(`   🚀 Starting from: "${startCluster}"`);
          
          // Walk the cluster graph
          const clusterPath = walkClusterGraph(graph, startCluster, GENERATION_CONFIG.maxClusters);
          
          console.log(`   📍 Path: ${clusterPath.length} clusters`);
          
          if (clusterPath.length >= GENERATION_CONFIG.minClusters) {
            // Merge clusters into text
            response = mergeClustersToText(clusterPath);
            console.log(`   ✅ Cluster response: "${response}"`);
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️ Cluster generation error: ${error.message}`);
    }
  }
  
  // ===== FALL BACK TO WORD GRAPH IF NEEDED =====
  if (!response && GENERATION_CONFIG.fallbackToWordGraph) {
    console.log(`   📚 Falling back to word graph...`);
    
    // Find related ARIA correlations
    const ariaCorrs = [];
    for (const kw of keywords.slice(0, 10)) {
      const related = await searchByWord(kw);
      ariaCorrs.push(...related);
    }
    
    // Get top memory
    const topMemory = await getMemoryContext({ limit: 100 });
    
    // Combine all correlations
    const allCorrs = [
      ...ariaCorrs,
      ...topMemory.short,
      ...topMemory.medium,
      ...topMemory.long
    ];
    
    // Deduplicate
    const seen = new Set();
    const uniqueCorrs = allCorrs.filter(c => {
      const key = `${c.word1}_${c.word2}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    console.log(`   Correlations: ${uniqueCorrs.length}`);
    
    if (uniqueCorrs.length > 0) {
      // Build word graph
      const graph = buildWordGraph(uniqueCorrs);
      console.log(`   Graph: ${graph.size} words`);
      
      if (graph.size > 0) {
        // Find starting words (prefer keywords that exist in graph)
        const startWords = keywords.filter(k => graph.has(k));
        if (startWords.length === 0) {
          // Use random graph nodes
          startWords.push(...[...graph.keys()].slice(0, 3));
        }
        
        // Walk from multiple starts
        const fragments = [];
        const usedWords = new Set();
        
        for (const start of startWords.slice(0, 3)) {
          if (usedWords.has(start)) continue;
          
          const path = walkGraph(graph, start, 4 + Math.floor(Math.random() * 4));
          
          if (path.length >= 2) {
            path.forEach(w => usedWords.add(w));
            fragments.push(path);
          }
        }
        
        // Include phrases
        if (topMemory.phrases && topMemory.phrases.length > 0) {
          const relevantPhrases = topMemory.phrases
            .filter(p => p.words && p.words.some(w => keywords.includes(w) || usedWords.has(w)))
            .slice(0, 2);
          
          for (const phrase of relevantPhrases) {
            fragments.push(phrase.words);
          }
        }
        
        // Build response from fragments
        if (fragments.length > 0) {
          response = fragments.map(f => f.join(' ')).join(' ');
        } else {
          // Fallback: use strongest correlations
          const strong = uniqueCorrs
            .filter(c => c.correlation_score > 0.2)
            .slice(0, 3);
          
          if (strong.length > 0) {
            response = strong.map(c => `${c.word1} ${c.word2}`).join(' ');
          }
        }
      }
    }
  }
  
  // ===== FINAL CLEANUP =====
  if (!response) {
    return "...";
  }
  
  // Clean up
  response = response
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  
  // Truncate
  if (response.length > maxLength) {
    response = response.substring(0, maxLength).trim();
    const lastSpace = response.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) {
      response = response.substring(0, lastSpace);
    }
  }
  
  console.log(`   ✅ "${response}"`);
  
  return response || "...";
}

// ===============================================
// QUERY MEMORY (for API)
// ===============================================
export async function queryMemory(query) {
  const keywords = extractWords(query);
  
  const ariaCorrs = [];
  for (const kw of keywords) {
    const related = await searchByWord(kw);
    ariaCorrs.push(...related);
  }
  
  // Dedupe
  const seen = new Set();
  const unique = ariaCorrs.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  
  unique.sort((a, b) => b.correlation_score - a.correlation_score);
  
  // Also get cluster data
  const clusterResults = [];
  for (const kw of keywords.slice(0, 3)) {
    const clusters = await searchClustersByWord(kw, { limit: 10 });
    clusterResults.push(...clusters);
  }
  
  return { 
    keywords, 
    correlations: unique,
    clusters: clusterResults
  };
}

// ===============================================
// BUILD CONTEXT (for API inspection)
// ===============================================
export async function buildMemoryContext(userMessage) {
  const ariaStats = await getMemoryStats();
  const keywords = extractWords(userMessage || '');
  const topMemory = await getMemoryContext({ limit: 30 });
  
  let context = `ARIA: ${ariaStats.tiers.short + ariaStats.tiers.medium + ariaStats.tiers.long} correlations\n`;
  context += `Cluster Links: ${ariaStats.clusterLinks || 0}\n`;
  context += `Phrases: ${ariaStats.phrases}\n`;
  context += `Messages: ${ariaStats.messagesProcessed}\n\n`;
  
  if (topMemory.long.length > 0) {
    context += `Strong Correlations:\n`;
    for (const c of topMemory.long.slice(0, 10)) {
      context += `  ${c.word1} + ${c.word2} (${c.correlation_score.toFixed(2)})\n`;
    }
  }
  
  // Add cluster link info
  const topLinks = await getTopClusterLinks({ limit: 10 });
  if (topLinks.length > 0) {
    context += `\nTop Cluster Links:\n`;
    for (const link of topLinks) {
      context += `  ${link.from_cluster} → ${link.to_cluster} (${link.score.toFixed(3)})\n`;
    }
  }
  
  return context;
}

export default {
  generateResponse,
  queryMemory,
  buildMemoryContext,
  getMemoryStats
};
