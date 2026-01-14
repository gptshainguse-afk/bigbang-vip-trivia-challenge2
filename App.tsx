
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

  // API KEY 設定相關
  const [showSettings, setShowSettings] = useState(false);
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('BB_CUSTOM_API_KEY') || '');

  useEffect(() => {
    localStorage.setItem('BB_CUSTOM_API_KEY', customApiKey);
  }, [customApiKey]);

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
        sendSyncToConn(conn);
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
      const q = await generateBigBangQuestions(usedQuestionTexts.current, customApiKey);
      setQuestions(q);
      q.forEach(item => usedQuestionTexts.current.push(item.text));
      setCurrentIndex(-1);
    } catch (e) {
      console.error("生成題目失敗", e);
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
          setCurrentIndex(prev => {
            if (data.currentQuestionIndex !== prev) {
              setShuffledMembers(shuffleArray(MEMBERS));
            }
            return data.currentQuestionIndex;
          });
          
          setGameState(data.gameState);
          setPlayers(data.players);
          setQuestions(data.questions || []);
          
          setCurrentPlayer(p => {
            if (!p) return null;
            const updatedFromHost = data.players.find((pl: Player) => pl.id === p.id);
            if (updatedFromHost) {
              return { ...p, score: updatedFromHost.score, lastAnswer: updatedFromHost.lastAnswer, isCorrect: updatedFromHost.isCorrect };
            }
            return p;
          });
        }
      });

      conn.on('close', () => setPeerStatus('ERROR'));
    });
  };

  const sendSyncToConn = (conn: DataConnection) => {
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
    connectionsRef.current.forEach(conn => sendSyncToConn(conn));
  }, [gameState, currentIndex, players, questions, sessionId]);

  useEffect(() => {
    if (role === GameRole.HOST && peerStatus === 'CONNECTED') {
      broadcast();
    }
  }, [gameState, currentIndex, players, questions, role, peerStatus, broadcast]);

  const handlePlayerAnswer = (playerId: string, answer: string) => {
    setPlayers(prev => {
      return prev.map(p => {
        if (p.id === playerId) {
          if (p.lastAnswer) return p;
          const normCorrect = (questions[currentIndex]?.correctAnswer || "").toLowerCase().replace(/[^a-z]/g, '');
          const normPlayer = answer.toLowerCase().replace(/[^a-z]/g, '');
          const isCorrect = normPlayer === normCorrect;
          return { 
            ...p, 
            lastAnswer: answer, 
            isCorrect, 
            score: isCorrect ? p.score + 100 : p.score 
          };
        }
        return p;
      });
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

  const SettingsModal = () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="glass-card w-full max-w-md p-10 rounded-[3rem] border border-yellow-400/30 shadow-[0_0_50px_rgba(255,240,0,0.2)]">
        <h3 className="text-3xl font-black bigbang-yellow italic tracking-tighter mb-6">VIP SYSTEM SETTINGS</h3>
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-white/40 uppercase tracking-widest">Gemini API Key</label>
            <input 
              type="password"
              value={customApiKey}
              onChange={(e) => setCustomApiKey(e.target.value)}
              placeholder="Paste your API key here..."
              className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-white outline-none focus:border-yellow-400 transition-all font-mono"
            />
          </div>
          <p className="text-xs text-white/30 leading-relaxed">
            如果母體無法從環境變數取得金鑰，請在此手動輸入。金鑰將僅儲存在您的瀏覽器本地。
          </p>
          <div className="flex gap-4 pt-4">
            <button 
              onClick={() => setShowSettings(false)}
              className="flex-1 bg-yellow-400 text-black font-black py-4 rounded-2xl hover:bg-yellow-300 transition-all uppercase tracking-widest"
            >
              SAVE & CLOSE
            </button>
            <button 
              onClick={() => { setCustomApiKey(''); }}
              className="px-6 py-4 rounded-2xl border border-white/10 font-bold text-white/40 hover:text-white transition-all uppercase text-xs"
            >
              CLEAR
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (role === GameRole.LOBBY) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
        <div className="text-center space-y-12">
          <div className="relative inline-block">
            <h1 className="text-9xl font-black italic bigbang-yellow tracking-tighter drop-shadow-[0_0_50px_rgba(255,240,0,0.5)]">BIGBANG</h1>
            <div className="absolute -top-12 -right-12 rotate-12">{CROWN_SVG(72, COLORS.GOLD)}</div>
          </div>
          <button 
            onClick={setupHostPeer}
            disabled={isSyncing}
            className="w-full max-w-sm bg-yellow-400 text-black font-black py-8 rounded-[3rem] hover:scale-110 active:scale-95 transition-all shadow-2xl text-3xl uppercase tracking-widest disabled:opacity-50"
          >
            {isSyncing ? '正在初始化...' : '啟動 VIP ARENA'}
          </button>
        </div>
      </div>
    );
  }

  if (role === GameRole.HOST) {
    return (
      <div className="min-h-screen p-10 max-w-6xl mx-auto flex flex-col bg-black">
        <header className="flex justify-between items-end mb-12 border-b-2 border-yellow-400/20 pb-6">
          <div>
            <h1 className="text-6xl font-black italic bigbang-yellow tracking-tighter">VIP CENTER</h1>
            <div className="flex items-center gap-3 mt-3">
              <div className={`w-4 h-4 rounded-full ${peerStatus === 'CONNECTED' ? 'bg-green-500 shadow-[0_0_15px_green]' : 'bg-red-500 animate-pulse'}`} />
              <span className="text-sm text-white/40 font-mono">CONNECTION ID: {sessionId}</span>
            </div>
          </div>
          <div className="text-right text-yellow-400 font-black text-4xl">VIPs: {players.length}</div>
        </header>

        <main className="flex-1 flex flex-col justify-center overflow-hidden">
          {/* 渲染母體原本的各種 State UI */}
          {gameState === GameState.JOINING && (
            <div className="text-center space-y-10 animate-in zoom-in">
              <h2 className="text-7xl font-black uppercase tracking-tight">準備入場</h2>
              <div className="bg-white p-6 rounded-[3rem] inline-block shadow-[0_0_120px_rgba(255,240,0,0.3)] border-[10px] border-yellow-400">
                <QRCode value={playerJoinUrl} size={320} />
              </div>
              <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
                {players.map(p => (
                  <div key={p.id} className="bg-yellow-400 text-black px-8 py-3 rounded-full font-black text-2xl animate-bounce shadow-xl">{p.name}</div>
                ))}
              </div>
              <button onClick={nextQuestion} disabled={players.length === 0} className="bg-white text-black px-24 py-8 rounded-full font-black text-5xl hover:bg-yellow-400 transition-all disabled:opacity-20 shadow-2xl">
                所有 VIP 已就坐
              </button>
            </div>
          )}

          {gameState === GameState.QUESTION && (
            <div className="text-center space-y-12 animate-in fade-in slide-in-from-bottom-5">
              <div className="space-y-6">
                <span className="bg-yellow-400 text-black px-12 py-3 rounded-full font-black text-2xl uppercase italic shadow-2xl">第 {currentIndex + 1} 題</span>
                <h2 className="text-8xl font-black leading-tight drop-shadow-2xl">{questions[currentIndex]?.text}</h2>
                <div className="text-white/40 font-bold text-3xl uppercase tracking-widest">
                  已作答: <span className="text-yellow-400">{players.filter(p => p.lastAnswer).length}</span> / {players.length}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-10 max-w-5xl mx-auto">
                {MEMBERS.map(m => (
                  <div key={m.id} className="glass-card py-20 rounded-[4rem] border border-white/10 text-6xl font-black text-white/90 shadow-2xl">
                    {m.stageName}
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-10">
                <button onClick={() => setGameState(GameState.LEADERBOARD)} className="bg-white/10 px-16 py-6 rounded-3xl font-black hover:bg-white/20 transition-all uppercase tracking-widest text-2xl border border-white/10">看即時戰績</button>
                <button onClick={nextQuestion} className="bg-yellow-400 text-black px-24 py-6 rounded-3xl font-black text-3xl hover:scale-110 transition-all shadow-2xl">揭曉下一題</button>
              </div>
            </div>
          )}

          {(gameState === GameState.LEADERBOARD || gameState === GameState.FINISHED) && (
            <div className="space-y-12 animate-in fade-in duration-700">
               <h2 className="text-8xl font-black text-center italic bigbang-yellow tracking-tighter uppercase drop-shadow-2xl">
                 {gameState === GameState.FINISHED ? 'THE BEST VIP' : 'LIVE STANDINGS'}
               </h2>
               <div className="max-w-4xl mx-auto space-y-5">
                  {[...players].sort((a,b) => b.score - a.score).map((p, idx) => (
                    <div key={p.id} className="glass-card flex items-center justify-between p-10 rounded-[3rem] border border-white/10 shadow-2xl">
                      <div className="flex items-center gap-12">
                        <span className="text-6xl font-black text-white/10 w-16">{idx+1}</span>
                        <span className="text-4xl font-black">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-10">
                        <div className="flex gap-2">
                          {idx === 0 && Array(3).fill(0).map((_, i) => <span key={i} className="animate-bounce">{CROWN_SVG(56, COLORS.GOLD)}</span>)}
                          {idx === 1 && Array(2).fill(0).map((_, i) => <span key={i} className="animate-bounce">{CROWN_SVG(48, COLORS.SILVER)}</span>)}
                          {idx === 2 && Array(1).fill(0).map((_, i) => <span key={i} className="animate-bounce">{CROWN_SVG(40, COLORS.BRONZE)}</span>)}
                        </div>
                        <span className="text-6xl font-mono text-yellow-400 font-black">{p.score}</span>
                      </div>
                    </div>
                  ))}
               </div>
               <div className="flex justify-center mt-12">
                 {gameState === GameState.LEADERBOARD ? (
                   <button onClick={nextQuestion} className="bg-yellow-400 text-black px-28 py-8 rounded-[3rem] font-black text-4xl shadow-2xl hover:scale-105 transition-all">下一題</button>
                 ) : (
                   <button onClick={fetchNewQuestions} disabled={isSyncing} className="bg-white/10 px-20 py-8 rounded-[3rem] font-black text-2xl hover:bg-white/20 uppercase tracking-widest border border-white/10">
                     {isSyncing ? '重新載入題目庫...' : '再來 10 題 (不重複)'}
                   </button>
                 )}
               </div>
            </div>
          )}
        </main>

        {/* 齒輪按鈕與彈窗 */}
        <button 
          onClick={() => setShowSettings(true)}
          className="fixed bottom-10 right-10 z-50 p-4 bg-yellow-400 rounded-full shadow-2xl hover:rotate-90 transition-all duration-500 group"
        >
          <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        {showSettings && <SettingsModal />}
      </div>
    );
  }

  // --- 參賽者手機端 ---
  if (role === GameRole.PLAYER) {
    if (peerStatus === 'CONNECTING') return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-10">
          <div className="w-24 h-24 border-8 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto shadow-[0_0_40px_rgba(255,240,0,0.5)]" />
          <p className="bigbang-yellow font-black animate-pulse tracking-widest text-3xl">連線母體中...</p>
        </div>
      </div>
    );

    if (!currentPlayer) return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-zinc-950">
        <form onSubmit={(e) => {
          e.preventDefault();
          const n = (e.currentTarget.elements.namedItem('playername') as HTMLInputElement).value;
          if (n) joinGame(n);
        }} className="w-full max-w-sm space-y-16">
          <div className="text-center space-y-6">
            <h1 className="text-7xl font-black bigbang-yellow italic tracking-tighter drop-shadow-2xl">JOIN VIP</h1>
            <p className="text-white/20 text-sm font-bold uppercase tracking-[0.5em]">Your Stage Name</p>
          </div>
          <input name="playername" required maxLength={12} placeholder="輸入你的暱稱..." className="w-full bg-white/5 border-2 border-white/10 p-8 rounded-[2.5rem] text-4xl font-black text-center text-white outline-none focus:border-yellow-400 transition-all shadow-inner uppercase" />
          <button className="w-full bg-yellow-400 text-black font-black py-8 rounded-[2.5rem] text-3xl shadow-2xl active:scale-95 transition-all uppercase tracking-widest">入場參加</button>
        </form>
      </div>
    );

    return (
      <div className="min-h-screen p-8 flex flex-col bg-zinc-950">
        <header className="flex justify-between items-center mb-16 border-b border-white/10 pb-8">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-yellow-400 text-black font-black flex items-center justify-center rounded-2xl italic text-4xl shadow-xl">V</div>
            <span className="font-black text-3xl text-white truncate max-w-[200px] uppercase">{currentPlayer.name}</span>
          </div>
          <div className="text-right">
            <span className="bigbang-yellow font-black text-5xl leading-none">{currentPlayer.score}</span>
            <p className="text-xs text-white/30 font-bold uppercase tracking-widest mt-1">Total Score</p>
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center">
          {gameState === GameState.JOINING ? (
            <div className="text-center space-y-12">
              <p className="text-9xl drop-shadow-[0_0_30px_rgba(255,240,0,0.5)]">👑</p>
              <h2 className="text-5xl font-black text-white uppercase italic tracking-tighter animate-pulse">已連線成功</h2>
              <p className="text-white/40 font-bold text-xl">請盯緊大螢幕，準備挑戰！</p>
            </div>
          ) : gameState === GameState.QUESTION ? (
            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-5">
               <div className="text-center bg-white/5 p-10 rounded-[3rem] border border-white/10 shadow-2xl">
                  <p className="text-yellow-400 font-black text-sm mb-5 uppercase italic tracking-widest">Question {currentIndex + 1}</p>
                  <h3 className="text-4xl font-bold text-white leading-tight">{questions[currentIndex]?.text}</h3>
               </div>
               <div className="grid gap-6">
                {shuffledMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => submitAnswer(m.stageName)}
                    disabled={!!currentPlayer.lastAnswer}
                    className={`p-10 rounded-[3rem] text-4xl font-black transition-all border-4 ${
                      currentPlayer.lastAnswer === m.stageName 
                        ? 'bg-yellow-400 text-black border-yellow-400 scale-105 shadow-[0_0_50px_rgba(255,240,0,0.5)]'
                        : 'bg-white/5 text-white border-white/10'
                    } disabled:opacity-50 uppercase tracking-tighter`}
                  >
                    {m.stageName}
                  </button>
                ))}
               </div>
               {currentPlayer.lastAnswer && (
                 <div className="text-center py-6 space-y-4">
                   <p className="text-yellow-400 font-black text-3xl uppercase italic animate-bounce tracking-widest">答案已紀錄！</p>
                   <p className="text-white/20 text-sm font-bold uppercase">請看大螢幕，等候公布結果...</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="text-center space-y-12 animate-in fade-in">
              <h2 className="text-6xl font-black bigbang-yellow italic uppercase tracking-tighter drop-shadow-2xl">
                {gameState === GameState.FINISHED ? 'FINAL RESULTS' : 'RANKING'}
              </h2>
              <div className="space-y-5">
                 {[...players].sort((a,b) => b.score - a.score).slice(0, 5).map((p, idx) => (
                   <div key={p.id} className={`p-8 rounded-[2.5rem] flex justify-between items-center transition-all ${p.id === currentPlayer.id ? 'bg-yellow-400/20 border-2 border-yellow-400/60 shadow-2xl' : 'bg-white/5'}`}>
                      <div className="flex items-center gap-6">
                        <span className="font-black text-white/20 text-3xl">{idx+1}</span>
                        <span className="font-bold text-white uppercase text-2xl">{p.name} {p.id === currentPlayer.id ? '(YOU)' : ''}</span>
                        {idx < 3 && <div className="flex gap-1">{Array(3-idx).fill(0).map((_, i) => <span key={i}>{CROWN_SVG(24)}</span>)}</div>}
                      </div>
                      <span className="font-mono text-yellow-400 font-black text-4xl">{p.score}</span>
                   </div>
                 ))}
              </div>
              <p className="text-white/20 text-sm font-bold uppercase animate-pulse tracking-widest">等候主持人繼續下一步...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
