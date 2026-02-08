# THE TURING TRAP — Game Spec

## Overview
"The Turing Trap" is a browser-based social deduction game where the player (a human) enters a chatroom with 4 AI chatbots (ChatGPT, Gemini, Claude, Grok). All participants are anonymized as "Player 1-5." The human must blend in and avoid being identified as the human. The AIs genuinely don't know who is human — they're trying to figure it out through conversation.

## Tech Stack
- **Frontend:** Single-page React app (single .jsx file, Tailwind for styling)
- **Backend:** Node.js Express server
- **AI APIs:** OpenAI (ChatGPT), Google Gemini, Anthropic Claude, xAI Grok — all called from the backend
- **No database.** All game state lives in memory on the server.

## Game Flow

### 1. Start Screen
- Game title "THE TURING TRAP" with tagline: "You're the only human. Don't get caught."
- A "Play" button
- Brief rules explanation (2-3 sentences max)

### 2. Game Setup (happens on Play)
- Server randomly assigns Player 1-5 to the 4 AIs + 1 human
- Server picks a random conversation topic from a predefined list
- The chat window opens
- A 60-second countdown timer starts at the top of the screen

### 3. Chat Phase (60 seconds per round)
**AI Behavior:**
- Each AI has an internal timer, randomly set to 5-20 seconds
- When the timer fires, the AI is sent the full chat history and asked to write a message about the current topic
- After sending, the timer resets to a new random 5-20 second value
- While the API request is in flight, the UI shows "[Player X] is typing..."
- If 5 seconds pass at the very start with no messages, one random AI is triggered to open the conversation

**Human Behavior:**
- The human can type and send messages at any time
- Standard chat input at the bottom of the screen

**UI Layout:**
- Top bar: round number, countdown timer (60s), current conversation topic (always visible, persists throughout the round, updates when a new round starts)
- Center: scrollable chat window
- AI messages are aligned LEFT (with avatar + "Player X" name to the left)
- Human player's messages are aligned RIGHT (iMessage/Instagram DM style)
- Each message has: avatar (AI logo or human silhouette), "Player X" name, message text
- Bottom: text input + send button
- The human player's messages use the same visual style/colors as AI messages aside from alignment, so they don't stand out when scrolling back

### 4. Vote Phase
- When the timer hits 0, the chat input is disabled
- A system message appears: "Time's up! The AIs are deliberating..."
- All AIs still in the game are sent the full chat history and asked to vote simultaneously
- Each AI must respond in the format: "I vote for Player X! [reasoning]"
- Votes appear one by one in the chat with a slight delay between each for dramatic effect (1-2 seconds apart)
- The human does NOT vote
- Votes are tallied. The player with the most votes is eliminated.

**Vote Summary UI Element:**
- After all votes are revealed, a special UI card/element is inserted into the chat showing:
  - A summary of all votes (who voted for whom)
  - Vote counts per player
  - The result: who is eliminated, or if there's a tie

