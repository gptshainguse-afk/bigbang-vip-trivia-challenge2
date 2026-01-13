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
        // 初次同步
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
          // 判斷是否進到下一題（題號改變）
          if (data.currentQuestionIndex !== currentIndex) {
            setCurrentPlayer(p => p ? { ...p, lastAnswer: undefined, isCorrect: undefined } : null);
            setShuffledMembers(shuffleArray(MEMBERS));
          }
          
          setGameState(data.gameState);
          setCurrentIndex(data.currentQuestionIndex);
          setPlayers(data.players);
          setQuestions(data.questions || []);
          
          // 更新玩家自己的本地分數
          setCurrentPlayer(p => {
            if (!p) return null;
            const hostData = data.players.find((player: Player) => player.id === p.id);
            return hostData ? { ...p, score: hostData.score, lastAnswer: hostData.lastAnswer } : p;
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

  // 當母體任何狀態改變，立即廣播給所有人
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
          // 寬容比對：移除空格且不分大小寫
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
      // 母體點擊下一題前，先清空所有玩家的「當題作答紀錄」
      setPlayers(prev => prev.map(p => ({ ...p, lastAnswer: undefined, isCorrect: undefined })));
      setCurrentIndex(prev => prev + 1);
      setGameState(GameState.QUESTION);
      setShuffledMembers(shuffleArray(MEMBERS));
    } else {
      setGameState(GameState.FINISHED);
    }
  };

  const submitAnswer = (answer: string) => {
    if (!currentPlayer || currentPlayer.lastAnswer || gameState !== GameState.QUESTION) return;
    
    // 本地預先標註已答
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
          {isSyncing ? 'AI 正在準備中文題目...' : '啟動母體投影'}
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
              <div className={`w-2 h-2 rounded-full ${peerStatus === 'CONNECTED' ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-[10px] text-white/40 font-mono">ROOM: {sessionId}</span>
            </div>
          </div>
          <div className="text-right text-yellow-400 font-black text-xl">VIPs: {players.length}</div>
        </header>

        <main className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING && (
            <div className="text-center space-y-8 animate-in zoom-in duration-500">
              <h2 className="text-5xl font-black uppercase">掃描 QR CODE 加入 VIP 區</h2>
              <div className="bg-white p-4 rounded-3xl inline-block shadow-[0_0_60px_rgba(255,240,0,0.1)] border-4 border-yellow-400">
                <QRCode value={playerJoinUrl} size={250} />
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {players.map(p => (
                  <div key={p.id} className="bg-yellow-400 text-black px-4 py-1 rounded-full font-black animate-bounce">{p.name}</div>
                ))}
              </div>
              <button onClick={nextQuestion} disabled={players.length === 0} className="bg-white text-black px-16 py-4 rounded-full font-black text-2xl hover:bg-yellow-400 transition-all disabled:opacity-20">
                所有人已就緒，開始！
              </button>
            </div>
          )}

          {gameState === GameState.QUESTION && (
            <div className="text-center space-y-10 animate-in fade-in slide-in-from-bottom-5">
              <div className="space-y-4">
                <span className="bg-yellow-400 text-black px-6 py-1 rounded-full font-black text-sm">第 {currentIndex + 1} / {questions.length} 題</span>
                <h2 className="text-6xl font-black leading-tight">{questions[currentIndex]?.text}</h2>
                <p className="text-white/40 font-bold">已答：{players.filter(p => p.lastAnswer).length} / {players.length}</p>
              </div>
              <div className="grid grid-cols-2 gap-6 max-w-4xl mx-auto">
                {MEMBERS.map(m => (
                  <div key={m.id} className="glass-card py-10 rounded-3xl border border-white/10 text-3xl font-black text-white/80">
                    {m.stageName}
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-4">
                <button onClick={() => setGameState(GameState.LEADERBOARD)} className="bg-white/10 px-8 py-3 rounded-xl font-bold hover:bg-white/20">查看分數</button>
                <button onClick={nextQuestion} className="bg-yellow-400 text-black px-12 py-3 rounded-xl font-black shadow-lg">下一題</button>
              </div>
            </div>
          )}

          {(gameState === GameState.LEADERBOARD || gameState === GameState.FINISHED) && (
            <div className="space-y-8 animate-in fade-in duration-700">
               <h2 className="text-6xl font-black text-center italic bigbang-yellow tracking-tighter uppercase">
                 {gameState === GameState.FINISHED ? 'THE ULTIMATE VIP' : '當前戰況'}
               </h2>
               <div className="max-w-2xl mx-auto space-y-3">
                  {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                    <div key={p.id} className="glass-card flex items-center justify-between p-5 rounded-2xl border border-white/5">
                      <div className="flex items-center gap-5">
                        <span className="text-2xl font-black text-white/20">{idx+1}</span>
                        <span className="text-xl font-black">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex gap-1">
                          {idx === 0 && Array(3).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(24, COLORS.GOLD)}</span>)}
                          {idx === 1 && Array(2).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(20, COLORS.SILVER)}</span>)}
                          {idx === 2 && Array(1).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(18, COLORS.BRONZE)}</span>)}
                        </div>
                        <span className="text-2xl font-mono text-yellow-400 font-black">{p.score}</span>
                      </div>
                    </div>
                  ))}
               </div>
               <div className="flex justify-center gap-4">
                 {gameState === GameState.LEADERBOARD ? (
                   <button onClick={nextQuestion} className="bg-yellow-400 text-black px-16 py-4 rounded-xl font-black text-xl shadow-2xl">下一題</button>
                 ) : (
                   <button onClick={fetchNewQuestions} disabled={isSyncing} className="bg-white/10 px-10 py-4 rounded-xl font-bold">
                     {isSyncing ? '生成中...' : '再玩 10 題 (不重複)'}
                   </button>
                 )}
               </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // 玩家視圖
  if (role === GameRole.PLAYER) {
    if (peerStatus === 'CONNECTING') return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="bigbang-yellow font-black animate-pulse">連線至母體中...</p>
        </div>
      </div>
    );

    if (!currentPlayer) return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
        <form onSubmit={(e) => {
          e.preventDefault();
          const n = (e.currentTarget.elements.namedItem('playername') as HTMLInputElement).value;
          if (n) joinGame(n);
        }} className="w-full max-w-xs space-y-8">
          <h1 className="text-4xl font-black bigbang-yellow italic text-center">VIP JOIN</h1>
          <input name="playername" required maxLength={8} placeholder="輸入暱稱..." className="w-full bg-white/5 border-2 border-white/10 p-5 rounded-2xl text-2xl font-bold text-center text-white outline-none focus:border-yellow-400" />
          <button className="w-full bg-yellow-400 text-black font-black py-5 rounded-2xl text-xl shadow-xl">進入會場</button>
        </form>
      </div>
    );

    return (
      <div className="min-h-screen p-5 flex flex-col bg-zinc-950">
        <header className="flex justify-between items-center mb-6 border-b border-white/10 pb-3">
          <span className="font-black text-lg text-white truncate">{currentPlayer.name}</span>
          <div className="text-right">
            <span className="bigbang-yellow font-black text-xl">{currentPlayer.score}</span>
            <p className="text-[10px] text-white/30 font-bold">SCORE</p>
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING ? (
            <div className="text-center space-y-4">
              <p className="text-4xl">👑</p>
              <h2 className="text-2xl font-black text-white">已連線</h2>
              <p className="text-white/40 text-sm">請看大螢幕，等待母體啟動...</p>
            </div>
          ) : gameState === GameState.QUESTION ? (
            <div className="space-y-5">
               <div className="text-center bg-white/5 p-5 rounded-2xl border border-white/10">
                  <p className="text-yellow-400 font-black text-xs mb-1">Q{currentIndex + 1}</p>
                  <h3 className="text-lg font-bold text-white">{questions[currentIndex]?.text}</h3>
               </div>
               <div className="grid gap-3">
                {shuffledMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => submitAnswer(m.stageName)}
                    disabled={!!currentPlayer.lastAnswer}
                    className={`p-5 rounded-2xl text-xl font-black transition-all border-2 ${
                      currentPlayer.lastAnswer === m.stageName 
                        ? 'bg-yellow-400 text-black border-yellow-400 scale-105'
                        : 'bg-white/5 text-white border-white/5'
                    } disabled:opacity-40`}
                  >
                    {m.stageName}
                  </button>
                ))}
               </div>
               {currentPlayer.lastAnswer && (
                 <div className="text-center animate-pulse py-2">
                   <p className="text-yellow-400 font-black">答案已送達母體！</p>
                   <p className="text-white/20 text-[10px]">等待母體揭曉...</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="text-center space-y-6">
              <h2 className="text-3xl font-black bigbang-yellow italic">RANKING</h2>
              <div className="space-y-2">
                 {players.sort((a,b) => b.score - a.score).slice(0, 5).map((p, idx) => (
                   <div key={p.id} className={`p-3 rounded-xl flex justify-between ${p.id === currentPlayer.id ? 'bg-yellow-400/20 border border-yellow-400/30' : 'bg-white/5'}`}>
                      <span className="font-bold text-white/50">{idx+1} {p.name}</span>
                      <span className="font-mono text-yellow-400">{p.score}</span>
                   </div>
                 ))}
              </div>
              <p className="text-white/20 text-xs">請等候下一波題目生成</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
