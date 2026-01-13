
import React from 'react';
import { BigBangMember } from './types';

export const MEMBERS: BigBangMember[] = [
  { id: 'gd', name: 'Kwon Ji-yong', stageName: 'G-Dragon', color: '#ff0000' },
  { id: 'top', name: 'Choi Seung-hyun', stageName: 'T.O.P', color: '#00ffff' },
  { id: 'taeyang', name: 'Dong Young-bae', stageName: 'Taeyang', color: '#ffff00' },
  { id: 'daesung', name: 'Kang Dae-sung', stageName: 'Daesung', color: '#00ff00' },
];

export const COLORS = {
  YELLOW: '#FFF000',
  BLACK: '#000000',
  WHITE: '#FFFFFF',
  GOLD: '#FFD700',
  SILVER: '#C0C0C0',
  BRONZE: '#CD7F32'
};

export const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const CROWN_SVG = (size = 24, color = COLORS.GOLD) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg" className="crown-animation">
    <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.5523 18.5523 20 18 20H6C5.44772 20 5 19.5523 5 19V18H19V19Z" />
  </svg>
);