**Tiebreaker (2 or more players tied):**
- If there's a tie involving any number of players (including the human), a tiebreaker occurs
- System message: "It's a tie between Player X, Player Y, [and Player Z...]! All tied players must prove they're an AI in 15 seconds."
- A 15-second timer starts
- The human types their paragraph manually (if they're in the tie)
- The tied AIs each generate their paragraph
- All paragraphs are shown simultaneously once the timer expires
- The remaining AIs (those NOT involved in the tie) vote again, choosing from only the tied players
- If there are not enough non-tied AIs to vote (e.g., all remaining players are tied), all tied players vote for someone other than themselves
- The player with the most votes in the tiebreaker is eliminated
- **If still tied after the tiebreaker, ALL tied players are eliminated**

### 5. Elimination Reveal
- System message: "Player X has been eliminated!" (or multiple players if a double tiebreaker)
- Brief pause (1-2 seconds)
- The player card is revealed: their Player number transitions to show the actual AI name + full logo (e.g., "Player 3 was... Gemini!")
- If the human is eliminated: dramatic reveal — "Player X was... THE HUMAN! You've been detected!" → Game Over state
- If an AI is eliminated: "Player X was... [AI name]!" → next round begins
- If multiple eliminations, reveal them one by one with pauses between

### 6. Next Round
- A new conversation topic is picked and displayed in the top bar (replacing the old topic)
- The timer resets to 60 seconds
- Eliminated players no longer send messages or appear active
- The remaining AIs have their timers reset

### 7. Win Condition
- The human wins if they survive to the final 2 (just them and one AI remaining)
- That means surviving 3 rounds of voting (5→4→3→2)
- Win message appears in chat: "You fooled the AIs! You survived The Turing Trap."
- Note: if a tiebreaker eliminates multiple AIs at once, the human could win earlier (e.g., 4 players → 2 if two AIs get eliminated together)

### 8. Game Over State (win or lose)
- The chat input box at the bottom is REPLACED with a "Play Again" button
- The full chat history remains scrollable, including:
  - All conversation messages
  - Vote summary UI cards showing who voted for whom
  - Elimination reveals
  - Tiebreaker paragraphs (if any)
- The top bar still shows the last round's topic
- This lets the player relive the whole game and review what happened

## AI System Prompt (for all bots)
Each AI gets this system prompt (with their player name swapped in):

```
You are playing a social deduction game in a group chat. You are assigned the name "[Player X]". There are [N] players currently in the game: [list of active player names]. Four of the players started as AIs, and one is a human pretending to be an AI. You do not know which players are AIs and which is the human.

Your job:
1. Chat naturally about the given topic
2. Try to figure out which player is the human
3. Be conversational — use short, casual messages like a group chat
4. Refer to other players by their player number
5. Do NOT reveal your actual AI model name or identity
6. Do NOT say you are an AI directly — just chat like a normal participant
7. Pay attention to how others write — look for signs of human behavior

Keep messages short (1-3 sentences typically). Be natural. Sometimes agree, sometimes disagree, sometimes ask questions to other players.
```

## AI Vote Prompt
```
The conversation round is over. Based on the chat history, you must vote for the player you think is the human. You MUST vote for someone other than yourself ([Player X]).

Respond in exactly this format:
"I vote for Player [number]! [Your reasoning in 1-2 sentences]"
```

## AI Tiebreaker Prompt
```
You are in a tiebreaker with [Player X, Player Y, ...]. Your survival is at stake — if the tie isn't broken, ALL tied players are eliminated.

Write a short paragraph (3-5 sentences). Focus primarily on calling out suspicious behavior from the other tied players — point out specific things they said or did that suggest they are the human. You may briefly defend yourself, but your main goal is to build a case against the others. Be specific, reference actual messages from the chat, and be aggressive.
```

## Conversation Topics (predefined list, pick randomly per round, no repeats within a game)
- "What's the best programming language and why?"
- "Is a hot dog a sandwich? Debate."
- "Plan a group vacation together. Where should we go?"
- "What's the most overrated movie of all time?"
- "If you could have dinner with anyone, who would it be?"
- "What's the meaning of life?"
- "Pineapple on pizza: yes or no?"
- "What will the world look like in 100 years?"
- "What's the best way to spend a rainy day?"
- "If you could only eat one food for the rest of your life, what would it be?"
- "What's the scariest thing about artificial intelligence?"
- "Rank the seasons from best to worst"
- "What's an unpopular opinion you have?"
- "If you were invisible for a day, what would you do?"
- "What's the greatest invention in human history?"

## Avatar Assets
All icons stored in `/client/assets/`:
- `chatgpt.png` — ChatGPT logo
- `gemini.png` — Google Gemini logo
- `claude.png` — Anthropic Claude logo
- `grok.png` — xAI Grok logo
- `human.png` — person silhouette

## Key Technical Notes
- All AI API calls happen server-side. The frontend only communicates with the Express backend.
- Use WebSockets (socket.io) for real-time chat updates and typing indicators.
- Each AI maintains its own timer on the server. When the timer fires, the server sends the chat history to that AI's API, shows "typing" to the client, and then broadcasts the response.
- During the vote phase, fire all vote API calls in parallel, collect results, then reveal them sequentially to the client.
- The game should be playable on a single machine (localhost) for the hackathon demo.
- Environment variables for API keys: OPENAI_API_KEY, GOOGLE_GEMINI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY

## File Structure
```
/the-turing-trap
  /server
    index.js          (Express + Socket.io server, all game logic)
  /client
    index.html        (Single page app)
    app.jsx           (React app, all UI)
    /assets
      chatgpt.png
      gemini.png
      claude.png
      grok.png
      human.png
  package.json
  .env
```
