// lib/types/avatar.ts
export interface ParametricAvatar {
  userId: string;
  height: number;
  chest: number;
  waist: number;
  shoulder: number;
  armLength?: number;
  legLength?: number;
  photoUrl?: string;
  avatarUrl?: string;
  selectedAnimation?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export interface MeasurementConfidence {
  height: number;
  chest: number;
  waist: number;
  shoulder: number;
  overall: number;
}