// server.js
// Main entry point - runs ARIA correlator + bot
// Correlator processes HUMAN messages only
// ARIA responds in chat but her messages are NOT processed for memory

import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { processMessage, getMemoryStats, getMemoryContext, searchByWord } from './ariaCorrelator.js';
import { generateResponse, queryMemory, buildMemoryContext } from './ariaGenerator.js';

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
  emoji: '✨',
  color: '#06b6d4',  // Cyan
  
  // Trigger patterns - when should ARIA respond?
  triggers: {
    mentions: ['@aria', 'aria,', 'hey aria', 'aria?', 'yo aria'],
    commands: ['/aria', '/a'],
    questions: true,  // Respond to all questions?
  },
  
  // Response settings
  responseDelay: 50,  // ms delay before responding
  maxResponseLength: 200,
};

// Track recent messages to avoid double-responses
const recentlyProcessed = new Set();

// ===============================================
// CHECK IF ARIA SHOULD RESPOND
// ===============================================
function shouldAriaRespond(message, userEmail) {
  const content = message.toLowerCase().trim();
  
  // Never respond to own messages
  if (userEmail === null || userEmail === ARIA.id) return false;
  
  // Check for direct mentions
  for (const mention of ARIA.triggers.mentions) {
    if (content.includes(mention.toLowerCase())) {
      return { respond: true, reason: 'mention' };
    }
  }
  
  // Check for commands
  for (const cmd of ARIA.triggers.commands) {
    if (content.startsWith(cmd.toLowerCase())) {
      return { respond: true, reason: 'command' };
    }
  }
  
  // Optionally respond to questions
  if (ARIA.triggers.questions && content.includes('?')) {
    // Only respond to questions ~30% of the time unless directly mentioned
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
  
  // Remove trigger words
  for (const mention of ARIA.triggers.mentions) {
    cleaned = cleaned.replace(new RegExp(mention, 'gi'), '').trim();
  }
  
  // Remove commands
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
      user_id: null,          // No user - it's a bot
      user_email: null,       // No email
      bot_id: ARIA.id,        // Identifies as ARIA
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
  
  // Prevent double-processing
  if (recentlyProcessed.has(messageId)) return;
  recentlyProcessed.add(messageId);
  
  // Clean up old processed IDs (keep last 100)
  if (recentlyProcessed.size > 100) {
    const arr = Array.from(recentlyProcessed);
    arr.slice(0, 50).forEach(id => recentlyProcessed.delete(id));
  }
  
  // IGNORE BOT MESSAGES - Never process for memory, never respond to
  if (message.bot_id) {
    console.log(`⏭️  Ignoring bot message from: ${message.bot_id}`);
    return;
  }
  
  const userEmail = message.user_email;
  const content = message.content;
  
  console.log(`\n📨 New message from ${userEmail}: "${content.substring(0, 50)}..."`);
  
  // ===== STEP 1: Process for memory (always, for human messages) =====
  try {
    const memoryResult = await processMessage(content, messageId, message.user_id);
    if (memoryResult.processed) {
      console.log(`   📊 Memory: ${memoryResult.newCorrelations} new, ${memoryResult.reinforced} reinforced`);
    }
  } catch (error) {
    console.error('   ❌ Memory processing error:', error.message);
  }
  
  // ===== STEP 2: Check if ARIA should respond =====
  const shouldRespond = shouldAriaRespond(content, userEmail);
  
  if (!shouldRespond.respond) {
    console.log(`   💤 ARIA not triggered`);
    return;
  }
  
  console.log(`   🎯 ARIA triggered by: ${shouldRespond.reason}`);
  
  // ===== STEP 3: Generate and send ARIA's response =====
  try {
    // Clean the message (remove @aria, /aria, etc)
    const cleanedMessage = cleanMessageForAria(content);
    
    // Add small delay for natural feel
    await new Promise(resolve => setTimeout(resolve, ARIA.responseDelay));
    
    // Generate response with memory context
    const response = await generateResponse(cleanedMessage, {
      maxLength: ARIA.maxResponseLength
    });
    
    // Send to chat
    await sendAriaResponse(response, messageId);
    
  } catch (error) {
    console.error('   ❌ ARIA response error:', error.message);
    
    // Send error message to chat
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
    // Build query for new messages
    let query = supabase
      .from('aria_messages')
      .select('*')
      .is('bot_id', null)  // Only human messages
      .order('created_at', { ascending: true })
      .limit(10);
    
    // If we have a last processed time, only get newer messages
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
        // Skip if already processed
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
  
  // Initialize lastProcessedTime to now (don't process old messages)
  lastProcessedTime = new Date().toISOString();
  
  // Poll every 2 seconds
  setInterval(pollForMessages, 2000);
  
  console.log('✅ Polling active');
}

// ===============================================
// API ENDPOINTS
// ===============================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gari-aria', bot: ARIA.name });
});

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

// Get memory context (for debugging)
app.get('/api/memory/context', async (req, res) => {
  try {
    const { message } = req.query;
    const context = await buildMemoryContext(message || '');
    res.json({ context });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat with ARIA directly (API mode)
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

// Manually trigger ARIA response (for testing)
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

// Get ARIA's info
app.get('/api/aria', (req, res) => {
  res.json({
    id: ARIA.id,
    name: ARIA.name,
    emoji: ARIA.emoji,
    color: ARIA.color,
    triggers: ARIA.triggers
  });
});

// ===============================================
// STARTUP
// ===============================================

async function startup() {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     ARIA - ADAPTIVE RESONANCE INTELLIGENCE     ║');
  console.log('║         Pure Word Graph Response System        ║');
  console.log('╚════════════════════════════════════════════════╝');
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
    console.log('1. Run the migrations in Supabase SQL editor');
    console.log('2. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
    console.log('');
    process.exit(1);
  }
  
  console.log('✅ Supabase connected');
  
  // Check if bot_id column exists
  const { data: testBot, error: botError } = await supabase
    .from('aria_messages')
    .select('bot_id')
    .limit(1);
  
  if (botError && botError.message.includes('bot_id')) {
    console.log('⚠️  bot_id column not found - check migration');
  } else {
    console.log('✅ Bot integration ready');
  }
  
  // Show memory stats
  try {
    const stats = await getMemoryStats();
    console.log('');
    console.log('📊 Memory State:');
    console.log(`   Short-term:  ${stats.tiers.short} correlations`);
    console.log(`   Medium-term: ${stats.tiers.medium} correlations`);
    console.log(`   Long-term:   ${stats.tiers.long} correlations`);
    console.log(`   Phrases:     ${stats.phrases} phrases`);
    console.log(`   Messages:    ${stats.messagesProcessed} processed`);
  } catch (e) {
    console.log('⚠️  Memory tables not found - run migration 001_aria_tables.sql');
  }
  console.log('');

  // Start polling for messages
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
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✨ ${ARIA.name} is online and listening...`);
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
