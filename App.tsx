
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameRole, GameState, Player, Question, Difficulty } from './types';
import { generateBigBangQuestions } from './services/geminiService';
import { MEMBERS, COLORS, CROWN_SVG, shuffleArray } from './constants';
import QRCode from 'react-qr-code';
import { Peer, DataConnection } from 'peerjs';

export default function App() {
  const [role, setRole] = useState<GameRole>(GameRole.LOBBY);
  const [gameState, setGameState] = useState<GameState>(GameState.IDLE);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [peerStatus, setPeerStatus] = useState<'IDLE' | 'CONNECTING' | 'CONNECTED' | 'ERROR'>('IDLE');
  
  const [playerFilter, setPlayerFilter] = useState('');
  
  const [difficulty, setDifficulty] = useState<Difficulty>(Difficulty.NORMAL);
  const [timerDuration, setTimerDuration] = useState(10);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  const questionsRef = useRef<Question[]>([]);
  const currentIndexRef = useRef<number>(-1);
  const playersRef = useRef<Player[]>([]);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuestions = (q: Question[]) => { setQuestions(q); questionsRef.current = q; };
  const updateCurrentIndex = (i: number) => { setCurrentIndex(i); currentIndexRef.current = i; };
  const updatePlayers = (p: Player[]) => { setPlayers(p); playersRef.current = p; };

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const hostConnRef = useRef<DataConnection | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('BB_CUSTOM_API_KEY') || '');

  useEffect(() => { localStorage.setItem('BB_CUSTOM_API_KEY', customApiKey); }, [customApiKey]);

  // 初始進入判斷
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session');
    if (params.get('role') === 'player' && sid) {
      setSessionId(sid);
      setRole(GameRole.PLAYER);
      setupPlayerPeer(sid);
    }
  }, []);

  const setupHostPeer = async () => {
    const sid = Math.random().toString(36).substring(2, 8).toUpperCase();
    setSessionId(sid);
    const peer = new Peer(`BB-TRIVIA-${sid}`);
    peerRef.current = peer;

    peer.on('open', () => setPeerStatus('CONNECTED'));
    peer.on('connection', (conn) => {
      conn.on('open', () => { connectionsRef.current.set(conn.peer, conn); sendSyncToConn(conn); });
      conn.on('data', (data: any) => {
        if (data.type === 'PLAYER_JOIN') updatePlayers([...playersRef.current.filter(p => p.id !== data.player.id), data.player]);
        if (data.type === 'PLAYER_ANSWER') handlePlayerAnswer(data.playerId, data.answer);
        if (data.type === 'CHALLENGE_ACCEPTED') handleChallengeAccepted(data.playerId);
      });
    });

    setGameState(GameState.JOINING);
    setRole(GameRole.HOST);
  };

  const fetchNewQuestions = async () => {
    setIsSyncing(true);
    try {
      const q = await generateBigBangQuestions([], difficulty, customApiKey);
      updateQuestions(q);
      updateCurrentIndex(-1);
      // 產題後，如果是第一輪，會直接在下一步由母體點擊 Start。如果是 NEW BATTLE，則會回到邀請畫面。
      setGameState(GameState.CHALLENGE_INVITE);
    } catch (e) { console.error("生成題目失敗", e); } 
    finally { setIsSyncing(false); }
  };

  const setupPlayerPeer = (targetSid: string) => {
    setPeerStatus('CONNECTING');
    const peer = new Peer();
    peerRef.current = peer;
    peer.on('open', () => {
      const conn = peer.connect(`BB-TRIVIA-${targetSid}`);
      hostConnRef.current = conn;
      conn.on('open', () => setPeerStatus('CONNECTED'));
      conn.on('data', (data: any) => {
        if (data.type === 'SYNC_STATE') {
          setCurrentIndex(data.currentQuestionIndex);
          setGameState(data.gameState);
          setPlayers(data.players);
          setQuestions(data.questions || []);
          setTimerDuration(data.timerDuration);
          setTimeLeft(data.timeLeft);
          setIsRevealing(data.isRevealing);
          setCurrentPlayer(p => {
            if (!p) return null;
            const updated = data.players.find((pl: Player) => pl.id === p.id);
            return updated ? { ...p, score: updated.score, lastAnswer: updated.lastAnswer, isCorrect: updated.isCorrect, isInvited: updated.isInvited, hasAccepted: updated.hasAccepted } : p;
          });
        }
      });
    });
  };

  const sendSyncToConn = (conn: DataConnection) => {
    if (conn.open) {
      conn.send({
        type: 'SYNC_STATE',
        gameState,
        currentQuestionIndex: currentIndex,
        players: playersRef.current,
        questions,
        sessionId,
        timerDuration,
        timeLeft,
        isRevealing,
      });
    }
  };

  const broadcast = useCallback(() => {
    connectionsRef.current.forEach(conn => sendSyncToConn(conn));
  }, [gameState, currentIndex, players, questions, sessionId, timerDuration, timeLeft, isRevealing]);

  useEffect(() => {
    if (role === GameRole.HOST && peerStatus === 'CONNECTED') broadcast();
  }, [gameState, currentIndex, players, questions, role, peerStatus, broadcast, timeLeft, isRevealing]);

  // 母體端計時器
  useEffect(() => {
    if (role !== GameRole.HOST) return;
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (gameState === GameState.QUESTION && timeLeft !== null && timeLeft > 0 && !isRevealing) {
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft(t => (t !== null && t > 0) ? t - 1 : 0);
      }, 1000);
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [gameState, timeLeft, isRevealing, role]);

  // 母體自動跳轉邏輯
  useEffect(() => {
    if (role !== GameRole.HOST || gameState !== GameState.QUESTION || isRevealing) return;

    const acceptedPlayers = players.filter(p => p.hasAccepted);
    const allAnswered = acceptedPlayers.length > 0 && acceptedPlayers.every(p => p.lastAnswer !== undefined);

    if (allAnswered || (timeLeft !== null && timeLeft <= 0)) {
        setIsRevealing(true);
        if (autoAdvanceTimeoutRef.current) clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = setTimeout(() => {
            nextQuestion();
        }, 3000); // 顯示 3 秒答案後跳下一題
    }
  }, [players, timeLeft, gameState, role, isRevealing]);

  const sendChallenge = (playerId: string) => updatePlayers(playersRef.current.map(p => p.id === playerId ? { ...p, isInvited: true } : p));
  const handleChallengeAccepted = (playerId: string) => updatePlayers(playersRef.current.map(p => p.id === playerId ? { ...p, hasAccepted: true } : p));

  const confirmChallengeAccept = () => {
    if (currentPlayer) {
      setCurrentPlayer({ ...currentPlayer, hasAccepted: true });
      hostConnRef.current?.send({ type: 'CHALLENGE_ACCEPTED', playerId: currentPlayer.id });
    }
  };

  const startBattleAfterInvite = () => {
    updatePlayers(playersRef.current.map(p => ({ ...p, lastAnswer: undefined, isCorrect: undefined })));
    updateCurrentIndex(0);
    setGameState(GameState.QUESTION);
    setTimeLeft(timerDuration);
    setIsRevealing(false);
  };

  const handlePlayerAnswer = (playerId: string, answer: string) => {
    const idx = currentIndexRef.current;
    const currentQ = questionsRef.current[idx];
    if (!currentQ || isRevealing || (timeLeft !== null && timeLeft <= 0)) return;
    const isCorrect = answer === currentQ.correctAnswer;
    updatePlayers(playersRef.current.map(p => {
      if (p.id === playerId && !p.lastAnswer) {
        return { ...p, lastAnswer: answer, isCorrect, score: isCorrect ? p.score + 100 + (timeLeft || 0) : p.score };
      }
      return p;
    }));
  };

  const nextQuestion = () => {
    if (autoAdvanceTimeoutRef.current) clearTimeout(autoAdvanceTimeoutRef.current);
    setIsRevealing(false);
    if (currentIndexRef.current < questionsRef.current.length - 1) {
      updatePlayers(playersRef.current.map(p => ({ ...p, lastAnswer: undefined, isCorrect: undefined })));
      updateCurrentIndex(currentIndexRef.current + 1);
      setGameState(GameState.QUESTION);
      setTimeLeft(timerDuration);
    } else {
      setGameState(GameState.FINISHED);
      setTimeLeft(null);
    }
  };

  const submitAnswer = (answer: string) => {
    if (!currentPlayer || currentPlayer.lastAnswer || gameState !== GameState.QUESTION || isRevealing || (timeLeft !== null && timeLeft <= 0)) return;
    setCurrentPlayer({ ...currentPlayer, lastAnswer: answer });
    hostConnRef.current?.send({ type: 'PLAYER_ANSWER', playerId: currentPlayer.id, answer });
  };

  const joinGame = (name: string) => {
    const newPlayer: Player = { id: 'VIP-' + Math.random().toString(36).substring(7).toUpperCase(), name, score: 0 };
    setCurrentPlayer(newPlayer);
    hostConnRef.current?.send({ type: 'PLAYER_JOIN', player: newPlayer });
  };

  const playerJoinUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('role', 'player');
    url.searchParams.set('session', sessionId || '');
    return url.toString();
  }, [sessionId]);

  const filteredPlayers = useMemo(() => {
    return [...players]
      .sort((a, b) => b.score - a.score)
      .filter(p => p.name.toLowerCase().includes(playerFilter.toLowerCase()));
  }, [players, playerFilter]);

  const SettingsModal = () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl">
      <div className="glass-card w-full max-w-md p-10 rounded-[3rem] border border-yellow-400/30">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-3xl font-black bigbang-yellow italic">SYSTEM SETTINGS</h3>
          <button onClick={() => setShowSettings(false)} className="text-white/40 hover:text-white font-bold">CLOSE</button>
        </div>
        <div className="space-y-4">
          <p className="text-white/40 text-xs font-bold uppercase tracking-widest">GEMINI API KEY</p>
          <input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="貼入你的 API KEY..." className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-white outline-none focus:border-yellow-400 transition-all" />
          <button onClick={() => { setShowSettings(false); }} className="w-full bg-yellow-400 text-black font-black py-5 rounded-2xl hover:scale-105 transition-all">儲存</button>
        </div>
      </div>
    </div>
  );

  if (role === GameRole.LOBBY) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
        <div className="text-center space-y-12 animate-in zoom-in duration-700">
          <h1 className="text-[10rem] font-black italic bigbang-yellow tracking-tighter leading-none drop-shadow-[0_0_80px_rgba(255,240,0,0.5)]">BIGBANG</h1>
          <button onClick={setupHostPeer} className="bg-yellow-400 text-black font-black px-16 py-8 rounded-[3rem] text-4xl hover:scale-105 transition-all shadow-2xl">
            啟動 VIP ARENA
          </button>
        </div>
      </div>
    );
  }

  if (role === GameRole.HOST) {
    const currentQ = questions[currentIndex];
    const activePlayersCount = players.filter(p => p.hasAccepted).length;
    const answeredCount = players.filter(p => p.hasAccepted && p.lastAnswer).length;

    return (
      <div className="min-h-screen p-10 max-w-7xl mx-auto flex flex-col bg-black overflow-hidden">
        <header className="flex justify-between items-end mb-12 border-b-2 border-yellow-400/20 pb-8 relative z-10">
          <div><h1 className="text-7xl font-black italic bigbang-yellow tracking-tighter uppercase leading-none">VIP CENTER</h1><p className="text-white/40 font-mono tracking-tighter uppercase mt-2">ID: {sessionId}</p></div>
          <div className="text-right"><div className="text-yellow-400 font-black text-6xl">{players.length}</div><p className="text-xs text-white/30 font-bold uppercase tracking-widest">VIPs Online</p></div>
        </header>

        <main className="flex-1 flex flex-col justify-center relative z-10 overflow-auto">
          {gameState === GameState.JOINING && (
            <div className="text-center space-y-12">
              <h2 className="text-8xl font-black uppercase italic drop-shadow-2xl">掃描加入</h2>
              <div className="flex items-center justify-center gap-20">
                <div className="bg-white p-8 rounded-[4rem] border-[12px] border-yellow-400"><QRCode value={playerJoinUrl} size={320} /></div>
                <div className="text-left space-y-8 max-w-md">
                   <div className="space-y-4">
                     <p className="text-yellow-400 font-black text-2xl uppercase tracking-widest italic border-b border-white/10 pb-2">已入場 VIP</p>
                     <div className="flex flex-wrap gap-3">{players.map(p => <div key={p.id} className="bg-white/10 text-white px-5 py-2 rounded-xl font-bold">{p.name}</div>)}</div>
                   </div>
                   <button onClick={() => setGameState(GameState.CHALLENGE_INVITE)} disabled={players.length === 0} className="w-full bg-white text-black px-16 py-8 rounded-[2.5rem] font-black text-4xl hover:bg-yellow-400 transition-all shadow-2xl disabled:bg-gray-600 disabled:text-white/50">
                    進入挑戰設定
                   </button>
                </div>
              </div>
            </div>
          )}

          {gameState === GameState.CHALLENGE_INVITE && (
            <div className="space-y-8 animate-in fade-in max-h-full flex flex-col">
               <div className="text-center"><h2 className="text-9xl font-black italic bigbang-yellow uppercase tracking-tighter drop-shadow-2xl leading-none">SETUP</h2><p className="text-white/40 font-bold uppercase tracking-[0.3em] mt-4">設定難度與邀請 VIP</p></div>
               
               <div className="max-w-4xl mx-auto w-full grid grid-cols-2 gap-x-12 gap-y-6">
                  <div>
                    <p className="text-white/40 font-bold uppercase tracking-widest text-sm mb-2">難度選擇 (下次生效)</p>
                    <div className="flex gap-2">{Object.values(Difficulty).map(d => <button key={d} onClick={() => setDifficulty(d)} className={`flex-1 p-4 rounded-xl font-black transition-all ${difficulty === d ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>{d}</button>)}</div>
                    <button onClick={fetchNewQuestions} disabled={isSyncing} className="w-full mt-4 bg-white/10 text-white py-4 rounded-xl font-bold border border-white/20 hover:border-yellow-400 transition-all">
                      {isSyncing ? '產題中...' : `重新產生【${difficulty}】題目`}
                    </button>
                  </div>
                  <div>
                    <p className="text-white/40 font-bold uppercase tracking-widest text-sm mb-2">每題回答時間</p>
                    <div className="flex gap-2">{[5, 10, 15].map(t => <button key={t} onClick={() => setTimerDuration(t)} className={`flex-1 p-4 rounded-xl font-black transition-all ${timerDuration === t ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}>{t}秒</button>)}</div>
                  </div>
               </div>

               <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 gap-6 overflow-hidden mt-4">
                  <div className="relative flex items-center gap-4">
                    <input type="text" placeholder="搜尋 VIP..." value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} className="flex-1 bg-white/5 border-2 border-white/10 p-6 rounded-3xl text-2xl font-bold text-white outline-none focus:border-yellow-400 transition-all" />
                    <button onClick={() => players.forEach(p => !p.isInvited && sendChallenge(p.id))} className="bg-white/10 text-white px-8 py-6 rounded-3xl font-bold hover:bg-white/20">全部邀請</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-yellow-400">
                    {filteredPlayers.map((p, idx) => (
                      <div key={p.id} className="glass-card flex items-center justify-between p-6 rounded-3xl border border-white/10 hover:bg-white/10 transition-all">
                        <div className="flex items-center gap-8"><span className="text-4xl font-black text-white/10 w-16">{idx+1}</span><div><p className="text-3xl font-black uppercase text-white">{p.name}</p><p className="text-yellow-400 font-mono font-bold">SCORE: {p.score}</p></div></div>
                        <div>{p.hasAccepted ? <span className="bg-green-500 text-black px-8 py-4 rounded-2xl font-black text-xl animate-pulse">READY</span> : p.isInvited ? <span className="bg-white/10 text-white/50 px-8 py-4 rounded-2xl font-black text-xl italic border border-white/10">WAITING...</span> : <button onClick={() => sendChallenge(p.id)} className="bg-yellow-400 text-black px-8 py-4 rounded-2xl font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-lg">INVITE</button>}</div>
                      </div>
                    ))}
                  </div>
               </div>
               <div className="flex justify-center"><button onClick={startBattleAfterInvite} disabled={questions.length === 0 || players.filter(p=>p.hasAccepted).length === 0} className="bg-white text-black px-32 py-8 rounded-full font-black text-4xl hover:bg-yellow-400 transition-all shadow-2xl active:scale-95 disabled:bg-gray-600 disabled:text-white/50">START BATTLE</button></div>
            </div>
          )}

          {gameState === GameState.QUESTION && currentQ && (
            <div className="text-center space-y-8">
              <div className="relative h-4 w-full bg-white/10 rounded-full overflow-hidden mb-4">
                <div className="absolute top-0 left-0 h-full bg-yellow-400 rounded-full transition-all duration-1000 linear" style={{ width: `${(timeLeft || 0) / timerDuration * 100}%` }}/>
              </div>
              <div className="space-y-4">
                <span className="bg-yellow-400 text-black px-12 py-3 rounded-full font-black text-3xl uppercase italic shadow-2xl">STAGE {currentIndex + 1}</span>
                <h2 className="text-6xl font-black leading-tight drop-shadow-2xl tracking-tighter px-10">{currentQ.text}</h2>
                <div className="flex justify-center items-center gap-10">
                  <div className="text-white/40 font-bold text-4xl uppercase tracking-widest">已作答: <span className="text-yellow-400 font-black">{answeredCount}</span> / {activePlayersCount}</div>
                  <div className={`text-6xl font-black ${timeLeft && timeLeft <= 3 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}s</div>
                </div>
                 {isRevealing && <p className="text-green-400 font-black text-2xl animate-pulse">正在揭曉答案...</p>}
              </div>
              <div className="grid grid-cols-2 gap-8 max-w-6xl mx-auto">
                {currentQ.options.map((opt, i) => {
                    const isCorrect = opt === currentQ.correctAnswer;
                    return (
                        <div key={i} className={`glass-card py-12 rounded-[4rem] border-4 text-4xl font-black text-white/90 shadow-2xl flex items-center justify-center px-6 text-center leading-tight min-h-[10rem] transition-all duration-300 ${isRevealing && isCorrect ? 'border-green-500 bg-green-500/10 scale-105' : 'border-white/10'}`}>{opt}</div>
                    );
                })}
              </div>
              <div className="flex justify-center gap-10 pt-6">
                <button onClick={() => setGameState(GameState.LEADERBOARD)} className="bg-white/10 px-16 py-7 rounded-3xl font-black text-3xl">查看即時排名</button>
                <button onClick={nextQuestion} className="bg-white/5 px-16 py-7 rounded-3xl font-black text-3xl text-white/40 hover:text-white">手動跳過</button>
              </div>
            </div>
          )}

          {(gameState === GameState.LEADERBOARD || gameState === GameState.FINISHED) && (
            <div className="space-y-12 animate-in fade-in">
               <h2 className="text-[10rem] font-black text-center italic bigbang-yellow uppercase leading-none drop-shadow-2xl">{gameState === GameState.FINISHED ? 'FINAL KINGS' : 'RANKINGS'}</h2>
               <div className="max-w-5xl mx-auto space-y-6">
                  {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                    <div key={p.id} className={`glass-card flex items-center justify-between p-12 rounded-[3.5rem] border ${p.hasAccepted ? 'border-yellow-400/50 bg-yellow-400/5' : 'border-white/10'}`}>
                      <div className="flex items-center gap-12"><span className="text-7xl font-black text-white/10 w-24">{idx+1}</span><span className="text-5xl font-black uppercase">{p.name}</span></div>
                      <div className="flex items-center gap-12">{idx < 3 && <span className="animate-bounce">{CROWN_SVG(72, idx === 0 ? COLORS.GOLD : idx === 1 ? COLORS.SILVER : COLORS.BRONZE)}</span>}<span className="text-8xl font-mono text-yellow-400 font-black">{p.score}</span></div>
                    </div>
                  ))}
               </div>
               <div className="flex justify-center mt-16">
                 {gameState === GameState.LEADERBOARD ? 
                  <button onClick={() => setGameState(GameState.QUESTION)} className="bg-yellow-400 text-black px-32 py-10 rounded-[3.5rem] font-black text-5xl hover:scale-105 transition-all">返回題目</button> : 
                  <button onClick={() => setGameState(GameState.CHALLENGE_INVITE)} className="bg-white/10 px-24 py-10 rounded-[3.5rem] font-black text-3xl hover:bg-yellow-400 transition-all hover:text-black">NEW BATTLE (重新設定)</button>
                 }
               </div>
            </div>
          )}
        </main>

        <button onClick={() => setShowSettings(true)} className="fixed bottom-12 right-12 z-[50] p-6 bg-yellow-400 rounded-full shadow-2xl hover:scale-110 active:scale-90 transition-all group"><svg className="w-12 h-12 text-black group-hover:rotate-90 transition-all duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /></svg></button>
        {showSettings && <SettingsModal />}
      </div>
    );
  }

  // PLAYER 手機端
  if (role === GameRole.PLAYER) {
    if (peerStatus === 'CONNECTING') return <div className="min-h-screen flex items-center justify-center bg-black"><p className="bigbang-yellow font-black text-3xl italic animate-pulse">VIP 連線中...</p></div>;
    if (!currentPlayer) return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-zinc-950">
            <form onSubmit={(e) => { e.preventDefault(); const n = (e.currentTarget.elements.namedItem('playername') as HTMLInputElement).value; if (n) joinGame(n); }} className="w-full max-w-sm space-y-16"><h1 className="text-7xl font-black bigbang-yellow italic text-center drop-shadow-2xl">JOIN VIP</h1><input name="playername" required maxLength={12} placeholder="輸入暱稱..." className="w-full bg-white/5 border-2 border-white/10 p-10 rounded-[3rem] text-4xl font-black text-center text-white outline-none focus:border-yellow-400" /><button className="w-full bg-yellow-400 text-black font-black py-10 rounded-[3rem] text-4xl shadow-2xl active:scale-95 transition-all">ENTER</button></form>
        </div>
    );

    const currentQ = questions[currentIndex];
    const isTimeout = timeLeft !== null && timeLeft <= 0;

    return (
      <div className="min-h-screen p-8 flex flex-col bg-zinc-950 relative overflow-hidden">
        {currentPlayer.isInvited && !currentPlayer.hasAccepted && <div className="absolute inset-0 bg-yellow-400/20 animate-pulse z-0 pointer-events-none" />}
        <header className="flex justify-between items-center mb-6 border-b border-white/10 pb-4 relative z-10"><span className="font-black text-xl text-white uppercase">{currentPlayer.name}</span><span className="bigbang-yellow font-black text-4xl">{currentPlayer.score}</span></header>

        <div className="flex-1 flex flex-col justify-center relative z-10">
          {gameState === GameState.JOINING ? (
            <div className="text-center space-y-12"><p className="text-[8rem] drop-shadow-[0_0_50px_rgba(255,240,0,0.5)]">👑</p><h2 className="text-4xl font-black text-white animate-pulse">CONNECTED</h2><p className="text-white/40">等待母體開始設定挑戰...</p></div>
          ) 
          : gameState === GameState.CHALLENGE_INVITE ? (
             <div className="text-center space-y-10">
                {currentPlayer.isInvited ? (currentPlayer.hasAccepted ? <div className="space-y-8 animate-in zoom-in"><p className="text-8xl">🔥</p><h2 className="text-4xl font-black text-green-500 italic uppercase">READY TO FIGHT</h2><p className="text-white/40 font-bold italic uppercase tracking-widest animate-pulse">Waiting for Battle Start...</p></div> : <div className="space-y-12 animate-in slide-in-from-top-10"><h2 className="text-5xl font-black bigbang-yellow italic leading-none drop-shadow-[0_0_40px_rgba(255,240,0,0.5)]">CHALLENGE RECEIVED!</h2><button onClick={confirmChallengeAccept} className="w-full bg-white text-black py-12 rounded-[4rem] text-4xl font-black shadow-[0_30px_60px_rgba(255,255,255,0.2)] animate-bounce active:scale-90 transition-all uppercase">ACCEPT</button></div>) : <div className="space-y-8 opacity-40"><p className="text-8xl">⏳</p><h2 className="text-3xl font-black text-white italic uppercase">STAND BY</h2><p className="text-white/40">The host is configuring the arena...</p></div>}
             </div>
          ) 
          : gameState === GameState.QUESTION && currentQ ? (
            <div className="space-y-6">
               <div className="flex justify-between items-end mb-2">
                 <span className="text-yellow-400 font-black italic">Question {currentIndex + 1}</span>
                 <span className={`text-4xl font-black ${timeLeft && timeLeft <= 3 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}s</span>
               </div>
               <div className="relative h-3 w-full bg-white/10 rounded-full overflow-hidden mb-4">
                 <div className="absolute top-0 left-0 h-full bg-yellow-400 rounded-full transition-all duration-1000 linear" style={{ width: `${(timeLeft || 0) / timerDuration * 100}%` }}/>
               </div>
               <div className="text-center bg-white/5 p-8 rounded-[3.5rem] border border-white/10 shadow-2xl min-h-[12rem] flex items-center justify-center"><h3 className="text-2xl font-bold text-white leading-tight">{currentQ.text}</h3></div>
               <div className="grid gap-4">
                {currentQ.options.map((opt, i) => {
                  const isCorrect = opt === currentQ.correctAnswer;
                  const isMyAnswer = currentPlayer.lastAnswer === opt;
                  let buttonClass = 'bg-white/5 text-white border-white/10';
                  
                  if (isRevealing) {
                      if (isCorrect) buttonClass = 'bg-green-500/20 border-green-500 text-white scale-105';
                      else if (isMyAnswer) buttonClass = 'bg-red-500/40 border-red-500 text-white/50';
                      else buttonClass = 'bg-white/5 text-white/20 border-white/5';
                  } else if (isMyAnswer) {
                      buttonClass = 'bg-yellow-400 text-black border-yellow-400 scale-95';
                  } else if (isTimeout) {
                      buttonClass = 'bg-white/5 text-white/20 border-white/5 cursor-not-allowed';
                  }
                  
                  return (
                    <button key={i} onClick={() => submitAnswer(opt)} disabled={!!currentPlayer.lastAnswer || isTimeout || isRevealing} className={`p-6 rounded-[2.5rem] text-xl font-black transition-all border-4 min-h-[5.5rem] flex items-center justify-center text-center ${buttonClass}`}>{opt}</button>
                  );
                })}
               </div>
               {isTimeout && !currentPlayer.lastAnswer && !isRevealing && <p className="text-red-500 font-black text-center text-2xl uppercase animate-pulse">TIME OUT!</p>}
            </div>
          ) : (
            <div className="text-center space-y-10">
              <h2 className="text-6xl font-black bigbang-yellow italic uppercase">{gameState === GameState.FINISHED ? 'THE END' : 'STANDINGS'}</h2>
              <div className="space-y-4">{[...players].sort((a,b) => b.score - a.score).slice(0, 5).map((p, idx) => <div key={p.id} className={`p-6 rounded-[2.5rem] flex justify-between items-center ${p.id === currentPlayer.id ? 'bg-yellow-400/20 border-2 border-yellow-400/50' : 'bg-white/5'}`}><span className="font-bold text-white uppercase text-xl">{idx+1}. {p.name}</span><span className="font-mono text-yellow-400 font-black text-3xl">{p.score}</span></div>)}</div>
              <p className="text-white/40 font-bold uppercase animate-pulse">Wait for next round...</p>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
}
