// src/types/config.ts
export interface UserSettings {
  userId: string;
  slippage: number;
  gasPriority: 'low' | 'medium' | 'high';
}