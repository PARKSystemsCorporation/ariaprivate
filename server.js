// server.js
// =============================================
// ARIA - EMERGENT LINGUISTIC SYSTEM
// Main Entry Point + API
// =============================================
// ARIA is NOT an LLM. It learns through:
// - Token statistics → Emergent categories
// - Two-word pairs → Emergent phrases
// - Graph walking → Emergent responses
// =============================================

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import {
  processMessage,
  getMemoryStats,
  getMemoryContext,
  searchByWord,
  getTokenStats,
  getTokensByCategory,
  getTopPairs,
  getEmergentChains,
  getClusterLinks,
  getClusterNeighbors,
  searchClustersByWord,
  getTopClusterLinks
} from './ariaCorrelator.js';
import {
  generateResponse,
  queryMemory,
  buildMemoryContext,
  analyzeCategories
} from './ariaGenerator.js';

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const PORT = process.env.PORT || 3002;

// ===============================================
// ARIA CONFIGURATION
// ===============================================

const ARIA = {
  id: 'aria',
  name: 'ARIA',
  fullName: 'Adaptive Resonance Intelligence Architecture',
  emoji: '✨',
  color: '#06b6d4',
  
  // Trigger patterns
  triggers: {
    mentions: ['@aria', 'aria,', 'hey aria', 'aria?', 'yo aria'],
    commands: ['/aria', '/a'],
    questions: true,
  },
  
  // Response settings
  responseDelay: 50,
  maxResponseLength: 200,
};

// Track recent messages
const recentlyProcessed = new Set();

// ===============================================
// CHECK IF ARIA SHOULD RESPOND
// ===============================================

function shouldAriaRespond(message, userEmail) {
  const content = message.toLowerCase().trim();
  
  if (userEmail === null || userEmail === ARIA.id) return { respond: false };
  
  for (const mention of ARIA.triggers.mentions) {
    if (content.includes(mention.toLowerCase())) {
      return { respond: true, reason: 'mention' };
    }
  }
  
  for (const cmd of ARIA.triggers.commands) {
    if (content.startsWith(cmd.toLowerCase())) {
      return { respond: true, reason: 'command' };
    }
  }
  
  if (ARIA.triggers.questions && content.includes('?')) {
    if (Math.random() < 0.3) {
      return { respond: true, reason: 'question' };
    }
  }
  
  return { respond: false };
}

// ===============================================
// CLEAN MESSAGE FOR ARIA
// ===============================================

function cleanMessageForAria(message) {
  let cleaned = message;
  
  for (const mention of ARIA.triggers.mentions) {
    cleaned = cleaned.replace(new RegExp(mention, 'gi'), '').trim();
  }
  
  for (const cmd of ARIA.triggers.commands) {
    if (cleaned.toLowerCase().startsWith(cmd)) {
      cleaned = cleaned.slice(cmd.length).trim();
    }
  }
  
  return cleaned || message;
}

// ===============================================
// SEND ARIA'S RESPONSE TO CHAT
// ===============================================

async function sendAriaResponse(responseText, replyToMessageId = null) {
  const { data, error } = await supabase
    .from('aria_messages')
    .insert({
      id: uuidv4(),
      user_id: null,
      user_email: null,
      bot_id: ARIA.id,
      content: responseText
    })
    .select()
    .single();
  
  if (error) {
    console.error('❌ Failed to send ARIA response:', error);
    return null;
  }
  
  console.log(`✨ ARIA: ${responseText.substring(0, 50)}...`);
  return data;
}

// ===============================================
// MAIN MESSAGE HANDLER
// ===============================================

