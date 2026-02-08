
export enum GameRole {
  HOST = 'HOST',
  PLAYER = 'PLAYER',
  LOBBY = 'LOBBY'
}

export enum GameState {
  IDLE = 'IDLE',
  JOINING = 'JOINING',
  QUESTION = 'QUESTION',
  LEADERBOARD = 'LEADERBOARD',
  FINISHED = 'FINISHED',
  CHALLENGE_INVITE = 'CHALLENGE_INVITE'
}

export enum Difficulty {
  EASY = '簡單',
  NORMAL = '普通',
  HARD = '困難'
}

export interface BigBangMember {
  id: string;
  name: string;
  stageName: string;
  color: string;
}

export interface Question {
  id: number;
  text: string;
  options: string[];
  correctAnswer: string; 
  funFact?: string;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  lastAnswer?: string;
  isCorrect?: boolean;
  isInvited?: boolean;
  hasAccepted?: boolean;
}

export interface GameSyncMessage {
  type: 'SYNC_STATE' | 'CHALLENGE_RECEIVED' | 'CHALLENGE_ACCEPTED';
  gameState: GameState;
  currentQuestionIndex: number;
  players: Player[];
  sessionId: string;
  timerDuration: number;
}
