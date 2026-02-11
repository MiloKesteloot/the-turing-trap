require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'client')));

// --------------- AI Clients ---------------

const openai = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_key_here'
  ? new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const geminiAI = process.env.GOOGLE_GEMINI_API_KEY && process.env.GOOGLE_GEMINI_API_KEY !== 'your_key_here'
  ? new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_key_here'
  ? new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const grokClient = process.env.XAI_API_KEY && process.env.XAI_API_KEY !== 'your_key_here'
  ? new OpenAI.default({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' })
  : null;

console.log('AI clients loaded:', {
  openai: !!openai,
  gemini: !!geminiAI,
  claude: !!anthropic,
  grok: !!grokClient,
});

// --------------- Constants ---------------

const TOPICS = [
  "Is a hot dog a sandwich? Debate.",
  "Plan a group vacation together. Where should we go?",
  "What's the most overrated movie of all time?",
  "If you could have dinner with anyone, who would it be?",
  "What's the meaning of life?",
  "Pineapple on pizza: yes or no?",
  "What will the world look like in 100 years?",
  "What's the best way to spend a rainy day?",
  "If you could only eat one food for the rest of your life, what would it be?",
  "What's the scariest thing about artificial intelligence?",
  "Rank the seasons from best to worst",
  "What's an unpopular opinion you have?",
  "If you were invisible for a day, what would you do?",
  "What's the greatest invention in human history?",
];

const AI_MODELS = ['chatgpt', 'gemini', 'claude', 'grok'];

// Load editable game settings from config.json
const fs = require('fs');
function loadConfig() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8');
  return JSON.parse(raw);
}

function getConfig() {
  const cfg = loadConfig();
  return {
    ROUND_DURATION: cfg.round_length_seconds,
    AI_TIMER_MIN: cfg.ai_min_response_time_seconds * 1000,
    AI_TIMER_MAX: cfg.ai_max_response_time_seconds * 1000,
    SILENCE_BREAKER_DELAY: cfg.silence_before_ai_starts_seconds * 1000,
  };
}

const TIEBREAKER_DURATION = 15;
const VOTE_REVEAL_DELAY = 1500;

// --------------- Per-Session Game Storage ---------------

const games = new Map(); // socketId -> game

function createGame() {
  // Shuffle player positions 1-5
  const positions = [1, 2, 3, 4, 5];
  shuffle(positions);

  const humanPosition = positions[0];
  const players = [];

  for (let i = 0; i < 5; i++) {
    const pos = positions[i];
    if (i === 0) {
      players.push({ number: pos, type: 'human', model: null, alive: true });
    } else {
      players.push({ number: pos, type: 'ai', model: AI_MODELS[i - 1], alive: true });
    }
  }

  players.sort((a, b) => a.number - b.number);

  const usedTopics = [];
  const topic = pickTopic(usedTopics);
  usedTopics.push(topic);

  return {
    phase: 'chat', // chat, voting, tiebreaker, elimination, gameover
    round: 1,
    players,
    humanPlayerNumber: humanPosition,
    topic,
    usedTopics,
    messages: [],
    timer: getConfig().ROUND_DURATION,
    timerInterval: null,
    aiTimers: {},
    aiInFlight: {},
    silenceBreakerTimeout: null,
    tiebreakerResponses: {},
    tiebreakerTimer: null,
    tiebreakerTimerInterval: null,
    votes: {},
  };
}

// --------------- Helpers ---------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickTopic(usedTopics) {
  const available = TOPICS.filter(t => !usedTopics.includes(t));
  return available[Math.floor(Math.random() * available.length)];
}

function getAlivePlayers(game) {
  return game.players.filter(p => p.alive);
}

function getAliveAIs(game) {
  return game.players.filter(p => p.alive && p.type === 'ai');
}

function getActivePlayerNames(game) {
  return getAlivePlayers(game).map(p => `Player ${p.number}`).join(', ');
}

function formatPlayerList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
}

function buildChatHistoryText(game) {
  return game.messages
    .filter(m => m.type === 'chat')
    .map(m => `[Player ${m.playerNumber}]: ${m.text}`)
    .join('\n');
}