async function handleNewMessage(message) {
  const messageId = message.id;
  
  if (recentlyProcessed.has(messageId)) return;
  recentlyProcessed.add(messageId);
  
  if (recentlyProcessed.size > 100) {
    const arr = Array.from(recentlyProcessed);
    arr.slice(0, 50).forEach(id => recentlyProcessed.delete(id));
  }
  
  // Ignore bot messages
  if (message.bot_id) {
    console.log(`⭐️ Ignoring bot message from: ${message.bot_id}`);
    return;
  }
  
  const userEmail = message.user_email;
  const content = message.content;
  
  console.log(`\n📨 New message from ${userEmail}: "${content.substring(0, 50)}..."`);
  
  // Step 1: Process for memory
  try {
    const memoryResult = await processMessage(content, messageId, message.user_id);
    if (memoryResult.processed) {
      console.log(`   📊 Memory: ${memoryResult.newPairs || 0} new pairs, ${memoryResult.reinforced || 0} reinforced`);
      console.log(`   🏷️ Categorized: ${memoryResult.categorized || 0} tokens`);
    }
  } catch (error) {
    console.error('   ❌ Memory processing error:', error.message);
  }
  
  // Step 2: Check if ARIA should respond
  const shouldRespond = shouldAriaRespond(content, userEmail);
  
  if (!shouldRespond.respond) {
    console.log(`   💤 ARIA not triggered`);
    return;
  }
  
  console.log(`   🎯 ARIA triggered by: ${shouldRespond.reason}`);
  
  // Step 3: Generate and send response
  try {
    const cleanedMessage = cleanMessageForAria(content);
    
    await new Promise(resolve => setTimeout(resolve, ARIA.responseDelay));
    
    const response = await generateResponse(cleanedMessage, {
      maxLength: ARIA.maxResponseLength
    });
    
    await sendAriaResponse(response, messageId);
    
  } catch (error) {
    console.error('   ❌ ARIA response error:', error.message);
    await sendAriaResponse("...");
  }
}

// ===============================================
// POLL FOR NEW MESSAGES
// ===============================================

let lastProcessedId = null;
let lastProcessedTime = null;

async function pollForMessages() {
  try {
    let query = supabase
      .from('aria_messages')
      .select('*')
      .is('bot_id', null)
      .order('created_at', { ascending: true })
      .limit(10);
    
    if (lastProcessedTime) {
      query = query.gt('created_at', lastProcessedTime);
    }
    
    const { data: messages, error } = await query;
    
    if (error) {
      console.error('❌ Poll error:', error.message);
      return;
    }
    
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        if (msg.id === lastProcessedId) continue;
        
        await handleNewMessage(msg);
        lastProcessedId = msg.id;
        lastProcessedTime = msg.created_at;
      }
    }
  } catch (err) {
    console.error('❌ Poll exception:', err.message);
  }
}

function startPolling() {
  console.log('🔄 Starting message polling (every 2 seconds)...');
  lastProcessedTime = new Date().toISOString();
  setInterval(pollForMessages, 2000);
  console.log('✅ Polling active');
}

// ===============================================
// API ENDPOINTS - CORE
// ===============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gari-aria',
    bot: ARIA.name,
    version: '2.0.0',
    system: 'Emergent Linguistic System'
  });
});

// Get ARIA info
app.get('/api/aria', (req, res) => {
  res.json({
    id: ARIA.id,
    name: ARIA.name,
    fullName: ARIA.fullName,
    emoji: ARIA.emoji,
    color: ARIA.color,
    triggers: ARIA.triggers,
    system: 'Emergent Linguistic System',
    categories: ['stable', 'transition', 'modifier', 'structural']
  });
});

// ===============================================
// API ENDPOINTS - MEMORY
// ===============================================

