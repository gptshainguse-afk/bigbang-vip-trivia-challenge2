
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

  // --- 連線邏輯 ---

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
        // 初次同步目前的完整狀態
        conn.send({
          type: 'SYNC_STATE',
          gameState,
          currentQuestionIndex: currentIndex,
          players,
          questions,
          sessionId: sid
        });
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
    const q = await generateBigBangQuestions(usedQuestionTexts.current);
    setQuestions(q);
    q.forEach(item => usedQuestionTexts.current.push(item.text));
    setCurrentIndex(-1);
    setIsSyncing(false);
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
          // 偵測題號是否改變，若是則重置本地狀態
          setCurrentIndex(prevIndex => {
            if (data.currentQuestionIndex !== prevIndex) {
              setCurrentPlayer(p => p ? { ...p, lastAnswer: undefined, isCorrect: undefined } : null);
              setShuffledMembers(shuffleArray(MEMBERS));
            }
            return data.currentQuestionIndex;
          });
          
          setGameState(data.gameState);
          setPlayers(data.players);
          setQuestions(data.questions || []);
          
          // 更新玩家自己的本地統計數據
          setCurrentPlayer(p => {
            if (!p) return null;
            const updated = data.players.find((player: Player) => player.id === p.id);
            return updated ? { ...p, score: updated.score, lastAnswer: updated.lastAnswer } : p;
          });
        }
      });

      conn.on('close', () => setPeerStatus('ERROR'));
    });
  };

  const broadcast = useCallback((data: any) => {
    connectionsRef.current.forEach(conn => {
      if (conn.open) conn.send(data);
    });
  }, []);

  // 母體狀態改變時，立即廣播給所有人
  useEffect(() => {
    if (role === GameRole.HOST && peerStatus === 'CONNECTED') {
      broadcast({
        type: 'SYNC_STATE',
        gameState,
        currentQuestionIndex: currentIndex,
        players,
        questions,
        sessionId
      });
    }
  }, [gameState, currentIndex, players, questions, role, peerStatus, broadcast, sessionId]);

  // --- 遊戲邏輯 ---

  const handlePlayerAnswer = (playerId: string, answer: string) => {
    setPlayers(prev => {
      const updated = prev.map(p => {
        if (p.id === playerId) {
          if (p.lastAnswer) return p; // 防止重複作答
          
          const correctAns = questions[currentIndex]?.correctAnswer?.trim() || "";
          // 規範化比對邏輯
          const isCorrect = answer.replace(/\s/g, '').toLowerCase() === correctAns.replace(/\s/g, '').toLowerCase();
          
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
      // 下一題前，清除所有人的當題作答紀錄
      setPlayers(prev => prev.map(p => ({ ...p, lastAnswer: undefined, isCorrect: undefined })));
      setCurrentIndex(prev => prev + 1);
      setGameState(GameState.QUESTION);
    } else {
      setGameState(GameState.FINISHED);
    }
  };

  const submitAnswer = (answer: string) => {
    if (!currentPlayer || currentPlayer.lastAnswer || gameState !== GameState.QUESTION) return;
    
    // 手機端先標註為已答
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

  // --- UI 組件 ---

  if (role === GameRole.LOBBY) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center space-y-12 bg-black">
        <div className="relative">
          <h1 className="text-8xl font-black italic bigbang-yellow tracking-tighter drop-shadow-[0_0_30px_rgba(255,240,0,0.5)]">BIGBANG</h1>
          <div className="absolute -top-6 -right-6 rotate-12">{CROWN_SVG(48, COLORS.GOLD)}</div>
        </div>
        <button 
          onClick={setupHostPeer}
          disabled={isSyncing}
          className="w-full max-w-sm bg-yellow-400 text-black font-black py-6 rounded-2xl hover:bg-yellow-300 transition-all shadow-xl text-2xl uppercase tracking-widest disabled:opacity-50"
        >
          {isSyncing ? '正在生成 10 題問答...' : '啟動投影幕'}
        </button>
      </div>
    );
  }

  if (role === GameRole.HOST) {
    return (
      <div className="min-h-screen p-8 max-w-6xl mx-auto flex flex-col bg-black overflow-hidden">
        <header className="flex justify-between items-end mb-8 border-b-2 border-yellow-400/20 pb-4">
          <div>
            <h1 className="text-4xl font-black italic bigbang-yellow tracking-tighter">BIGBANG MOTHER</h1>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${peerStatus === 'CONNECTED' ? 'bg-green-500 shadow-[0_0_5px_green]' : 'bg-red-500 animate-pulse'}`} />
              <span className="text-[10px] text-white/40 font-mono tracking-widest">SESSION: {sessionId}</span>
            </div>
          </div>
          <div className="text-right text-yellow-400 font-black text-xl">VIPs: {players.length}</div>
        </header>

        <main className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING && (
            <div className="text-center space-y-8 animate-in zoom-in duration-500">
              <h2 className="text-5xl font-black uppercase tracking-tight">掃描 QR CODE 加入 VIP ARENA</h2>
              <div className="bg-white p-4 rounded-3xl inline-block shadow-[0_0_80px_rgba(255,240,0,0.1)] border-4 border-yellow-400">
                <QRCode value={playerJoinUrl} size={280} />
              </div>
              <div className="flex flex-wrap justify-center gap-3 max-w-2xl mx-auto">
                {players.map(p => (
                  <div key={p.id} className="bg-yellow-400 text-black px-5 py-2 rounded-full font-black animate-bounce shadow-lg">{p.name}</div>
                ))}
              </div>
              <button onClick={nextQuestion} disabled={players.length === 0} className="bg-white text-black px-16 py-4 rounded-full font-black text-3xl hover:bg-yellow-400 transition-all disabled:opacity-20 shadow-2xl active:scale-95">
                開始挑戰
              </button>
            </div>
          )}

          {gameState === GameState.QUESTION && (
            <div className="text-center space-y-12 animate-in fade-in slide-in-from-bottom-5">
              <div className="space-y-4">
                <span className="bg-yellow-400 text-black px-8 py-2 rounded-full font-black text-lg uppercase tracking-widest italic">第 {currentIndex + 1} 題</span>
                <h2 className="text-7xl font-black leading-tight drop-shadow-xl">{questions[currentIndex]?.text}</h2>
                <p className="text-white/40 font-bold text-xl uppercase tracking-widest">已作答: {players.filter(p => p.lastAnswer).length} / {players.length}</p>
              </div>
              <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto">
                {MEMBERS.map(m => (
                  <div key={m.id} className="glass-card py-12 rounded-[2.5rem] border border-white/10 text-4xl font-black text-white/90 shadow-2xl">
                    {m.stageName}
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-6">
                <button onClick={() => setGameState(GameState.LEADERBOARD)} className="bg-white/10 px-10 py-4 rounded-2xl font-black hover:bg-white/20 transition-all uppercase tracking-widest">中場戰況</button>
                <button onClick={nextQuestion} className="bg-yellow-400 text-black px-16 py-4 rounded-2xl font-black text-xl hover:scale-110 transition-all shadow-2xl">下一題</button>
              </div>
            </div>
          )}

          {(gameState === GameState.LEADERBOARD || gameState === GameState.FINISHED) && (
            <div className="space-y-10 animate-in fade-in duration-700">
               <h2 className="text-7xl font-black text-center italic bigbang-yellow tracking-tighter uppercase mb-8">
                 {gameState === GameState.FINISHED ? 'THE ULTIMATE VIP' : '當前排行榜'}
               </h2>
               <div className="max-w-3xl mx-auto space-y-4">
                  {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                    <div key={p.id} className="glass-card flex items-center justify-between p-6 rounded-3xl border border-white/5 shadow-lg">
                      <div className="flex items-center gap-8">
                        <span className="text-4xl font-black text-white/20 w-10">{idx+1}</span>
                        <span className="text-2xl font-black tracking-tight">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="flex gap-2">
                          {idx === 0 && Array(3).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(36, COLORS.GOLD)}</span>)}
                          {idx === 1 && Array(2).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(30, COLORS.SILVER)}</span>)}
                          {idx === 2 && Array(1).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(26, COLORS.BRONZE)}</span>)}
                        </div>
                        <span className="text-4xl font-mono text-yellow-400 font-black">{p.score}</span>
                      </div>
                    </div>
                  ))}
               </div>
               <div className="flex justify-center gap-6 mt-8">
                 {gameState === GameState.LEADERBOARD ? (
                   <button onClick={nextQuestion} className="bg-yellow-400 text-black px-20 py-5 rounded-full font-black text-2xl hover:scale-110 transition-all shadow-2xl">進入下一題</button>
                 ) : (
                   <button onClick={fetchNewQuestions} disabled={isSyncing} className="bg-white/10 px-12 py-5 rounded-full font-black text-lg hover:bg-white/20 uppercase tracking-widest">
                     {isSyncing ? '生成中...' : '再戰 10 題 (不重複)'}
                   </button>
                 )}
               </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // 參賽者手機端
  if (role === GameRole.PLAYER) {
    if (peerStatus === 'CONNECTING') return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-6">
          <div className="w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto shadow-[0_0_15px_yellow]" />
          <p className="bigbang-yellow font-black animate-pulse tracking-widest text-xl">VIP 專線連線中...</p>
        </div>
      </div>
    );

    if (!currentPlayer) return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
        <form onSubmit={(e) => {
          e.preventDefault();
          const n = (e.currentTarget.elements.namedItem('playername') as HTMLInputElement).value;
          if (n) joinGame(n);
        }} className="w-full max-w-xs space-y-10">
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-black bigbang-yellow italic tracking-tighter">VIP JOIN</h1>
            <p className="text-white/30 text-xs font-bold uppercase tracking-[0.2em]">Enter Your Stage Name</p>
          </div>
          <input name="playername" required maxLength={10} placeholder="輸入你的暱稱..." className="w-full bg-white/5 border-2 border-white/10 p-6 rounded-[2rem] text-3xl font-bold text-center text-white outline-none focus:border-yellow-400 transition-all shadow-inner" />
          <button className="w-full bg-yellow-400 text-black font-black py-6 rounded-[2rem] text-2xl shadow-2xl active:scale-95 transition-all uppercase tracking-widest">入場</button>
        </form>
      </div>
    );

    return (
      <div className="min-h-screen p-6 flex flex-col bg-zinc-950">
        <header className="flex justify-between items-center mb-10 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-400 text-black font-black flex items-center justify-center rounded-xl italic">V</div>
            <span className="font-black text-xl text-white truncate max-w-[150px] uppercase">{currentPlayer.name}</span>
          </div>
          <div className="text-right">
            <span className="bigbang-yellow font-black text-3xl leading-none">{currentPlayer.score}</span>
            <p className="text-[10px] text-white/30 font-bold uppercase tracking-tighter">Current Score</p>
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING ? (
            <div className="text-center space-y-6">
              <p className="text-8xl drop-shadow-[0_0_15px_rgba(255,240,0,0.3)]">👑</p>
              <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter animate-pulse">連線成功</h2>
              <p className="text-white/40 font-bold text-sm">請盯緊大螢幕，等待母體啟動遊戲...</p>
            </div>
          ) : gameState === GameState.QUESTION ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-500">
               <div className="text-center bg-white/5 p-6 rounded-[2rem] border border-white/10 shadow-lg">
                  <p className="text-yellow-400 font-black text-sm mb-2 uppercase italic tracking-widest">Question {currentIndex + 1}</p>
                  <h3 className="text-2xl font-bold text-white leading-tight">{questions[currentIndex]?.text}</h3>
               </div>
               <div className="grid gap-4">
                {shuffledMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => submitAnswer(m.stageName)}
                    disabled={!!currentPlayer.lastAnswer}
                    className={`p-6 rounded-[2rem] text-2xl font-black transition-all border-4 ${
                      currentPlayer.lastAnswer === m.stageName 
                        ? 'bg-yellow-400 text-black border-yellow-400 scale-105 shadow-[0_0_30px_rgba(255,240,0,0.3)]'
                        : 'bg-white/5 text-white border-white/10'
                    } disabled:opacity-40 uppercase`}
                  >
                    {m.stageName}
                  </button>
                ))}
               </div>
               {currentPlayer.lastAnswer && (
                 <div className="text-center animate-bounce py-2">
                   <p className="text-yellow-400 font-black text-xl uppercase italic">Answer Sent!</p>
                   <p className="text-white/20 text-xs font-bold">等待母體公佈正確答案...</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="text-center space-y-8 animate-in fade-in">
              <h2 className="text-4xl font-black bigbang-yellow italic uppercase tracking-tighter drop-shadow-lg">
                {gameState === GameState.FINISHED ? 'FINAL RESULTS' : 'LIVE RANKING'}
              </h2>
              <div className="space-y-3">
                 {[...players].sort((a,b) => b.score - a.score).slice(0, 8).map((p, idx) => (
                   <div key={p.id} className={`p-5 rounded-2xl flex justify-between items-center ${p.id === currentPlayer.id ? 'bg-yellow-400/20 border-2 border-yellow-400/40' : 'bg-white/5 border border-white/5'}`}>
                      <div className="flex items-center gap-4">
                        <span className="font-black text-white/20 text-xl">{idx+1}</span>
                        <span className="font-bold text-white uppercase tracking-tight">{p.name} {p.id === currentPlayer.id ? '(YOU)' : ''}</span>
                        {idx < 3 && <div className="flex gap-0.5">{Array(3-idx).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(16)}</span>)}</div>}
                      </div>
                      <span className="font-mono text-yellow-400 font-black text-xl">{p.score}</span>
                   </div>
                 ))}
              </div>
              <p className="text-white/30 text-xs font-bold uppercase animate-pulse">等待主持人進行下一步...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
