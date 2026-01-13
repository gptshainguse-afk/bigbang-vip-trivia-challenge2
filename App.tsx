
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

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const hostConnRef = useRef<DataConnection | null>(null);

  // --- 初始化與連線邏輯 ---

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

  // 母體端 Peer 設定
  const setupHostPeer = async () => {
    setIsSyncing(true);
    const sid = Math.random().toString(36).substring(2, 8).toUpperCase();
    setSessionId(sid);
    
    const peer = new Peer(`BB-TRIVIA-${sid}`);
    peerRef.current = peer;

    peer.on('open', () => {
      setPeerStatus('CONNECTED');
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        connectionsRef.current.set(conn.peer, conn);
        sendToConnection(conn, {
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

      conn.on('close', () => {
        connectionsRef.current.delete(conn.peer);
      });
    });

    const q = await generateBigBangQuestions();
    setQuestions(q);
    setGameState(GameState.JOINING);
    setRole(GameRole.HOST);
    setIsSyncing(false);
  };

  // 玩家端 Peer 設定
  const setupPlayerPeer = (targetSid: string) => {
    setPeerStatus('CONNECTING');
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(`BB-TRIVIA-${targetSid}`);
      hostConnRef.current = conn;

      conn.on('open', () => {
        setPeerStatus('CONNECTED');
      });

      conn.on('data', (data: any) => {
        if (data.type === 'SYNC_STATE') {
          // 偵測題號是否改變
          setGameState(prevGameState => {
            setCurrentIndex(prevIndex => {
              // 如果題號變了，重置玩家本地答題狀態
              if (data.currentQuestionIndex !== prevIndex) {
                setCurrentPlayer(p => p ? { ...p, lastAnswer: undefined, isCorrect: undefined } : null);
                setShuffledMembers(shuffleArray(MEMBERS));
              }
              return data.currentQuestionIndex;
            });
            return data.gameState;
          });
          
          setPlayers(data.players);
          setQuestions(data.questions || []);
          
          // 更新本地玩家的分數
          setCurrentPlayer(p => {
            if (!p) return null;
            const updated = data.players.find((player: Player) => player.id === p.id);
            return updated ? { ...p, score: updated.score } : p;
          });
        }
      });

      conn.on('close', () => {
        setPeerStatus('ERROR');
      });
    });

    peer.on('error', () => {
      setPeerStatus('ERROR');
    });
  };

  const sendToConnection = (conn: DataConnection, data: any) => {
    if (conn.open) {
      conn.send(data);
    }
  };

  const broadcast = useCallback((data: any) => {
    connectionsRef.current.forEach(conn => {
      sendToConnection(conn, data);
    });
  }, []);

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
    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) {
        // 防止重複加分
        if (p.lastAnswer) return p;
        const isCorrect = answer === questions[currentIndex]?.correctAnswer;
        return { ...p, lastAnswer: answer, isCorrect, score: isCorrect ? p.score + 100 : p.score };
      }
      return p;
    }));
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      const nextIdx = currentIndex + 1;
      setPlayers(prev => prev.map(p => ({ ...p, lastAnswer: undefined, isCorrect: undefined })));
      setCurrentIndex(nextIdx);
      setGameState(GameState.QUESTION);
      setShuffledMembers(shuffleArray(MEMBERS));
    } else {
      setGameState(GameState.FINISHED);
    }
  };

  const submitAnswer = (answer: string) => {
    if (!currentPlayer || currentPlayer.lastAnswer || gameState !== GameState.QUESTION) return;
    
    // 更新本地顯示為已送出
    setCurrentPlayer(prev => prev ? { ...prev, lastAnswer: answer } : null);
    
    // 送往母體
    if (hostConnRef.current?.open) {
      hostConnRef.current.send({ 
        type: 'PLAYER_ANSWER', 
        playerId: currentPlayer.id, 
        answer 
      });
    }
  };

  const joinGame = (name: string) => {
    const newId = Math.random().toString(36).substring(7);
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
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <button 
            onClick={setupHostPeer}
            disabled={isSyncing}
            className="w-full bg-yellow-400 text-black font-black py-6 rounded-2xl hover:bg-yellow-300 transition-all shadow-xl text-2xl uppercase tracking-widest"
          >
            {isSyncing ? '正在生成中文題目...' : '開場 (母體投影)'}
          </button>
        </div>
        <p className="text-white/20 text-xs font-mono uppercase tracking-[0.2em]">Cross-Device P2P Powered</p>
      </div>
    );
  }

  if (role === GameRole.HOST) {
    return (
      <div className="min-h-screen p-8 max-w-6xl mx-auto flex flex-col bg-black">
        <header className="flex justify-between items-end mb-12 border-b-2 border-yellow-400/20 pb-6">
          <div>
            <h1 className="text-4xl font-black italic bigbang-yellow tracking-tighter">BIGBANG MOTHER</h1>
            <div className="flex items-center gap-2 mt-2">
              <div className={`w-3 h-3 rounded-full ${peerStatus === 'CONNECTED' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 animate-pulse'}`} />
              <span className="text-[10px] text-white/40 font-mono uppercase tracking-widest">
                {peerStatus === 'CONNECTED' ? 'Live Online' : 'Connecting Peer...'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-yellow-400 font-black text-2xl">VIPs: {players.length}</div>
            <div className="text-[10px] text-white/20 font-mono">ROOM: {sessionId}</div>
          </div>
        </header>

        <div className="flex-1">
          {gameState === GameState.JOINING && (
            <div className="text-center space-y-12 animate-in fade-in zoom-in duration-500">
              <h2 className="text-6xl font-black uppercase tracking-tight">手機掃描 QR CODE 加入</h2>
              <div className="bg-white p-6 rounded-[2.5rem] inline-block shadow-[0_0_100px_rgba(255,240,0,0.2)] border-8 border-yellow-400">
                <QRCode value={playerJoinUrl} size={300} />
              </div>
              <div className="flex flex-wrap justify-center gap-4">
                {players.map(p => (
                  <div key={p.id} className="bg-yellow-400 text-black px-6 py-2 rounded-full font-black text-xl animate-bounce">
                    {p.name}
                  </div>
                ))}
              </div>
              <button 
                onClick={nextQuestion}
                disabled={players.length === 0}
                className="bg-white text-black px-20 py-5 rounded-full font-black text-3xl hover:bg-yellow-400 transition-all disabled:opacity-30 shadow-2xl active:scale-95"
              >
                開始競賽
              </button>
            </div>
          )}

          {gameState === GameState.QUESTION && (
            <div className="w-full space-y-12 text-center animate-in fade-in slide-in-from-bottom-5">
              <div className="space-y-6">
                <div className="inline-block px-8 py-2 bg-yellow-400 text-black font-black rounded-full text-lg uppercase tracking-widest">
                  第 {currentIndex + 1} 題
                </div>
                <h2 className="text-5xl md:text-7xl font-black leading-tight drop-shadow-lg">{questions[currentIndex]?.text}</h2>
                <div className="text-white/40 font-bold uppercase tracking-widest">
                  已回答: {players.filter(p => p.lastAnswer).length} / {players.length}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
                {MEMBERS.map(m => (
                  <div key={m.id} className="glass-card p-12 rounded-[3rem] border-2 border-white/5 shadow-2xl">
                    <div className="text-4xl font-black text-white/90">{m.stageName}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-6">
                <button onClick={() => setGameState(GameState.LEADERBOARD)} className="bg-white/10 px-10 py-4 rounded-2xl font-black hover:bg-white/20 transition-all uppercase tracking-widest">即時排行榜</button>
                <button onClick={nextQuestion} className="bg-yellow-400 text-black px-12 py-4 rounded-2xl font-black hover:scale-110 transition-all shadow-2xl">下一題</button>
              </div>
            </div>
          )}

          {(gameState === GameState.LEADERBOARD || gameState === GameState.FINISHED) && (
            <div className="w-full space-y-10 animate-in fade-in duration-500">
               <h2 className="text-6xl font-black text-center mb-12 italic bigbang-yellow tracking-tighter uppercase">
                 {gameState === GameState.FINISHED ? '最終排名' : '即時戰況'}
               </h2>
               <div className="max-w-3xl mx-auto space-y-4">
                  {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                    <div key={p.id} className="glass-card flex items-center justify-between p-6 rounded-3xl border border-white/10">
                      <div className="flex items-center gap-6">
                        <span className="text-3xl font-black text-white/20 w-8">{idx+1}</span>
                        <span className="text-2xl font-black">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex gap-1">
                          {idx === 0 && Array(3).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(32, COLORS.GOLD)}</span>)}
                          {idx === 1 && Array(2).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(28, COLORS.SILVER)}</span>)}
                          {idx === 2 && Array(1).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(24, COLORS.BRONZE)}</span>)}
                        </div>
                        <span className="text-3xl font-mono text-yellow-400 font-black">{p.score}</span>
                      </div>
                    </div>
                  ))}
               </div>
               <div className="flex justify-center pt-10">
                 {gameState === GameState.LEADERBOARD ? (
                   <button onClick={nextQuestion} className="bg-yellow-400 text-black px-16 py-5 rounded-full font-black text-2xl hover:scale-110 transition-all shadow-2xl">進入下一輪</button>
                 ) : (
                   <button onClick={() => window.location.reload()} className="bg-white/10 px-12 py-4 rounded-full font-black text-sm hover:bg-white/20">重新開始遊戲</button>
                 )}
               </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 參賽者視圖
  if (role === GameRole.PLAYER) {
    if (peerStatus === 'CONNECTING') {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-zinc-950 text-center space-y-6">
          <div className="w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(255,240,0,0.5)]" />
          <h2 className="text-2xl font-black bigbang-yellow animate-pulse">連線中...</h2>
          <p className="text-white/20 text-xs font-bold tracking-widest uppercase">VIP Secure Connection</p>
        </div>
      );
    }

    if (!currentPlayer) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              const nameInput = e.currentTarget.elements.namedItem('playername') as HTMLInputElement;
              if (nameInput.value) joinGame(nameInput.value);
            }}
            className="w-full max-w-sm space-y-10 text-center"
          >
            <div className="space-y-4">
              <h1 className="text-5xl font-black bigbang-yellow italic tracking-tighter">VIP ARENA</h1>
              <p className="text-white/40 text-sm font-bold tracking-widest uppercase">請輸入你的名號參加比賽</p>
            </div>
            <input 
              name="playername"
              required
              maxLength={10}
              autoComplete="off"
              placeholder="名稱..."
              className="w-full bg-white/5 border-2 border-white/10 p-6 rounded-3xl text-3xl font-black focus:border-yellow-400 outline-none transition-all text-center uppercase tracking-widest text-white"
              autoFocus
            />
            <button className="w-full bg-yellow-400 text-black font-black py-6 rounded-3xl text-2xl shadow-2xl active:scale-95 transition-all">
              進入大廳
            </button>
          </form>
        </div>
      );
    }

    return (
      <div className="min-h-screen p-4 flex flex-col bg-zinc-950 max-w-lg mx-auto">
        <header className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-400 flex items-center justify-center text-black font-black text-xl italic">V</div>
            <div className="font-black text-xl uppercase text-white truncate max-w-[120px]">{currentPlayer.name}</div>
          </div>
          <div className="text-right">
            <div className="bigbang-yellow font-black text-2xl leading-none">{currentPlayer.score}</div>
            <div className="text-[10px] text-white/40 font-bold uppercase">POINTS</div>
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING ? (
            <div className="text-center space-y-8">
              <div className="text-8xl drop-shadow-[0_0_20px_rgba(255,240,0,0.5)]">👑</div>
              <h2 className="text-3xl font-black uppercase text-white animate-pulse">連線成功！</h2>
              <p className="text-white/40 text-sm">請看大螢幕，等待母體啟動遊戲...</p>
            </div>
          ) : gameState === GameState.QUESTION ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500">
               <div className="text-center space-y-2 bg-white/5 p-6 rounded-[2rem] border border-white/10">
                  <div className="text-yellow-400 font-black text-xs uppercase tracking-widest">第 {currentIndex + 1} 題</div>
                  <h3 className="text-xl font-bold leading-tight text-white">{questions[currentIndex]?.text}</h3>
               </div>
               <div className="grid grid-cols-1 gap-4">
                {shuffledMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => submitAnswer(m.stageName)}
                    disabled={!!currentPlayer.lastAnswer}
                    className={`p-6 rounded-[2rem] text-2xl font-black transition-all transform active:scale-95 border-4 ${
                      currentPlayer.lastAnswer === m.stageName 
                        ? 'bg-yellow-400 text-black border-yellow-400 shadow-[0_0_30px_rgba(255,240,0,0.4)] scale-105'
                        : 'bg-white/5 text-white border-white/5'
                    } disabled:opacity-50 uppercase tracking-widest`}
                  >
                    {m.stageName}
                  </button>
                ))}
               </div>
               {currentPlayer.lastAnswer && (
                 <div className="text-center space-y-2 animate-bounce">
                   <p className="text-yellow-400 font-black text-xl">答案已傳送到母體！</p>
                   <p className="text-white/20 text-xs font-bold uppercase">等待其他 VIP 或下一題...</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-3xl font-black text-center bigbang-yellow italic uppercase tracking-tighter">
                {gameState === GameState.FINISHED ? '比賽結束！' : '排行榜'}
              </h2>
              <div className="space-y-3">
                 {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                   <div key={p.id} className={`glass-card p-4 rounded-2xl flex justify-between items-center ${p.id === currentPlayer.id ? 'border-yellow-400/50 bg-yellow-400/10' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className="font-black text-white/20">{idx+1}</span>
                        <span className="font-bold text-white uppercase text-sm">{p.name} {p.id === currentPlayer.id ? '(你)' : ''}</span>
                      </div>
                      <span className="font-mono text-yellow-400 font-black">{p.score}</span>
                   </div>
                 ))}
              </div>
              <p className="text-white/40 text-center text-xs animate-pulse">母體正在操作中，請稍候...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
