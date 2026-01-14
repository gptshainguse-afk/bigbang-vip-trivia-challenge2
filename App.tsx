import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameRole, GameState, Player, Question } from './types';
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
  
  const [shuffledMembers, setShuffledMembers] = useState(MEMBERS);
  const usedQuestionTexts = useRef<string[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const hostConnRef = useRef<DataConnection | null>(null);

  // --- 連線核心 ---

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session');
    const isPlayerRole = params.get('role') === 'player';

    if (isPlayerRole && sid) {
      setSessionId(sid);
      setRole(GameRole.PLAYER);
      setupPlayerPeer(sid);
    }
  }, []);

  const setupHostPeer = async () => {
    setIsSyncing(true);
    const sid = Math.random().toString(36).substring(2, 8).toUpperCase();
    setSessionId(sid);
    
    const peer = new Peer(`BB-TRIVIA-${sid}`);
    peerRef.current = peer;

    peer.on('open', () => setPeerStatus('CONNECTED'));

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        connectionsRef.current.set(conn.peer, conn);
        // 主動發送當前狀態
        sendSyncMessage(conn);
      });

      conn.on('data', (data: any) => {
        if (data.type === 'PLAYER_JOIN') {
          setPlayers(prev => {
            if (prev.find(p => p.id === data.player.id)) return prev;
            return [...prev, data.player];
          });
        }
        if (data.type === 'PLAYER_ANSWER') {
          handlePlayerAnswer(data.playerId, data.answer);
        }
      });
    });

    await fetchNewQuestions();
    setGameState(GameState.JOINING);
    setRole(GameRole.HOST);
    setIsSyncing(false);
  };

  const fetchNewQuestions = async () => {
    setIsSyncing(true);
    try {
      const q = await generateBigBangQuestions(usedQuestionTexts.current);
      setQuestions(q);
      q.forEach(item => usedQuestionTexts.current.push(item.text));
      setCurrentIndex(-1);
    } catch (e) {
      console.error("Fetch questions failed", e);
    } finally {
      setIsSyncing(false);
    }
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
          // 偵測下一題
          if (data.currentQuestionIndex !== currentIndex) {
            setShuffledMembers(shuffleArray(MEMBERS));
          }
          
          setGameState(data.gameState);
          setCurrentIndex(data.currentQuestionIndex);
          setPlayers(data.players);
          setQuestions(data.questions || []);
          
          // 更新本地玩家分數
          setCurrentPlayer(p => {
            if (!p) return null;
            const match = data.players.find((pl: Player) => pl.id === p.id);
            return match ? { ...p, score: match.score, lastAnswer: match.lastAnswer, isCorrect: match.isCorrect } : p;
          });
        }
      });
    });
  };

  const sendSyncMessage = (conn: DataConnection) => {
    if (conn.open) {
      conn.send({
        type: 'SYNC_STATE',
        gameState,
        currentQuestionIndex: currentIndex,
        players,
        questions,
        sessionId
      });
    }
  };

  const broadcast = useCallback(() => {
    connectionsRef.current.forEach(conn => sendSyncMessage(conn));
  }, [gameState, currentIndex, players, questions, sessionId]);

  // 母體狀態異動，即時同步
  useEffect(() => {
    if (role === GameRole.HOST && peerStatus === 'CONNECTED') {
      broadcast();
    }
  }, [gameState, currentIndex, players, questions, role, peerStatus, broadcast]);

  // --- 核心計分邏輯 ---

  const handlePlayerAnswer = (playerId: string, answer: string) => {
    setPlayers(prev => {
      const updated = prev.map(p => {
        if (p.id === playerId) {
          if (p.lastAnswer) return p; // 防止重複計分
          
          const correctStr = (questions[currentIndex]?.correctAnswer || "").toLowerCase().replace(/[^a-z]/g, '');
          const playerStr = answer.toLowerCase().replace(/[^a-z]/g, '');
          const isCorrect = playerStr === correctStr;
          
          return { 
            ...p, 
            lastAnswer: answer, 
            isCorrect, 
            score: isCorrect ? p.score + 100 : p.score 
          };
        }
        return p;
      });
      return updated;
    });
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setPlayers(prev => prev.map(p => ({ ...p, lastAnswer: undefined, isCorrect: undefined })));
      setCurrentIndex(prev => prev + 1);
      setGameState(GameState.QUESTION);
    } else {
      setGameState(GameState.FINISHED);
    }
  };

  const submitAnswer = (answer: string) => {
    if (!currentPlayer || currentPlayer.lastAnswer || gameState !== GameState.QUESTION) return;
    
    // 手機端先本地標註，提升反應速度
    setCurrentPlayer(prev => prev ? { ...prev, lastAnswer: answer } : null);
    
    if (hostConnRef.current?.open) {
      hostConnRef.current.send({ 
        type: 'PLAYER_ANSWER', 
        playerId: currentPlayer.id, 
        answer 
      });
    }
  };

  const joinGame = (name: string) => {
    const newId = 'VIP-' + Math.random().toString(36).substring(7).toUpperCase();
    const newPlayer: Player = { id: newId, name, score: 0 };
    setCurrentPlayer(newPlayer);
    hostConnRef.current?.send({ type: 'PLAYER_JOIN', player: newPlayer });
  };

  const playerJoinUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('role', 'player');
    url.searchParams.set('session', sessionId || '');
    return url.toString();
  }, [sessionId]);

  // --- UI ---

  if (role === GameRole.LOBBY) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
        <div className="text-center space-y-12">
          <div className="relative inline-block">
            <h1 className="text-8xl font-black italic bigbang-yellow tracking-tighter drop-shadow-[0_0_40px_rgba(255,240,0,0.6)] animate-pulse">BIGBANG</h1>
            <div className="absolute -top-10 -right-10 rotate-12">{CROWN_SVG(64, COLORS.GOLD)}</div>
          </div>
          <button 
            onClick={setupHostPeer}
            disabled={isSyncing}
            className="w-full max-w-sm bg-yellow-400 text-black font-black py-8 rounded-[2.5rem] hover:scale-105 active:scale-95 transition-all shadow-[0_20px_50px_rgba(255,240,0,0.3)] text-3xl uppercase tracking-widest disabled:opacity-50"
          >
            {isSyncing ? 'AI 準備題目中...' : '啟動 VIP 母體'}
          </button>
        </div>
      </div>
    );
  }

  if (role === GameRole.HOST) {
    return (
      <div className="min-h-screen p-8 max-w-6xl mx-auto flex flex-col bg-black">
        <header className="flex justify-between items-end mb-10 border-b-2 border-yellow-400/20 pb-5">
          <div>
            <h1 className="text-5xl font-black italic bigbang-yellow tracking-tighter">VIP MOTHERBOARD</h1>
            <div className="flex items-center gap-3 mt-2">
              <div className={`w-3 h-3 rounded-full ${peerStatus === 'CONNECTED' ? 'bg-green-500 shadow-[0_0_10px_green]' : 'bg-red-500'}`} />
              <span className="text-xs text-white/40 font-mono">ROOM ID: {sessionId}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-yellow-400 font-black text-3xl">ONLINE VIPs: {players.length}</div>
          </div>
        </header>

        <main className="flex-1 flex flex-col justify-center overflow-hidden">
          {gameState === GameState.JOINING && (
            <div className="text-center space-y-10 animate-in zoom-in duration-500">
              <h2 className="text-6xl font-black uppercase tracking-tight mb-4">掃描 QR CODE 加入戰場</h2>
              <div className="bg-white p-6 rounded-[3rem] inline-block shadow-[0_0_100px_rgba(255,240,0,0.2)] border-8 border-yellow-400">
                <QRCode value={playerJoinUrl} size={300} />
              </div>
              <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
                {players.map(p => (
                  <div key={p.id} className="bg-yellow-400 text-black px-6 py-2 rounded-full font-black text-xl animate-bounce shadow-xl">{p.name}</div>
                ))}
              </div>
              <button onClick={nextQuestion} disabled={players.length === 0} className="bg-white text-black px-20 py-6 rounded-full font-black text-4xl hover:bg-yellow-400 transition-all disabled:opacity-20 shadow-2xl active:scale-95">
                開始比賽
              </button>
            </div>
          )}

          {gameState === GameState.QUESTION && (
            <div className="text-center space-y-12 animate-in fade-in slide-in-from-bottom-5">
              <div className="space-y-6">
                <span className="bg-yellow-400 text-black px-10 py-2 rounded-full font-black text-xl uppercase italic shadow-lg">第 {currentIndex + 1} 題 / 共 {questions.length} 題</span>
                <h2 className="text-7xl font-black leading-tight drop-shadow-2xl max-w-5xl mx-auto">{questions[currentIndex]?.text}</h2>
                <div className="flex justify-center items-center gap-8 text-white/40 font-bold text-2xl uppercase tracking-[0.3em]">
                  <span>已完成作答:</span>
                  <span className="text-yellow-400 text-4xl">{players.filter(p => p.lastAnswer).length}</span>
                  <span>/</span>
                  <span>{players.length}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto">
                {MEMBERS.map(m => (
                  <div key={m.id} className="glass-card py-16 rounded-[3rem] border border-white/10 text-5xl font-black text-white/90 shadow-2xl hover:bg-white/10 transition-colors">
                    {m.stageName}
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-8 pt-6">
                <button onClick={() => setGameState(GameState.LEADERBOARD)} className="bg-white/10 px-12 py-5 rounded-2xl font-black hover:bg-white/20 transition-all uppercase tracking-widest text-xl border border-white/10">查看目前排名</button>
                <button onClick={nextQuestion} className="bg-yellow-400 text-black px-20 py-5 rounded-2xl font-black text-2xl hover:scale-110 transition-all shadow-2xl">公佈下一題</button>
              </div>
            </div>
          )}

          {(gameState === GameState.LEADERBOARD || gameState === GameState.FINISHED) && (
            <div className="space-y-10 animate-in fade-in duration-700">
               <h2 className="text-8xl font-black text-center italic bigbang-yellow tracking-tighter uppercase mb-12 drop-shadow-2xl">
                 {gameState === GameState.FINISHED ? 'FINAL KINGS' : 'CURRENT STANDINGS'}
               </h2>
               <div className="max-w-4xl mx-auto space-y-4">
                  {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                    <div key={p.id} className="glass-card flex items-center justify-between p-8 rounded-[2.5rem] border border-white/10 shadow-2xl transition-all hover:scale-[1.02]">
                      <div className="flex items-center gap-10">
                        <span className="text-5xl font-black text-white/10 w-12">{idx+1}</span>
                        <span className="text-3xl font-black tracking-tight">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="flex gap-2">
                          {idx === 0 && Array(3).fill(0).map((_, i) => <span key={i} className="animate-bounce">{CROWN_SVG(48, COLORS.GOLD)}</span>)}
                          {idx === 1 && Array(2).fill(0).map((_, i) => <span key={i} className="animate-bounce">{CROWN_SVG(40, COLORS.SILVER)}</span>)}
                          {idx === 2 && Array(1).fill(0).map((_, i) => <span key={i} className="animate-bounce">{CROWN_SVG(32, COLORS.BRONZE)}</span>)}
                        </div>
                        <span className="text-5xl font-mono text-yellow-400 font-black drop-shadow-[0_0_10px_rgba(255,240,0,0.5)]">{p.score}</span>
                      </div>
                    </div>
                  ))}
               </div>
               <div className="flex justify-center gap-8 mt-12">
                 {gameState === GameState.LEADERBOARD ? (
                   <button onClick={nextQuestion} className="bg-yellow-400 text-black px-24 py-6 rounded-3xl font-black text-3xl hover:scale-110 transition-all shadow-2xl">下一題挑戰</button>
                 ) : (
                   <button onClick={fetchNewQuestions} disabled={isSyncing} className="bg-white/10 px-16 py-6 rounded-3xl font-black text-xl hover:bg-white/20 uppercase tracking-widest border border-white/10">
                     {isSyncing ? '正在重啟戰場...' : '再戰 10 題 (題目不重複)'}
                   </button>
                 )}
               </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // --- 玩家端 ---
  if (role === GameRole.PLAYER) {
    if (peerStatus === 'CONNECTING') return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-8">
          <div className="w-20 h-20 border-8 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto shadow-[0_0_30px_yellow]" />
          <p className="bigbang-yellow font-black animate-pulse tracking-widest text-2xl">VIP 專線連線中</p>
        </div>
      </div>
    );

    if (!currentPlayer) return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
        <form onSubmit={(e) => {
          e.preventDefault();
          const n = (e.currentTarget.elements.namedItem('playername') as HTMLInputElement).value;
          if (n) joinGame(n);
        }} className="w-full max-w-sm space-y-12">
          <div className="text-center space-y-4">
            <h1 className="text-6xl font-black bigbang-yellow italic tracking-tighter drop-shadow-lg">VIP JOIN</h1>
            <p className="text-white/20 text-xs font-bold uppercase tracking-[0.4em]">ENTER STAGE NAME</p>
          </div>
          <input name="playername" required maxLength={12} placeholder="你的暱稱..." className="w-full bg-white/5 border-2 border-white/10 p-8 rounded-[2.5rem] text-4xl font-black text-center text-white outline-none focus:border-yellow-400 transition-all shadow-inner uppercase" />
          <button className="w-full bg-yellow-400 text-black font-black py-8 rounded-[2.5rem] text-3xl shadow-2xl active:scale-95 transition-all uppercase tracking-widest">進入戰場</button>
        </form>
      </div>
    );

    return (
      <div className="min-h-screen p-6 flex flex-col bg-zinc-950">
        <header className="flex justify-between items-center mb-12 border-b border-white/10 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-yellow-400 text-black font-black flex items-center justify-center rounded-2xl italic text-3xl shadow-lg">V</div>
            <span className="font-black text-2xl text-white truncate max-w-[180px] uppercase tracking-tighter">{currentPlayer.name}</span>
          </div>
          <div className="text-right">
            <span className="bigbang-yellow font-black text-4xl leading-none">{currentPlayer.score}</span>
            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">TOTAL SCORE</p>
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING ? (
            <div className="text-center space-y-10">
              <p className="text-9xl drop-shadow-[0_0_20px_rgba(255,240,0,0.4)]">👑</p>
              <h2 className="text-4xl font-black text-white uppercase italic tracking-tighter animate-pulse">連線成功</h2>
              <p className="text-white/40 font-bold text-lg">請緊盯大螢幕，遊戲即將開始！</p>
            </div>
          ) : gameState === GameState.QUESTION ? (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-500">
               <div className="text-center bg-white/5 p-8 rounded-[2.5rem] border border-white/10 shadow-2xl">
                  <p className="text-yellow-400 font-black text-sm mb-4 uppercase italic tracking-widest">QUESTION {currentIndex + 1}</p>
                  <h3 className="text-3xl font-bold text-white leading-snug">{questions[currentIndex]?.text}</h3>
               </div>
               <div className="grid gap-5">
                {shuffledMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => submitAnswer(m.stageName)}
                    disabled={!!currentPlayer.lastAnswer}
                    className={`p-8 rounded-[2.5rem] text-3xl font-black transition-all border-4 ${
                      currentPlayer.lastAnswer === m.stageName 
                        ? 'bg-yellow-400 text-black border-yellow-400 scale-105 shadow-[0_0_40px_rgba(255,240,0,0.4)]'
                        : 'bg-white/5 text-white border-white/10'
                    } disabled:opacity-50 uppercase tracking-tighter`}
                  >
                    {m.stageName}
                  </button>
                ))}
               </div>
               {currentPlayer.lastAnswer && (
                 <div className="text-center py-4 space-y-2">
                   <p className="text-yellow-400 font-black text-2xl uppercase italic animate-bounce tracking-widest">ANSWER RECORDED!</p>
                   <p className="text-white/20 text-xs font-bold uppercase">正在與母體核對計分...</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="text-center space-y-10 animate-in fade-in">
              <h2 className="text-5xl font-black bigbang-yellow italic uppercase tracking-tighter drop-shadow-2xl">
                {gameState === GameState.FINISHED ? 'FINAL RESULTS' : 'LIVE BOARD'}
              </h2>
              <div className="space-y-4">
                 {[...players].sort((a,b) => b.score - a.score).slice(0, 5).map((p, idx) => (
                   <div key={p.id} className={`p-6 rounded-[2rem] flex justify-between items-center transition-all ${p.id === currentPlayer.id ? 'bg-yellow-400/20 border-2 border-yellow-400/50 shadow-[0_0_20px_rgba(255,240,0,0.1)]' : 'bg-white/5'}`}>
                      <div className="flex items-center gap-5">
                        <span className="font-black text-white/20 text-2xl">{idx+1}</span>
                        <span className="font-bold text-white uppercase text-xl">{p.name} {p.id === currentPlayer.id ? '(YOU)' : ''}</span>
                      </div>
                      <span className="font-mono text-yellow-400 font-black text-3xl">{p.score}</span>
                   </div>
                 ))}
              </div>
              <p className="text-white/20 text-sm font-bold uppercase animate-pulse tracking-widest">WAITING FOR MOTHERBOARD...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