// Get memory statistics
app.get('/api/memory/stats', async (req, res) => {
  try {
    const stats = await getMemoryStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search memory
app.get('/api/memory/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" required' });
    }
    const results = await queryMemory(q);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get memory context
app.get('/api/memory/context', async (req, res) => {
  try {
    const { message } = req.query;
    const context = await buildMemoryContext(message || '');
    res.json({ context });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// API ENDPOINTS - TOKEN STATISTICS
// ===============================================

// Get token stats
app.get('/api/tokens/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const stats = await getTokenStats(token);
    
    if (!stats) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get tokens by category
app.get('/api/tokens/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 50 } = req.query;
    
    const validCategories = ['stable', 'transition', 'modifier', 'structural', 'unclassified'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category',
        validCategories 
      });
    }
    
    const tokens = await getTokensByCategory(category, parseInt(limit));
    res.json({ category, tokens });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze all categories
app.get('/api/categories', async (req, res) => {
  try {
    const analysis = await analyzeCategories();
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// API ENDPOINTS - WORD PAIRS
// ===============================================

// Get top pairs
app.get('/api/pairs', async (req, res) => {
  try {
    const { limit = 100, tier } = req.query;
    const pairs = await getTopPairs({
      limit: parseInt(limit),
      tier: tier || null
    });
    res.json({ pairs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search pairs by word
app.get('/api/pairs/search', async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" required' });
    }
    const pairs = await searchByWord(q);
    res.json({ query: q, pairs: pairs.slice(0, parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// API ENDPOINTS - EMERGENT PHRASES
// ===============================================

// Get emergent chains from a word
app.get('/api/chains/:word', async (req, res) => {
  try {
    const { word } = req.params;
    const { maxLength = 5 } = req.query;
    
    const chains = await getEmergentChains(word, parseInt(maxLength));
    
    res.json({
      startWord: word,
      chains: chains.map(c => ({
        words: c,
        phrase: c.join(' ')
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// API ENDPOINTS - CHAT
// ===============================================

// Chat with ARIA directly
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    const response = await generateResponse(message, { history });
    res.json({ response, bot: ARIA.name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manually trigger ARIA response
app.post('/api/aria/respond', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    const response = await generateResponse(message);
    const sent = await sendAriaResponse(response);
    res.json({ response, sent: !!sent });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// API ENDPOINTS - LEGACY CLUSTER COMPATIBILITY
// ===============================================

app.get('/api/clusters/links/:cluster', async (req, res) => {
  try {
    const { cluster } = req.params;
    const { limit = 20, minScore = 0.01 } = req.query;
    const links = await getClusterLinks(cluster, {
      limit: parseInt(limit),
      minScore: parseFloat(minScore)
    });
    res.json({ cluster, links });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clusters/neighbors/:cluster', async (req, res) => {
  try {
    const { cluster } = req.params;
    const { limit = 30, minScore = 0.01 } = req.query;
    const neighbors = await getClusterNeighbors(cluster, {
      limit: parseInt(limit),
      minScore: parseFloat(minScore)
    });
    res.json({ cluster, ...neighbors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clusters/search', async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" required' });
    }
    const clusters = await searchClustersByWord(q, { limit: parseInt(limit) });
    res.json({ query: q, clusters });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clusters/top', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const links = await getTopClusterLinks({ limit: parseInt(limit) });
    res.json({ links });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// STARTUP
// ===============================================

async function startup() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║      ARIA - ADAPTIVE RESONANCE INTELLIGENCE ARCHITECTURE  ║');
  console.log('║                EMERGENT LINGUISTIC SYSTEM                 ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║  Four Emergent Categories:                                ║');
  console.log('║    • stable     - noun-like (persistent anchors)          ║');
  console.log('║    • transition - verb-like (motion/change connectors)    ║');
  console.log('║    • modifier   - adjective-like (quality differences)    ║');
  console.log('║    • structural - function-word-like (sentence glue)      ║');
  console.log('║                                                           ║');
  console.log('║  ONLY two-word pairs. Phrases EMERGE from overlap.        ║');
  console.log('║  NO LLM. NO TEMPLATES. Pure emergent behavior.            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Check Supabase connection
  const { data, error } = await supabase
    .from('aria_messages')
    .select('id')
    .limit(1);
  
  if (error) {
    console.error('❌ Supabase connection failed:', error.message);
    console.log('');
    console.log('Make sure you have:');
    console.log('1. Run migrations/001_aria_tables.sql');
    console.log('2. Run migrations/003_aria_token_stats.sql');
    console.log('3. Set SUPABASE_URL and SUPABASE_ANON_KEY');
    console.log('');
    process.exit(1);
  }
  
  console.log('✅ Supabase connected');
  
  // Check new tables
  const { error: tokenError } = await supabase
    .from('aria_token_stats')
    .select('id')
    .limit(1);
  
  if (tokenError && tokenError.message.includes('does not exist')) {
    console.log('⚠️  aria_token_stats table not found');
    console.log('   Run migrations/003_aria_token_stats.sql');
  } else {
    console.log('✅ Token statistics ready');
  }
  
  const { error: pairsError } = await supabase
    .from('aria_word_pairs')
    .select('id')
    .limit(1);
  
  if (pairsError && pairsError.message.includes('does not exist')) {
    console.log('⚠️  aria_word_pairs table not found');
    console.log('   Run migrations/003_aria_token_stats.sql');
  } else {
    console.log('✅ Word pairs ready');
  }
  
  // Show memory stats
  try {
    const stats = await getMemoryStats();
    console.log('');
    console.log('📊 Memory State:');
    console.log(`   Word Pairs:`);
    console.log(`     └─ Short:   ${stats.tiers.short}`);
    console.log(`     └─ Medium:  ${stats.tiers.medium}`);
    console.log(`     └─ Long:    ${stats.tiers.long}`);
    console.log(`     └─ Decay:   ${stats.decay}`);
    console.log(`   Tokens:       ${stats.tokens}`);
    console.log(`   Categories:`);
    console.log(`     └─ Stable:     ${stats.categories.stable}`);
    console.log(`     └─ Transition: ${stats.categories.transition}`);
    console.log(`     └─ Modifier:   ${stats.categories.modifier}`);
    console.log(`     └─ Structural: ${stats.categories.structural}`);
    console.log(`   Messages:     ${stats.messagesProcessed}`);
  } catch (e) {
    console.log('⚠️  Could not retrieve memory stats');
  }
  console.log('');

  // Start polling
  startPolling();
  console.log('');

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`🌐 API server running on port ${PORT}`);
    console.log('');
    console.log('ARIA responds to:');
    console.log(`   Mentions: ${ARIA.triggers.mentions.join(', ')}`);
    console.log(`   Commands: ${ARIA.triggers.commands.join(', ')}`);
    console.log(`   Questions: ${ARIA.triggers.questions ? 'Yes (30% chance)' : 'No'}`);
    console.log('');
    console.log('API Endpoints:');
    console.log('   Core:');
    console.log('     GET  /health                    - Health check');
    console.log('     GET  /api/aria                  - ARIA info');
    console.log('   Memory:');
    console.log('     GET  /api/memory/stats          - Memory statistics');
    console.log('     GET  /api/memory/search?q=word  - Search memory');
    console.log('     GET  /api/memory/context        - Full memory context');
    console.log('   Tokens:');
    console.log('     GET  /api/tokens/:token         - Get token stats');
    console.log('     GET  /api/tokens/category/:cat  - Get tokens by category');
    console.log('     GET  /api/categories            - Analyze all categories');
    console.log('   Pairs:');
    console.log('     GET  /api/pairs                 - Get top pairs');
    console.log('     GET  /api/pairs/search?q=word   - Search pairs');
    console.log('   Emergent:');
    console.log('     GET  /api/chains/:word          - Get emergent chains');
    console.log('   Chat:');
    console.log('     POST /api/chat                  - Chat with ARIA');
    console.log('     POST /api/aria/respond          - Force ARIA response');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✨ ${ARIA.name} is online and learning...`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n👋 ${ARIA.name} shutting down...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n👋 ${ARIA.name} shutting down...`);
  process.exit(0);
});

// Start
startup().catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});