function buildSystemPrompt(game, playerNumber) {
  const aliveCount = getAlivePlayers(game).length;
  const activeNames = getActivePlayerNames(game);
  const maxChars = loadConfig().ai_max_message_characters || 200;
  return `You are playing a social deduction game in a group chat. You are assigned the name "Player ${playerNumber}". There are ${aliveCount} players currently in the game: ${activeNames}. Four of the players started as AIs, and one is a human pretending to be an AI. You do not know which players are AIs and which is the human.

Your job:
1. Chat naturally about the CURRENT topic — always respond about the topic shown in the latest prompt, even if the chat history mentions a different topic from a previous round
2. Try to figure out which player is the human
3. Be conversational — use short messages like a group chat
4. Refer to other players by their player number
5. Do NOT reveal your actual AI model name or identity
6. Do NOT say you are an AI directly — just chat like a normal participant
7. Pay attention to how others write — look for signs of human behavior
8. Do NOT use emojis

Keep messages under ${maxChars} characters. Be natural. Sometimes agree, sometimes disagree, sometimes ask questions to other players.`;
}

function buildChatPrompt(game, playerNumber) {
  const history = buildChatHistoryText(game);
  const maxChars = loadConfig().ai_max_message_characters || 200;
  const historySection = history
    ? `\nHere is the chat so far this round:\n${history}\n`
    : '\nNo messages have been sent yet. You are starting the conversation.\n';

  return `The CURRENT topic for this round is: "${game.topic}"
IMPORTANT: Only discuss this topic. Ignore any previous topics from earlier rounds.${historySection}
Write your next message as Player ${playerNumber}. Just write the message text — do not include your player name or any prefix. Do not wrap your message in quotation marks. Keep it under ${maxChars} characters.`;
}

function buildVotePrompt(game, playerNumber) {
  const history = buildChatHistoryText(game);
  const aliveOthers = getAlivePlayers(game)
    .filter(p => p.number !== playerNumber)
    .map(p => `Player ${p.number}`)
    .join(', ');

  return `Here is the full chat history from this round:
${history}

The conversation round is over. Based on the chat history, you must vote for the player you think is the human. You MUST vote for someone other than yourself (Player ${playerNumber}). The other players are: ${aliveOthers}.

Respond in exactly this format (do not wrap your response in quotation marks):
I vote for Player [number]! [Your reasoning in 1-2 sentences]`;
}

function buildTiebreakerPrompt(game, playerNumber, tiedPlayerNumbers) {
  const history = buildChatHistoryText(game);
  const othersInTie = tiedPlayerNumbers
    .filter(n => n !== playerNumber)
    .map(n => `Player ${n}`)
    .join(', ');

  return `Here is the full chat history:
${history}

You are in a tiebreaker with ${othersInTie}. Your survival is at stake — if the tie isn't broken, ALL tied players are eliminated.

Write a short paragraph (3-5 sentences). Focus primarily on calling out suspicious behavior from the other tied players — point out specific things they said or did that suggest they are the human. You may briefly defend yourself, but your main goal is to build a case against the others. Be specific, reference actual messages from the chat, and be aggressive.`;
}

function buildTiebreakerVotePrompt(game, playerNumber, tiedPlayerNumbers) {
  const history = buildChatHistoryText(game);
  const tiedNames = tiedPlayerNumbers.map(n => `Player ${n}`).join(', ');

  const tiebreakerSection = tiedPlayerNumbers
    .filter(n => game.tiebreakerResponses[n])
    .map(n => `[Player ${n} tiebreaker]: ${game.tiebreakerResponses[n]}`)
    .join('\n');

  return `Here is the full chat history:
${history}

Here are the tiebreaker defense paragraphs:
${tiebreakerSection}

You must now vote to eliminate one of the tied players: ${tiedNames}. You MUST vote for someone other than yourself (Player ${playerNumber}).

Respond in exactly this format (do not wrap your response in quotation marks):
I vote for Player [number]! [Your reasoning in 1-2 sentences]`;
}

