// ariaGenerator.js
// ARIA - Pure word graph response generation
// NO LLM, NO GRAMMAR, NO TEMPLATES
// Just walks the word correlation graph

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getMemoryContext, searchByWord, getMemoryStats } from './ariaCorrelator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
// BUILD WORD GRAPH
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
// WALK THE GRAPH
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
// GENERATE RESPONSE
// ===============================================
export async function generateResponse(userMessage, options = {}) {
  const { maxLength = 150 } = options;
  
  console.log(`\n🧠 ARIA: "${userMessage.substring(0, 40)}..."`);
  
  // Get memory stats
  const ariaStats = await getMemoryStats();
  const ariaTotal = ariaStats.tiers.short + ariaStats.tiers.medium + ariaStats.tiers.long;
  
  console.log(`   ARIA: ${ariaTotal} correlations`);
  
  // Empty memory = silence
  if (ariaTotal === 0) {
    console.log(`   ⚠️ No memory`);
    return "...";
  }
  
  // Extract words from user message
  const keywords = extractWords(userMessage);
  console.log(`   Words: ${keywords.slice(0, 5).join(', ')}...`);
  
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
  
  if (uniqueCorrs.length === 0) {
    return "...";
  }
  
  // Build word graph
  const graph = buildWordGraph(uniqueCorrs);
  console.log(`   Graph: ${graph.size} words`);
  
  if (graph.size === 0) {
    return "...";
  }
  
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
  
  // Build response
  let response = '';
  
  if (fragments.length === 0) {
    // Fallback: use strongest correlations
    const strong = uniqueCorrs
      .filter(c => c.correlation_score > 0.2)
      .slice(0, 3);
    
    if (strong.length > 0) {
      response = strong.map(c => `${c.word1} ${c.word2}`).join(' ');
    } else {
      return "...";
    }
  } else {
    // Join fragments
    response = fragments.map(f => f.join(' ')).join(' ');
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
  
  return { keywords, correlations: unique };
}

// ===============================================
// BUILD CONTEXT (for API inspection)
// ===============================================
export async function buildMemoryContext(userMessage) {
  const ariaStats = await getMemoryStats();
  const keywords = extractWords(userMessage || '');
  const topMemory = await getMemoryContext({ limit: 30 });
  
  let context = `ARIA: ${ariaStats.tiers.short + ariaStats.tiers.medium + ariaStats.tiers.long} correlations\n`;
  context += `Phrases: ${ariaStats.phrases}\n`;
  context += `Messages: ${ariaStats.messagesProcessed}\n\n`;
  
  if (topMemory.long.length > 0) {
    context += `Strong:\n`;
    for (const c of topMemory.long.slice(0, 10)) {
      context += `  ${c.word1} + ${c.word2} (${c.correlation_score.toFixed(2)})\n`;
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
