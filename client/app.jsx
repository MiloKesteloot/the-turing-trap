const { useState, useEffect, useRef, useCallback } = React;

// Built dynamically from config.json colors when game starts
// Maps player number → their model's color
let PLAYER_COLORS = {};

const MODEL_DISPLAY = {
  chatgpt: { name: 'ChatGPT', color: '#10a37f', icon: '/assets/chatgpt.png' },
  gemini: { name: 'Gemini', color: '#4285f4', icon: '/assets/gemini.png' },
  claude: { name: 'Claude', color: '#d4a574', icon: '/assets/claude.png' },
  grok: { name: 'Grok', color: '#ffffff', icon: '/assets/grok.png' },
  human: { name: 'THE HUMAN', color: '#ff0055', icon: '/assets/human.svg' },
};

function formatPlayerList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
}

// ─── Avatar Component ───
function Avatar({ playerNumber, model, size = 36 }) {
  const color = PLAYER_COLORS[playerNumber] || '#888';
  if (model) {
    const info = MODEL_DISPLAY[model] || MODEL_DISPLAY.human;
    return (
      <img
        src={info.icon}
        alt={info.name}
        style={{ width: size, height: size, borderRadius: '50%', border: `2px solid ${color}`, flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color + '22',
        border: `2px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.36,
        fontWeight: 700,
        color: color,
        flexShrink: 0,
      }}
    >
      P{playerNumber}
    </div>
  );
}

// ─── Typing Indicator ───
function TypingIndicator({ playerNumber }) {
  const color = PLAYER_COLORS[playerNumber];
  return (
    <div className="flex items-center gap-2 px-4 py-1 msg-enter" style={{ color: color + 'aa' }}>
      <span className="text-xs">Player {playerNumber} is typing</span>
      <span className="flex gap-0.5">
        <span className="typing-dot inline-block w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
        <span className="typing-dot inline-block w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
        <span className="typing-dot inline-block w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
      </span>
    </div>
  );
}

// ─── Chat Message ───
function ChatMessage({ msg, humanPlayerNumber, playerModels }) {
  const isHuman = msg.playerNumber === humanPlayerNumber;
  const color = PLAYER_COLORS[msg.playerNumber];
  const model = playerModels?.[msg.playerNumber] || null;

  return (
    <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'} px-4 py-1 msg-enter`}>
      <div className={`flex items-start gap-2 max-w-[75%] ${isHuman ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={isHuman ? "chat-avatar-human" : "chat-avatar msg-avatar"}>
          <Avatar playerNumber={msg.playerNumber} model={model} size={40} />
        </div>
        <div>
          <div className={`text-xs mb-0.5 ${isHuman ? 'text-right' : 'text-left'}`} style={{ color }}>
            Player {msg.playerNumber}
          </div>
          <div
            className="px-3 py-2 rounded-xl text-sm leading-relaxed"
            style={{ backgroundColor: '#1e1e2e', color: '#e0e0e0' }}
          >
            {msg.text}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── System Message ───
function SystemMessage({ msg }) {
  return (
    <div className="flex justify-center px-4 py-2 msg-enter">
      <div className="text-xs px-4 py-1.5 rounded-full" style={{ backgroundColor: '#00d4ff15', color: '#00d4ff' }}>
        {msg.text}
      </div>
    </div>
  );
}

// ─── Vote Message ───
function VoteMessage({ msg, playerModels }) {
  const voterColor = PLAYER_COLORS[msg.playerNumber];
  const targetColor = PLAYER_COLORS[msg.votedFor];
  const model = playerModels?.[msg.playerNumber] || null;

  return (
    <div className="flex justify-start px-4 py-1 msg-enter">
      <div className="flex items-start gap-2 max-w-[80%]">
        <div className="msg-avatar">
          <Avatar playerNumber={msg.playerNumber} model={model} size={40} />
        </div>
        <div>
          <div className="text-xs mb-0.5" style={{ color: voterColor }}>
            Player {msg.playerNumber}
          </div>
          <div
            className="px-3 py-2 rounded-xl text-sm leading-relaxed"
            style={{ backgroundColor: '#1a1a2e', border: '1px solid #ff005533', color: '#e0e0e0' }}
          >
            <span>I am voting for </span>
            <span style={{ color: targetColor, fontWeight: 600 }}>
              Player {msg.votedFor}
            </span>
            <span className="opacity-70">
              {' — '}{msg.text.replace(/^I vote for Player \d+!?\s*/i, '')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vote Summary Card ───
function VoteSummaryCard({ data }) {
  const { votes, counts, result, eliminated, tiedPlayers } = data;

  return (
    <div className="flex justify-center px-4 py-3 msg-enter">
      <div className="w-full max-w-md rounded-xl p-4" style={{ backgroundColor: '#151525', border: '1px solid #333' }}>
        <div className="text-center text-xs font-bold mb-3" style={{ color: '#00d4ff' }}>
          VOTE RESULTS
        </div>

        <div className="space-y-1 mb-3">
          {votes.map((v, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span style={{ color: PLAYER_COLORS[v.voter] }}>Player {v.voter}</span>
              <span className="opacity-40" style={{ fontSize: '1.5em' }}>→</span>
              <span style={{ color: PLAYER_COLORS[v.votedFor] }}>Player {v.votedFor}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-700 pt-2 mb-2">
          <div className="text-xs opacity-50 mb-1">Vote Counts</div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(counts).map(([player, count]) => (
              <div key={player} className="text-xs">
                <span style={{ color: PLAYER_COLORS[parseInt(player)] }}>P{player}</span>
                <span className="mx-1 opacity-70">—</span>
                <span className="opacity-70">{count} vote{count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-700 pt-2 text-center text-sm font-bold">
          {result === 'tie' && (
            <span style={{ color: '#ffe66d' }}>
              TIE — {formatPlayerList(tiedPlayers.map(n => `Player ${n}`))}
            </span>
          )}
          {result === 'eliminated' && (
            <span style={{ color: '#ff0055' }}>
              Player {eliminated} is eliminated!
            </span>
          )}
          {result === 'all-eliminated' && (
            <span style={{ color: '#ff0055' }}>
              {formatPlayerList((Array.isArray(eliminated) ? eliminated : [eliminated]).map(n => `Player ${n}`))} eliminated!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tiebreaker Message ───
function TiebreakerMessage({ msg, playerModels }) {
  const color = PLAYER_COLORS[msg.playerNumber];
  const model = playerModels?.[msg.playerNumber] || null;
  return (
    <div className="flex justify-start px-4 py-1 msg-enter">
      <div className="flex items-start gap-2 max-w-[85%]">
        <div className="msg-avatar">
          <Avatar playerNumber={msg.playerNumber} model={model} size={40} />
        </div>
        <div>
          <div className="text-xs mb-0.5" style={{ color }}>
            Player {msg.playerNumber} <span className="opacity-50">(tiebreaker)</span>
          </div>
          <div
            className="px-3 py-2 rounded-xl text-sm leading-relaxed italic"
            style={{ backgroundColor: '#1a1a2e', border: '1px solid #ffe66d33', color: '#e0e0e0' }}
          >
            {msg.text}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Elimination Reveal ───
function EliminationMessage({ msg }) {
  const color = PLAYER_COLORS[msg.playerNumber] || '#888';
  return (
    <div className="flex justify-center px-4 py-3 msg-enter">
      <div
        className="w-full max-w-sm rounded-xl p-4 text-center"
        style={{
          backgroundColor: '#151525',
          border: `2px solid ${color}`,
        }}
      >
        <div className="text-lg mb-2">
          <span className="opacity-60">Player {msg.playerNumber} was...</span>
        </div>
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="msg-avatar">
            <Avatar playerNumber={msg.playerNumber} model={msg.isHuman ? 'human' : msg.model} revealed size={56} />
          </div>
          <span
            className="text-xl font-bold"
            style={{ color }}
          >
            {msg.revealName}!
          </span>
        </div>
        {msg.isHuman && (
          <div className="text-sm mt-2" style={{ color }}>
            You've been detected!
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Voting Status Panel ───
function VotingStatusPanel({ votingStatus, playerModels }) {
  if (!votingStatus) return null;
  const { voters, ready } = votingStatus;

  return (
    <div className="flex justify-center px-4 py-4 msg-enter">
      <div className="w-full max-w-sm rounded-xl p-4" style={{ backgroundColor: '#151525', border: '1px solid #333' }}>
        <div className="text-center text-xs font-bold mb-3" style={{ color: '#00d4ff' }}>
          DELIBERATING...
        </div>
        <div className="flex justify-center gap-4">
          {voters.map(pn => {
            const done = ready.includes(pn);
            const model = playerModels?.[pn] || null;
            return (
              <div key={pn} className="flex flex-col items-center gap-1">
                <div className="relative">
                  <div className={`msg-avatar ${done ? '' : 'voting-pulse'}`} style={{ opacity: done ? 1 : 0.4 }}>
                    <Avatar playerNumber={pn} model={model} size={44} />
                  </div>
                  {done && (
                    <div
                      className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold msg-enter"
                      style={{ backgroundColor: '#00d4ff', color: '#0a0a0f' }}
                    >
                      ✓
                    </div>
                  )}
                </div>
                <span className="text-xs" style={{ color: PLAYER_COLORS[pn], opacity: done ? 1 : 0.4 }}>
                  P{pn}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Message Renderer ───
function Message({ msg, humanPlayerNumber, playerModels }) {
  switch (msg.type) {
    case 'chat':
      return <ChatMessage msg={msg} humanPlayerNumber={humanPlayerNumber} playerModels={playerModels} />;
    case 'system':
      return <SystemMessage msg={msg} />;
    case 'vote':
      return <VoteMessage msg={msg} playerModels={playerModels} />;
    case 'vote-summary':
      return <VoteSummaryCard data={msg.data} />;
    case 'tiebreaker':
      return <TiebreakerMessage msg={msg} playerModels={playerModels} />;
    case 'elimination':
      return <EliminationMessage msg={msg} />;
    default:
      return null;
  }
}

// ─── Start Screen ───
function StartScreen({ onPlay }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <h1 className="text-5xl font-bold mb-2 glitch-text" style={{ color: '#00d4ff' }}>
          THE TURING TRAP
        </h1>
        <p className="text-lg mb-8 opacity-60">
          You're the only human. Don't get caught.
        </p>
        <div className="text-sm mb-8 opacity-40 leading-relaxed max-w-sm mx-auto">
          You've entered a chatroom with 4 AI chatbots. Everyone is anonymous.
          Chat naturally about each topic and survive the vote.
          If the AIs figure out you're human, it's game over.
        </div>
        <button
          onClick={onPlay}
          className="px-10 py-3 rounded-lg text-lg font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer"
          style={{ backgroundColor: '#00d4ff', color: '#0a0a0f' }}
        >
          PLAY
        </button>
      </div>
    </div>
  );
}

// ─── Top Bar ───
function TopBar({ round, timer, topic, phase }) {
  const timerColor = timer <= 10 ? '#ff0055' : timer <= 30 ? '#ffe66d' : '#00d4ff';
  const minutes = Math.floor(timer / 60);
  const seconds = timer % 60;
  const timerDisplay = phase === 'tiebreaker'
    ? `${timer}s`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="border-b" style={{ backgroundColor: '#0e0e18', borderColor: '#222' }}>
      <div className="topbar-row flex items-center justify-between px-6 py-3">
        <div className="text-base font-bold" style={{ color: '#00d4ff' }}>
          ROUND {round}
        </div>
        <div className="topbar-topic text-base text-center flex-1 mx-6" style={{ color: '#c8cfd8' }}>
          {topic}
        </div>
        <div className="text-xl font-bold tabular-nums" style={{ color: timerColor }}>
          {timerDisplay}
        </div>
      </div>
      <div className="topbar-topic-mobile px-4 pb-2 text-sm text-center" style={{ color: '#c8cfd8', display: 'none' }}>
        {topic}
      </div>
    </div>
  );
}

// ─── Main App ───
function App() {
  const [phase, setPhase] = useState('start');
  const [messages, setMessages] = useState([]);
  const [humanPlayerNumber, setHumanPlayerNumber] = useState(null);
  const [players, setPlayers] = useState([]);
  const [timer, setTimer] = useState(150);
  const [round, setRound] = useState(1);
  const [topic, setTopic] = useState('');
  const [typingPlayers, setTypingPlayers] = useState([]);
  const [inputText, setInputText] = useState('');
  const [inputDisabled, setInputDisabled] = useState(false);
  const [gameResult, setGameResult] = useState(null);
  const [tiebreakerActive, setTiebreakerActive] = useState(false);
  const [tiebreakerTiedPlayers, setTiebreakerTiedPlayers] = useState([]);
  const [votingStatus, setVotingStatus] = useState(null);

  const [viewHeight, setViewHeight] = useState(window.innerHeight);

  const socketRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);

  // Track visual viewport height for iOS keyboard handling
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onViewportChange() {
      setViewHeight(vv.height);
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
      scrollToBottom();
    }
    vv.addEventListener('resize', onViewportChange);
    vv.addEventListener('scroll', onViewportChange);
    return () => {
      vv.removeEventListener('resize', onViewportChange);
      vv.removeEventListener('scroll', onViewportChange);
    };
  }, [scrollToBottom]);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('game-started', (data) => {
      // Build PLAYER_COLORS from config colors + player assignments
      const colors = data.colors || {};
      PLAYER_COLORS = {};
      data.players.forEach(p => {
        if (p.model && colors[p.model]) {
          PLAYER_COLORS[p.number] = colors[p.model];
        }
      });
      PLAYER_COLORS[data.humanPlayerNumber] = colors.human || '#ff0055';

      setPhase('playing');
      setHumanPlayerNumber(data.humanPlayerNumber);
      setPlayers(data.players);
      setTopic(data.topic);
      setRound(data.round);
      setTimer(data.roundDuration || 150);
      setMessages([]);
      setGameResult(null);
      setInputDisabled(false);
      setTiebreakerActive(false);
      setTypingPlayers([]);
    });

    socket.on('new-message', (msg) => {
      if (msg.type === 'vote') setVotingStatus(null);
      setMessages(prev => [...prev, msg]);
      scrollToBottom();
    });

    socket.on('typing', ({ playerNumber }) => {
      setTypingPlayers(prev => prev.includes(playerNumber) ? prev : [...prev, playerNumber]);
      scrollToBottom();
    });

    socket.on('stop-typing', ({ playerNumber }) => {
      setTypingPlayers(prev => prev.filter(n => n !== playerNumber));
    });

    socket.on('timer-update', (t) => {
      setTimer(t);
    });

    socket.on('player-update', (updatedPlayers) => {
      setPlayers(updatedPlayers);
    });

    socket.on('phase-change', ({ phase: newPhase }) => {
      if (newPhase === 'voting') {
        setInputDisabled(true);
        setTypingPlayers([]);
      }
    });

    socket.on('voting-start', ({ voters }) => {
      setVotingStatus({ voters, ready: [] });
    });

    socket.on('vote-ready', ({ playerNumber }) => {
      setVotingStatus(prev => prev ? { ...prev, ready: [...prev.ready, playerNumber] } : prev);
    });

    socket.on('tiebreaker-start', ({ tiedPlayers, humanInTie, duration }) => {
      setTiebreakerActive(true);
      setTiebreakerTiedPlayers(tiedPlayers);
      if (humanInTie) {
        setInputDisabled(false);
        setInputText('');
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    });

    socket.on('new-round', ({ round: r, topic: t }) => {
      setRound(r);
      setTopic(t);
      setInputDisabled(false);
      setTiebreakerActive(false);
      setVotingStatus(null);
      setTypingPlayers([]);
      setInputText('');
      setTimeout(() => inputRef.current?.focus(), 100);
    });

    socket.on('game-over', ({ result }) => {
      setGameResult(result);
      setInputDisabled(true);
      setTiebreakerActive(false);
      setTypingPlayers([]);
    });

    return () => {
      socket.disconnect();
    };
  }, [scrollToBottom]);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  function startGame() {
    socketRef.current?.emit('start-game');
  }

  function sendMessage() {
    const text = inputText.trim();
    if (!text) return;

    if (tiebreakerActive) {
      socketRef.current?.emit('tiebreaker-response', text);
      setInputDisabled(true);
      setTiebreakerActive(false);
    } else {
      socketRef.current?.emit('send-message', text);
    }
    setInputText('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function playAgain() {
    setPhase('start');
    setMessages([]);
    setGameResult(null);
  }

  if (phase === 'start') {
    return <StartScreen onPlay={startGame} />;
  }

  const playerModels = {};
  players.forEach(p => { if (p.model) playerModels[p.number] = p.model; });
  if (humanPlayerNumber) playerModels[humanPlayerNumber] = 'human';

  return (
    <div className="flex flex-col" style={{ backgroundColor: '#0a0a0f', position: 'fixed', top: 0, left: 0, right: 0, height: viewHeight, overflow: 'hidden' }}>
      {/* Top Bar */}
      <TopBar round={round} timer={timer} topic={topic} phase={tiebreakerActive ? 'tiebreaker' : 'chat'} />

      {/* Player Status Bar */}
      <div className="player-status-bar flex items-center justify-center gap-3 px-4 py-1.5" style={{ backgroundColor: '#0c0c16' }}>
        {players.map(p => {
          const alive = p.alive !== false;
          const color = PLAYER_COLORS[p.number];
          const isYou = p.number === humanPlayerNumber;
          return (
            <div
              key={p.number}
              className="flex items-center gap-1 text-xs"
              style={{ opacity: alive ? 1 : 0.3, textDecoration: alive ? 'none' : 'line-through' }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: alive ? color : '#555' }}
              />
              <span style={{ color: alive ? color : '#555' }}>
                P{p.number}{isYou ? ' (you)' : ''}
              </span>
            </div>
          );
        })}
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto py-3" style={{ backgroundColor: '#0a0a0f' }}>
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} humanPlayerNumber={humanPlayerNumber} playerModels={playerModels} />
        ))}

        {votingStatus && (
          <VotingStatusPanel votingStatus={votingStatus} playerModels={playerModels} />
        )}

        {typingPlayers.map(pn => (
          <TypingIndicator key={`typing-${pn}`} playerNumber={pn} />
        ))}

        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-4 py-3 border-t" style={{ backgroundColor: '#0e0e18', borderColor: '#222' }}>
        {gameResult ? (
          <div className="text-center">
            <div className="text-lg font-bold mb-3" style={{ color: gameResult === 'win' ? '#00d4ff' : '#ff0055' }}>
              {gameResult === 'win'
                ? "You survived The Turing Trap!"
                : "You've been caught!"}
            </div>
            <button
              onClick={playAgain}
              className="px-8 py-2 rounded-lg font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer"
              style={{ backgroundColor: '#00d4ff', color: '#0a0a0f' }}
            >
              PLAY AGAIN
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setTimeout(() => { window.scrollTo(0, 0); scrollToBottom(); }, 100);
                setTimeout(() => { window.scrollTo(0, 0); }, 300);
              }}
              disabled={inputDisabled}
              placeholder={
                tiebreakerActive
                  ? "Defend yourself — prove you're an AI!"
                  : inputDisabled
                    ? "Waiting..."
                    : "Type a message..."
              }
              className="flex-1 px-4 py-2 rounded-lg outline-none transition-colors"
              style={{
                backgroundColor: '#1e1e2e',
                border: '1px solid #333',
                color: '#e0e0e0',
                fontSize: '16px',
                opacity: inputDisabled ? 0.5 : 1,
              }}
            />
            <button
              onClick={sendMessage}
              disabled={inputDisabled || !inputText.trim()}
              className="px-4 py-2 rounded-lg font-bold text-sm transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#00d4ff', color: '#0a0a0f' }}
            >
              SEND
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mount ───
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