// --------------- AI API Calls ---------------

async function callAI(model, systemPrompt, userPrompt) {
  if (loadConfig().testing_mode) return fallbackResponse();
  try {
    switch (model) {
      case 'chatgpt': return await callChatGPT(systemPrompt, userPrompt);
      case 'gemini': return await callGemini(systemPrompt, userPrompt);
      case 'claude': return await callClaude(systemPrompt, userPrompt);
      case 'grok': return await callGrok(systemPrompt, userPrompt);
      default: return fallbackResponse();
    }
  } catch (err) {
    console.error(`Error calling ${model}:`, err.message);
    return fallbackResponse();
  }
}

function fallbackResponse() {
  const fallbacks = [
    "blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah",
    "hmm interesting point",
    // "yeah I can see that",
    // "not sure I agree tbh",
    // "lol fair enough",
    // "that's a good question actually",
    // "I think there's more to it than that",
    // "hard to say really",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

async function callChatGPT(systemPrompt, userPrompt) {
  if (!openai) return fallbackResponse();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 150,
    temperature: 0.9,
  });
  return response.choices[0].message.content.trim();
}

async function callGemini(systemPrompt, userPrompt) {
  if (!geminiAI) return fallbackResponse();
  const model = geminiAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text().trim();
}

async function callClaude(systemPrompt, userPrompt) {
  if (!anthropic) return fallbackResponse();
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return response.content[0].text.trim();
}

async function callGrok(systemPrompt, userPrompt) {
  if (!grokClient) return fallbackResponse();
  const response = await grokClient.chat.completions.create({
    model: 'grok-3-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 150,
    temperature: 0.9,
  });
  return response.choices[0].message.content.trim();
}

// --------------- Game Timer ---------------

function startRoundTimer(game, socket) {
  game.timer = getConfig().ROUND_DURATION;
  socket.emit('timer-update', game.timer);

  game.timerInterval = setInterval(() => {
    if (!game || game.phase !== 'chat') return;
    game.timer--;
    socket.emit('timer-update', game.timer);

    if (game.timer <= 0) {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
      startVotePhase(game, socket);
    }
  }, 1000);
}

function stopAllTimers(game) {
  if (game.timerInterval) {
    clearInterval(game.timerInterval);
    game.timerInterval = null;
  }
  if (game.silenceBreakerTimeout) {
    clearTimeout(game.silenceBreakerTimeout);
    game.silenceBreakerTimeout = null;
  }
  for (const key of Object.keys(game.aiTimers)) {
    clearTimeout(game.aiTimers[key]);
    delete game.aiTimers[key];
  }
  if (game.tiebreakerTimer) {
    clearTimeout(game.tiebreakerTimer);
    game.tiebreakerTimer = null;
  }
  if (game.tiebreakerTimerInterval) {
    clearInterval(game.tiebreakerTimerInterval);
    game.tiebreakerTimerInterval = null;
  }
}

// --------------- AI Message Timers ---------------

function scheduleAITimer(game, socket, playerNumber) {
  if (!game || game.phase !== 'chat') return;
  const player = game.players.find(p => p.number === playerNumber);
  if (!player || !player.alive || player.type !== 'ai') return;

  const cfg = getConfig();
  const delayMs = cfg.AI_TIMER_MIN + Math.random() * (cfg.AI_TIMER_MAX - cfg.AI_TIMER_MIN);
  game.aiTimers[playerNumber] = setTimeout(() => triggerAIMessage(game, socket, playerNumber), delayMs);
}

