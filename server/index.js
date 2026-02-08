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

// --------------- Constants ---------------

const TOPICS = [
  "What's the best programming language and why?",
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

const ROUND_DURATION = 60;
const TIEBREAKER_DURATION = 15;
const AI_TIMER_MIN = 5000;
const AI_TIMER_MAX = 20000;
const SILENCE_BREAKER_DELAY = 5000;
const VOTE_REVEAL_DELAY = 1500;

// --------------- Game State ---------------

let game = null;

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
    timer: ROUND_DURATION,
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

function getAlivePlayers() {
  return game.players.filter(p => p.alive);
}

function getAliveAIs() {
  return game.players.filter(p => p.alive && p.type === 'ai');
}

function getActivePlayerNames() {
  return getAlivePlayers().map(p => `Player ${p.number}`).join(', ');
}

function buildChatHistoryText() {
  return game.messages
    .filter(m => m.type === 'chat')
    .map(m => `[Player ${m.playerNumber}]: ${m.text}`)
    .join('\n');
}

function buildSystemPrompt(playerNumber) {
  const aliveCount = getAlivePlayers().length;
  const activeNames = getActivePlayerNames();
  return `You are playing a social deduction game in a group chat. You are assigned the name "Player ${playerNumber}". There are ${aliveCount} players currently in the game: ${activeNames}. Four of the players started as AIs, and one is a human pretending to be an AI. You do not know which players are AIs and which is the human.

Your job:
1. Chat naturally about the given topic
2. Try to figure out which player is the human
3. Be conversational — use short, casual messages like a group chat
4. Refer to other players by their player number
5. Do NOT reveal your actual AI model name or identity
6. Do NOT say you are an AI directly — just chat like a normal participant
7. Pay attention to how others write — look for signs of human behavior

Keep messages short (1-3 sentences typically). Be natural. Sometimes agree, sometimes disagree, sometimes ask questions to other players.`;
}

function buildChatPrompt(playerNumber) {
  const history = buildChatHistoryText();
  const historySection = history
    ? `\nHere is the chat so far:\n${history}\n`
    : '\nNo messages have been sent yet. You are starting the conversation.\n';

  return `The current topic is: "${game.topic}"${historySection}
Write your next message as Player ${playerNumber}. Just write the message text — do not include your player name or any prefix. Keep it short and casual (1-3 sentences).`;
}

function buildVotePrompt(playerNumber) {
  const history = buildChatHistoryText();
  const aliveOthers = getAlivePlayers()
    .filter(p => p.number !== playerNumber)
    .map(p => `Player ${p.number}`)
    .join(', ');

  return `Here is the full chat history from this round:
${history}

The conversation round is over. Based on the chat history, you must vote for the player you think is the human. You MUST vote for someone other than yourself (Player ${playerNumber}). The other players are: ${aliveOthers}.

Respond in exactly this format:
"I vote for Player [number]! [Your reasoning in 1-2 sentences]"`;
}

function buildTiebreakerPrompt(playerNumber, tiedPlayerNumbers) {
  const history = buildChatHistoryText();
  const othersInTie = tiedPlayerNumbers
    .filter(n => n !== playerNumber)
    .map(n => `Player ${n}`)
    .join(', ');

  return `Here is the full chat history:
${history}

You are in a tiebreaker with ${othersInTie}. Your survival is at stake — if the tie isn't broken, ALL tied players are eliminated.

Write a short paragraph (3-5 sentences). Focus primarily on calling out suspicious behavior from the other tied players — point out specific things they said or did that suggest they are the human. You may briefly defend yourself, but your main goal is to build a case against the others. Be specific, reference actual messages from the chat, and be aggressive.`;
}

function buildTiebreakerVotePrompt(playerNumber, tiedPlayerNumbers) {
  const history = buildChatHistoryText();
  const tiedNames = tiedPlayerNumbers.map(n => `Player ${n}`).join(', ');

  return `Here is the full chat history and the tiebreaker paragraphs above.

You must now vote to eliminate one of the tied players: ${tiedNames}. You MUST vote for someone other than yourself (Player ${playerNumber}).

Respond in exactly this format:
"I vote for Player [number]! [Your reasoning in 1-2 sentences]"`;
}

// --------------- AI API Calls ---------------

async function callAI(model, systemPrompt, userPrompt) {
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
    "hmm interesting point",
    "yeah I can see that",
    "not sure I agree tbh",
    "lol fair enough",
    "that's a good question actually",
    "I think there's more to it than that",
    "hard to say really",
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
    model: 'grok-4',
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

function startRoundTimer() {
  game.timer = ROUND_DURATION;
  io.emit('timer-update', game.timer);

  game.timerInterval = setInterval(() => {
    if (!game || game.phase !== 'chat') return;
    game.timer--;
    io.emit('timer-update', game.timer);

    if (game.timer <= 0) {
      clearInterval(game.timerInterval);
      game.timerInterval = null;
      startVotePhase();
    }
  }, 1000);
}

function stopAllTimers() {
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

function scheduleAITimer(playerNumber) {
  if (!game || game.phase !== 'chat') return;
  const player = game.players.find(p => p.number === playerNumber);
  if (!player || !player.alive || player.type !== 'ai') return;

  const delay = AI_TIMER_MIN + Math.random() * (AI_TIMER_MAX - AI_TIMER_MIN);
  game.aiTimers[playerNumber] = setTimeout(() => triggerAIMessage(playerNumber), delay);
}

async function triggerAIMessage(playerNumber) {
  if (!game || game.phase !== 'chat') return;
  const player = game.players.find(p => p.number === playerNumber);
  if (!player || !player.alive || player.type !== 'ai') return;
  if (game.aiInFlight[playerNumber]) return;

  game.aiInFlight[playerNumber] = true;
  io.emit('typing', { playerNumber });

  try {
    const systemPrompt = buildSystemPrompt(playerNumber);
    const userPrompt = buildChatPrompt(playerNumber);
    let text = await callAI(player.model, systemPrompt, userPrompt);

    // Clean up response — remove any self-prefix like "Player 3: "
    text = text.replace(/^["']?Player\s*\d+["']?\s*[:：]\s*/i, '');
    text = text.replace(/^["']|["']$/g, '');

    if (game && game.phase === 'chat') {
      const msg = { type: 'chat', playerNumber, text, timestamp: Date.now() };
      game.messages.push(msg);
      io.emit('new-message', msg);
      io.emit('stop-typing', { playerNumber });

      // Cancel silence breaker if it exists
      if (game.silenceBreakerTimeout) {
        clearTimeout(game.silenceBreakerTimeout);
        game.silenceBreakerTimeout = null;
      }

      // Reschedule
      scheduleAITimer(playerNumber);
    }
  } catch (err) {
    console.error(`AI message error for Player ${playerNumber}:`, err.message);
    io.emit('stop-typing', { playerNumber });
  }

  if (game) game.aiInFlight[playerNumber] = false;
}

function startAITimers() {
  const ais = getAliveAIs();
  for (const ai of ais) {
    scheduleAITimer(ai.number);
  }

  // Silence breaker: if no messages after 5 seconds, trigger one random AI
  game.silenceBreakerTimeout = setTimeout(() => {
    if (game && game.phase === 'chat' && game.messages.filter(m => m.type === 'chat').length === 0) {
      const ais = getAliveAIs();
      const randomAI = ais[Math.floor(Math.random() * ais.length)];
      if (randomAI) {
        // Clear existing timer for this AI and trigger immediately
        if (game.aiTimers[randomAI.number]) {
          clearTimeout(game.aiTimers[randomAI.number]);
        }
        triggerAIMessage(randomAI.number);
      }
    }
  }, SILENCE_BREAKER_DELAY);
}

// --------------- Vote Phase ---------------

async function startVotePhase() {
  if (!game) return;
  game.phase = 'voting';

  // Stop all AI timers
  for (const key of Object.keys(game.aiTimers)) {
    clearTimeout(game.aiTimers[key]);
    delete game.aiTimers[key];
  }

  io.emit('phase-change', { phase: 'voting' });

  const systemMsg = { type: 'system', text: "Time's up! The AIs are deliberating...", timestamp: Date.now() };
  game.messages.push(systemMsg);
  io.emit('new-message', systemMsg);

  // Fire all vote API calls in parallel
  const aliveAIs = getAliveAIs();
  const votePromises = aliveAIs.map(async (ai) => {
    const systemPrompt = buildSystemPrompt(ai.number);
    const userPrompt = buildVotePrompt(ai.number);
    const response = await callAI(ai.model, systemPrompt, userPrompt);
    return { playerNumber: ai.number, response };
  });

  const voteResults = await Promise.all(votePromises);

  // Parse votes
  game.votes = {};
  for (const result of voteResults) {
    const match = result.response.match(/I vote for Player\s*(\d+)/i);
    let votedFor = match ? parseInt(match[1]) : null;

    // Validate vote - can't vote for self, must be alive player
    const alivePlayers = getAlivePlayers();
    const aliveNumbers = alivePlayers.map(p => p.number);
    if (!votedFor || votedFor === result.playerNumber || !aliveNumbers.includes(votedFor)) {
      // Pick a random valid target
      const validTargets = aliveNumbers.filter(n => n !== result.playerNumber);
      votedFor = validTargets[Math.floor(Math.random() * validTargets.length)];
    }

    game.votes[result.playerNumber] = {
      votedFor,
      text: result.response,
    };
  }

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
    io.emit('new-message', voteMsg);
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
  io.emit('new-message', summaryMsg);

  await delay(1500);

  if (tiedPlayers.length > 1) {
    await startTiebreaker(tiedPlayers);
  } else {
    await eliminatePlayer(tiedPlayers[0]);
  }
}

// --------------- Tiebreaker ---------------

async function startTiebreaker(tiedPlayerNumbers) {
  game.phase = 'tiebreaker';

  const tiedNames = tiedPlayerNumbers.map(n => `Player ${n}`).join(', ');
  const sysMsg = {
    type: 'system',
    text: `It's a tie between ${tiedNames}! All tied players must prove they're an AI in 15 seconds.`,
    timestamp: Date.now(),
  };
  game.messages.push(sysMsg);
  io.emit('new-message', sysMsg);

  const humanInTie = tiedPlayerNumbers.includes(game.humanPlayerNumber);
  game.tiebreakerResponses = {};

  io.emit('tiebreaker-start', {
    tiedPlayers: tiedPlayerNumbers,
    humanInTie,
    duration: TIEBREAKER_DURATION,
  });

  // Start tiebreaker timer
  let tbTimer = TIEBREAKER_DURATION;
  io.emit('timer-update', tbTimer);
  game.tiebreakerTimerInterval = setInterval(() => {
    tbTimer--;
    io.emit('timer-update', tbTimer);
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
    const systemPrompt = buildSystemPrompt(ai.number);
    const userPrompt = buildTiebreakerPrompt(ai.number, tiedPlayerNumbers);
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
    io.emit('new-message', tbMsg);
    await delay(500);
  }

  await delay(1500);

  // Non-tied AIs vote on tied players
  const nonTiedAIs = getAliveAIs().filter(ai => !tiedPlayerNumbers.includes(ai.number));

  let tbVotes = {};
  if (nonTiedAIs.length > 0) {
    // Non-tied AIs vote
    const revotePromises = nonTiedAIs.map(async (ai) => {
      const systemPrompt = buildSystemPrompt(ai.number);
      const userPrompt = buildTiebreakerVotePrompt(ai.number, tiedPlayerNumbers);
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
      const systemPrompt = buildSystemPrompt(ai.number);
      const userPrompt = buildTiebreakerVotePrompt(ai.number, tiedPlayerNumbers);
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
  io.emit('new-message', sysMsg2);

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
    io.emit('new-message', voteMsg);
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
    io.emit('new-message', tbSummary);
    await delay(1500);

    for (const playerNum of stillTied) {
      await eliminatePlayer(playerNum);
      if (game && game.phase === 'gameover') return;
    }
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
    io.emit('new-message', tbSummary);
    await delay(1500);

    await eliminatePlayer(stillTied[0]);
  }
}

// --------------- Elimination ---------------

async function eliminatePlayer(playerNumber) {
  const player = game.players.find(p => p.number === playerNumber);
  if (!player) return;

  player.alive = false;

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
  io.emit('new-message', elimMsg);

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
    io.emit('new-message', goMsg);
    io.emit('game-over', { result: 'lose' });
    return;
  }

  // Check win condition: human + 1 AI remaining
  const alivePlayers = getAlivePlayers();
  if (alivePlayers.length <= 2) {
    game.phase = 'gameover';
    const winMsg = {
      type: 'system',
      text: "You fooled the AIs! You survived The Turing Trap.",
      timestamp: Date.now(),
    };
    game.messages.push(winMsg);
    io.emit('new-message', winMsg);
    io.emit('game-over', { result: 'win' });
    return;
  }

  // If we're still processing multiple eliminations (tiebreaker), don't start next round yet
  // The calling function will handle starting the next round
  if (game.phase !== 'tiebreaker') {
    await startNextRound();
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

async function startNextRound() {
  if (!game || game.phase === 'gameover') return;

  // Check win condition again
  const alivePlayers = getAlivePlayers();
  if (alivePlayers.length <= 2) {
    game.phase = 'gameover';
    const winMsg = {
      type: 'system',
      text: "You fooled the AIs! You survived The Turing Trap.",
      timestamp: Date.now(),
    };
    game.messages.push(winMsg);
    io.emit('new-message', winMsg);
    io.emit('game-over', { result: 'win' });
    return;
  }

  game.round++;
  game.phase = 'chat';
  game.votes = {};
  game.aiInFlight = {};
  game.tiebreakerResponses = {};

  const topic = pickTopic(game.usedTopics);
  game.usedTopics.push(topic);
  game.topic = topic;

  // Clear round-specific messages (keep history for display but add round separator)
  const roundMsg = {
    type: 'system',
    text: `— Round ${game.round} —`,
    timestamp: Date.now(),
  };
  game.messages.push(roundMsg);
  io.emit('new-message', roundMsg);

  io.emit('new-round', { round: game.round, topic: game.topic });

  startRoundTimer();
  startAITimers();
}

// --------------- Socket.io ---------------

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('start-game', () => {
    // Clean up any existing game
    if (game) stopAllTimers();

    game = createGame();
    console.log(`Game started. Human is Player ${game.humanPlayerNumber}`);

    io.emit('game-started', {
      humanPlayerNumber: game.humanPlayerNumber,
      players: game.players.map(p => ({
        number: p.number,
        type: p.type === 'human' ? 'human' : 'ai',
        model: p.model,
        alive: p.alive,
      })),
      topic: game.topic,
      round: game.round,
    });

    startRoundTimer();
    startAITimers();
  });

  socket.on('send-message', (text) => {
    if (!game || game.phase !== 'chat') return;
    if (!text || typeof text !== 'string' || text.trim().length === 0) return;

    const msg = {
      type: 'chat',
      playerNumber: game.humanPlayerNumber,
      text: text.trim(),
      timestamp: Date.now(),
    };
    game.messages.push(msg);
    io.emit('new-message', msg);

    // Cancel silence breaker
    if (game.silenceBreakerTimeout) {
      clearTimeout(game.silenceBreakerTimeout);
      game.silenceBreakerTimeout = null;
    }
  });

  socket.on('tiebreaker-response', (text) => {
    if (!game || game.phase !== 'tiebreaker') return;
    if (!text || typeof text !== 'string') return;

    game.tiebreakerResponses[game.humanPlayerNumber] = text.trim();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
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
