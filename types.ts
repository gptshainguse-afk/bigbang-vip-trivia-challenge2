
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
  FINISHED = 'FINISHED'
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
  correctAnswer: string; // Stage Name
  funFact?: string;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  lastAnswer?: string;
  isCorrect?: boolean;
}

export interface GameSyncMessage {
  type: 'SYNC_STATE';
  gameState: GameState;
  currentQuestionIndex: number;
  players: Player[];
  sessionId: string;
}