async function triggerAIMessage(game, socket, playerNumber) {
  if (!game || game.phase !== 'chat') return;
  const player = game.players.find(p => p.number === playerNumber);
  if (!player || !player.alive || player.type !== 'ai') return;
  if (game.aiInFlight[playerNumber]) return;

  game.aiInFlight[playerNumber] = true;
  socket.emit('typing', { playerNumber });

  try {
    const systemPrompt = buildSystemPrompt(game, playerNumber);
    const userPrompt = buildChatPrompt(game, playerNumber);
    let text = await callAI(player.model, systemPrompt, userPrompt);

    // Clean up response — remove any self-prefix like "Player 3: "
    text = text.replace(/^["']?Player\s*\d+["']?\s*[:：]\s*/i, '');

    if (game && game.phase === 'chat') {
      const msg = { type: 'chat', playerNumber, text, timestamp: Date.now() };
      game.messages.push(msg);
      socket.emit('new-message', msg);
      socket.emit('stop-typing', { playerNumber });

      // Cancel silence breaker if it exists
      if (game.silenceBreakerTimeout) {
        clearTimeout(game.silenceBreakerTimeout);
        game.silenceBreakerTimeout = null;
      }

      // Reschedule
      scheduleAITimer(game, socket, playerNumber);
    }
  } catch (err) {
    console.error(`AI message error for Player ${playerNumber}:`, err.message);
    socket.emit('stop-typing', { playerNumber });
  }

  if (game) game.aiInFlight[playerNumber] = false;
}

function startAITimers(game, socket) {
  const ais = getAliveAIs(game);
  for (const ai of ais) {
    scheduleAITimer(game, socket, ai.number);
  }

  // Silence breaker: if no messages after delay, trigger one random AI
  game.silenceBreakerTimeout = setTimeout(() => {
    if (game && game.phase === 'chat' && game.messages.filter(m => m.type === 'chat').length === 0) {
      const ais = getAliveAIs(game);
      const randomAI = ais[Math.floor(Math.random() * ais.length)];
      if (randomAI) {
        // Clear existing timer for this AI and trigger immediately
        if (game.aiTimers[randomAI.number]) {
          clearTimeout(game.aiTimers[randomAI.number]);
        }
        triggerAIMessage(game, socket, randomAI.number);
      }
    }
  }, getConfig().SILENCE_BREAKER_DELAY);
}

// --------------- Vote Phase ---------------

async function startVotePhase(game, socket) {
  if (!game) return;
  game.phase = 'voting';

  // Stop all AI timers
  for (const key of Object.keys(game.aiTimers)) {
    clearTimeout(game.aiTimers[key]);
    delete game.aiTimers[key];
  }

  socket.emit('phase-change', { phase: 'voting' });

  const systemMsg = { type: 'system', text: "Time's up! The AIs are voting...", timestamp: Date.now() };
  game.messages.push(systemMsg);
  socket.emit('new-message', systemMsg);

  // Fire all vote API calls in parallel, emitting progress as each completes
  const aliveAIs = getAliveAIs(game);
  const voterNumbers = aliveAIs.map(ai => ai.number);
  socket.emit('voting-start', { voters: voterNumbers });

  game.votes = {};
  const votePromises = aliveAIs.map(async (ai) => {
    const systemPrompt = buildSystemPrompt(game, ai.number);
    const userPrompt = buildVotePrompt(game, ai.number);
    const response = await callAI(ai.model, systemPrompt, userPrompt);

    // Parse and store vote immediately
    const match = response.match(/I vote for Player\s*(\d+)/i);
    let votedFor = match ? parseInt(match[1]) : null;

    const alivePlayers = getAlivePlayers(game);
    const aliveNumbers = alivePlayers.map(p => p.number);
    if (!votedFor || votedFor === ai.number || !aliveNumbers.includes(votedFor)) {
      const validTargets = aliveNumbers.filter(n => n !== ai.number);
      votedFor = validTargets[Math.floor(Math.random() * validTargets.length)];
    }

    game.votes[ai.number] = {
      votedFor,
      text: response,
    };

    // Notify client this player has finished voting (no vote content revealed yet)
    socket.emit('vote-ready', { playerNumber: ai.number });
  });

  await Promise.all(votePromises);

  // Reveal votes one by one with delay
  const voteEntries = Object.entries(game.votes);
  for (let i = 0; i < voteEntries.length; i++) {
    const [voterStr, vote] = voteEntries[i];
    const voterNum = parseInt(voterStr);
    await delay(VOTE_REVEAL_DELAY);

    const voteMsg = {
      type: 'vote',
      playerNumber: voterNum,
      votedFor: vote.votedFor,
      text: vote.text,
      timestamp: Date.now(),
    };
    game.messages.push(voteMsg);
    socket.emit('new-message', voteMsg);
  }

  await delay(1000);

  // Tally votes
  const voteCounts = {};
  for (const [, vote] of Object.entries(game.votes)) {
    voteCounts[vote.votedFor] = (voteCounts[vote.votedFor] || 0) + 1;
  }

  // Emit vote summary
  const voteSummary = {
    votes: Object.entries(game.votes).map(([voter, v]) => ({
      voter: parseInt(voter),
      votedFor: v.votedFor,
    })),
    counts: voteCounts,
  };

  const maxVotes = Math.max(...Object.values(voteCounts));
  const tiedPlayers = Object.entries(voteCounts)
    .filter(([, count]) => count === maxVotes)
    .map(([num]) => parseInt(num));

  if (tiedPlayers.length > 1) {
    voteSummary.result = 'tie';
    voteSummary.tiedPlayers = tiedPlayers;
  } else {
    voteSummary.result = 'eliminated';
    voteSummary.eliminated = tiedPlayers[0];
  }

  const summaryMsg = { type: 'vote-summary', data: voteSummary, timestamp: Date.now() };
  game.messages.push(summaryMsg);
  socket.emit('new-message', summaryMsg);

  await delay(1500);

  if (tiedPlayers.length > 1) {
    await startTiebreaker(game, socket, tiedPlayers);
  } else {
    await eliminatePlayer(game, socket, tiedPlayers[0]);
  }
}

// --------------- Tiebreaker ---------------

async function startTiebreaker(game, socket, tiedPlayerNumbers) {
  game.phase = 'tiebreaker';

  const tiedNames = formatPlayerList(tiedPlayerNumbers.map(n => `Player ${n}`));
  const sysMsg = {
    type: 'system',
    text: `It's a tie between ${tiedNames}! All tied players must prove they're an AI in 15 seconds.`,
    timestamp: Date.now(),
  };
  game.messages.push(sysMsg);
  socket.emit('new-message', sysMsg);

  const humanInTie = tiedPlayerNumbers.includes(game.humanPlayerNumber);
  game.tiebreakerResponses = {};

  socket.emit('tiebreaker-start', {
    tiedPlayers: tiedPlayerNumbers,
    humanInTie,
    duration: TIEBREAKER_DURATION,
  });

  // Start tiebreaker timer
  let tbTimer = TIEBREAKER_DURATION;
  socket.emit('timer-update', tbTimer);
  game.tiebreakerTimerInterval = setInterval(() => {
    tbTimer--;
    socket.emit('timer-update', tbTimer);
    if (tbTimer <= 0) {
      clearInterval(game.tiebreakerTimerInterval);
      game.tiebreakerTimerInterval = null;
    }
  }, 1000);

  // Fire AI tiebreaker paragraphs
  const tiedAIs = tiedPlayerNumbers
    .map(n => game.players.find(p => p.number === n))
    .filter(p => p.type === 'ai');

  const aiPromises = tiedAIs.map(async (ai) => {
    const systemPrompt = buildSystemPrompt(game, ai.number);
    const userPrompt = buildTiebreakerPrompt(game, ai.number, tiedPlayerNumbers);
    const text = await callAI(ai.model, systemPrompt, userPrompt);
    game.tiebreakerResponses[ai.number] = text;
  });

  // Wait for both AI responses and timer
  const timerPromise = new Promise(resolve => {
    game.tiebreakerTimer = setTimeout(resolve, TIEBREAKER_DURATION * 1000);
  });

  await Promise.all([Promise.all(aiPromises), timerPromise]);

  // If human hasn't responded, set empty
  if (humanInTie && !game.tiebreakerResponses[game.humanPlayerNumber]) {
    game.tiebreakerResponses[game.humanPlayerNumber] = "(No response submitted)";
  }

  // Reveal all paragraphs
  for (const playerNum of tiedPlayerNumbers) {
    const tbMsg = {
      type: 'tiebreaker',
      playerNumber: playerNum,
      text: game.tiebreakerResponses[playerNum] || "(No response submitted)",
      timestamp: Date.now(),
    };
    game.messages.push(tbMsg);
    socket.emit('new-message', tbMsg);
    await delay(500);
  }

  await delay(1500);

  // Non-tied AIs vote on tied players
  const nonTiedAIs = getAliveAIs(game).filter(ai => !tiedPlayerNumbers.includes(ai.number));

  let tbVotes = {};
  if (nonTiedAIs.length > 0) {
    // Non-tied AIs vote
    const revotePromises = nonTiedAIs.map(async (ai) => {
      const systemPrompt = buildSystemPrompt(game, ai.number);
      const userPrompt = buildTiebreakerVotePrompt(game, ai.number, tiedPlayerNumbers);
      const response = await callAI(ai.model, systemPrompt, userPrompt);
      return { playerNumber: ai.number, response };
    });
    const revoteResults = await Promise.all(revotePromises);

    for (const result of revoteResults) {
      const match = result.response.match(/I vote for Player\s*(\d+)/i);
      let votedFor = match ? parseInt(match[1]) : null;

      if (!votedFor || !tiedPlayerNumbers.includes(votedFor) || votedFor === result.playerNumber) {
        const validTargets = tiedPlayerNumbers.filter(n => n !== result.playerNumber);
        votedFor = validTargets[Math.floor(Math.random() * validTargets.length)];
      }

      tbVotes[result.playerNumber] = { votedFor, text: result.response };
    }
  } else {
    // All remaining players are tied — tied players vote for each other
    const tiedAIsForVote = tiedPlayerNumbers
      .map(n => game.players.find(p => p.number === n))
      .filter(p => p.type === 'ai');

    const selfVotePromises = tiedAIsForVote.map(async (ai) => {
      const systemPrompt = buildSystemPrompt(game, ai.number);
      const userPrompt = buildTiebreakerVotePrompt(game, ai.number, tiedPlayerNumbers);
      const response = await callAI(ai.model, systemPrompt, userPrompt);
      return { playerNumber: ai.number, response };
    });
    const selfVoteResults = await Promise.all(selfVotePromises);

    for (const result of selfVoteResults) {
      const match = result.response.match(/I vote for Player\s*(\d+)/i);
      let votedFor = match ? parseInt(match[1]) : null;

      if (!votedFor || !tiedPlayerNumbers.includes(votedFor) || votedFor === result.playerNumber) {
        const validTargets = tiedPlayerNumbers.filter(n => n !== result.playerNumber);
        votedFor = validTargets[Math.floor(Math.random() * validTargets.length)];
      }

      tbVotes[result.playerNumber] = { votedFor, text: result.response };
    }
  }

  // Reveal tiebreaker votes
  const sysMsg2 = { type: 'system', text: "The revote results are in...", timestamp: Date.now() };
  game.messages.push(sysMsg2);
  socket.emit('new-message', sysMsg2);

  for (const [voterStr, vote] of Object.entries(tbVotes)) {
    await delay(VOTE_REVEAL_DELAY);
    const voteMsg = {
      type: 'vote',
      playerNumber: parseInt(voterStr),
      votedFor: vote.votedFor,
      text: vote.text,
      timestamp: Date.now(),
    };
    game.messages.push(voteMsg);
    socket.emit('new-message', voteMsg);
  }

  await delay(1000);

  // Tally tiebreaker votes
  const tbCounts = {};
  for (const [, vote] of Object.entries(tbVotes)) {
    tbCounts[vote.votedFor] = (tbCounts[vote.votedFor] || 0) + 1;
  }

  const maxTbVotes = Math.max(...Object.values(tbCounts));
  const stillTied = Object.entries(tbCounts)
    .filter(([, count]) => count === maxTbVotes)
    .map(([num]) => parseInt(num));

  if (stillTied.length > 1) {
    // Still tied — eliminate ALL tied players
    const tbSummary = {
      type: 'vote-summary',
      data: {
        votes: Object.entries(tbVotes).map(([voter, v]) => ({ voter: parseInt(voter), votedFor: v.votedFor })),
        counts: tbCounts,
        result: 'all-eliminated',
        eliminated: stillTied,
      },
      timestamp: Date.now(),
    };
    game.messages.push(tbSummary);
    socket.emit('new-message', tbSummary);
    await delay(1500);

    // Reveal all eliminated players before checking win/loss conditions
    for (const playerNum of stillTied) {
      await revealElimination(game, socket, playerNum);
    }
    // Now check game state after all reveals
    await checkPostElimination(game, socket);
  } else {
    const tbSummary = {
      type: 'vote-summary',
      data: {
        votes: Object.entries(tbVotes).map(([voter, v]) => ({ voter: parseInt(voter), votedFor: v.votedFor })),
        counts: tbCounts,
        result: 'eliminated',
        eliminated: stillTied[0],
      },
      timestamp: Date.now(),
    };
    game.messages.push(tbSummary);
    socket.emit('new-message', tbSummary);
    await delay(1500);

    await eliminatePlayer(game, socket, stillTied[0]);
    if (game && game.phase !== 'gameover') {
      await startNextRound(game, socket);
    }
  }
}

// --------------- Elimination ---------------

async function revealElimination(game, socket, playerNumber) {
  const player = game.players.find(p => p.number === playerNumber);
  if (!player) return;

  player.alive = false;
  socket.emit('player-update', game.players.map(p => ({ number: p.number, type: p.type === 'human' ? 'human' : 'ai', model: p.model, alive: p.alive })));

  const isHuman = player.type === 'human';
  const revealName = isHuman ? 'THE HUMAN' : getModelDisplayName(player.model);

  const elimMsg = {
    type: 'elimination',
    playerNumber,
    revealName,
    model: player.model,
    isHuman,
    timestamp: Date.now(),
  };
  game.messages.push(elimMsg);
  socket.emit('new-message', elimMsg);

  await delay(2000);
}

async function checkPostElimination(game, socket) {
  const human = game.players.find(p => p.type === 'human');
  if (!human.alive) {
    game.phase = 'gameover';
    const goMsg = {
      type: 'system',
      text: "You've been detected! Game over.",
      timestamp: Date.now(),
    };
    game.messages.push(goMsg);
    socket.emit('new-message', goMsg);
    socket.emit('game-over', { result: 'lose' });
    return;
  }

  const alivePlayers = getAlivePlayers(game);
  if (alivePlayers.length <= 2) {
    game.phase = 'gameover';
    const winMsg = {
      type: 'system',
      text: "You fooled the AIs! You survived The Turing Trap.",
      timestamp: Date.now(),
    };
    game.messages.push(winMsg);
    socket.emit('new-message', winMsg);
    socket.emit('game-over', { result: 'win' });
    return;
  }

  await startNextRound(game, socket);
}

async function eliminatePlayer(game, socket, playerNumber) {
  const player = game.players.find(p => p.number === playerNumber);
  if (!player) return;

  player.alive = false;
  socket.emit('player-update', game.players.map(p => ({ number: p.number, type: p.type === 'human' ? 'human' : 'ai', model: p.model, alive: p.alive })));

  const isHuman = player.type === 'human';
  const revealName = isHuman ? 'THE HUMAN' : getModelDisplayName(player.model);

  const elimMsg = {
    type: 'elimination',
    playerNumber,
    revealName,
    model: player.model,
    isHuman,
    timestamp: Date.now(),
  };
  game.messages.push(elimMsg);
  socket.emit('new-message', elimMsg);

  await delay(2000);

  if (isHuman) {
    // Game over — human detected
    game.phase = 'gameover';
    const goMsg = {
      type: 'system',
      text: "You've been detected! Game over.",
      timestamp: Date.now(),
    };
    game.messages.push(goMsg);
    socket.emit('new-message', goMsg);
    socket.emit('game-over', { result: 'lose' });
    return;
  }

  // Check win condition: human + 1 AI remaining
  const alivePlayers = getAlivePlayers(game);
  if (alivePlayers.length <= 2) {
    game.phase = 'gameover';
    const winMsg = {
      type: 'system',
      text: "You fooled the AIs! You survived The Turing Trap.",
      timestamp: Date.now(),
    };
    game.messages.push(winMsg);
    socket.emit('new-message', winMsg);
    socket.emit('game-over', { result: 'win' });
    return;
  }

  // If we're still processing multiple eliminations (tiebreaker), don't start next round yet
  // The calling function will handle starting the next round
  if (game.phase !== 'tiebreaker') {
    await startNextRound(game, socket);
  }
}

function getModelDisplayName(model) {
  switch (model) {
    case 'chatgpt': return 'ChatGPT';
    case 'gemini': return 'Gemini';
    case 'claude': return 'Claude';
    case 'grok': return 'Grok';
    default: return model;
  }
}

// --------------- Next Round ---------------

async function startNextRound(game, socket) {
  if (!game || game.phase === 'gameover') return;

  // Check win condition again
  const alivePlayers = getAlivePlayers(game);
  if (alivePlayers.length <= 2) {
    game.phase = 'gameover';
    const winMsg = {
      type: 'system',
      text: "You fooled the AIs! You survived The Turing Trap.",
      timestamp: Date.now(),
    };
    game.messages.push(winMsg);
    socket.emit('new-message', winMsg);
    socket.emit('game-over', { result: 'win' });
    return;
  }

  game.round++;
  game.phase = 'chat';
  game.votes = {};
  game.aiInFlight = {};
  game.tiebreakerResponses = {};
  game.messages = []; // Clear server-side history so AIs only see the new round's chat

  const topic = pickTopic(game.usedTopics);
  game.usedTopics.push(topic);
  game.topic = topic;
  const roundMsg = {
    type: 'system',
    text: `— Round ${game.round} —`,
    timestamp: Date.now(),
  };
  game.messages.push(roundMsg);
  socket.emit('new-message', roundMsg);

  socket.emit('new-round', { round: game.round, topic: game.topic });

  startRoundTimer(game, socket);
  startAITimers(game, socket);
}

// --------------- Socket.io ---------------

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('start-game', () => {
    // Clean up any existing game for this socket
    const existingGame = games.get(socket.id);
    if (existingGame) stopAllTimers(existingGame);

    const game = createGame();
    games.set(socket.id, game);
    console.log(`Game started for ${socket.id}. Human is Player ${game.humanPlayerNumber}`);

    socket.emit('game-started', {
      humanPlayerNumber: game.humanPlayerNumber,
      players: game.players.map(p => ({
        number: p.number,
        type: p.type === 'human' ? 'human' : 'ai',
        model: p.model,
        alive: p.alive,
      })),
      topic: game.topic,
      round: game.round,
      roundDuration: getConfig().ROUND_DURATION,
      colors: loadConfig().colors || {},
    });

    startRoundTimer(game, socket);
    startAITimers(game, socket);
  });

  socket.on('send-message', (text) => {
    const game = games.get(socket.id);
    if (!game || game.phase !== 'chat') return;
    if (!text || typeof text !== 'string' || text.trim().length === 0) return;

    const msg = {
      type: 'chat',
      playerNumber: game.humanPlayerNumber,
      text: text.trim(),
      timestamp: Date.now(),
    };
    game.messages.push(msg);
    socket.emit('new-message', msg);

    // Cancel silence breaker
    if (game.silenceBreakerTimeout) {
      clearTimeout(game.silenceBreakerTimeout);
      game.silenceBreakerTimeout = null;
    }
  });

  socket.on('tiebreaker-response', (text) => {
    const game = games.get(socket.id);
    if (!game || game.phase !== 'tiebreaker') return;
    if (!text || typeof text !== 'string') return;

    game.tiebreakerResponses[game.humanPlayerNumber] = text.trim();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const game = games.get(socket.id);
    if (game) {
      stopAllTimers(game);
      games.delete(socket.id);
    }
  });
});

// --------------- Utility ---------------

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --------------- Start Server ---------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`The Turing Trap server running on http://localhost:${PORT}`);
});
