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
  skinTone?: string | null;      // Monk Skin Tone Scale id (app/fit-lab/skinTone.ts), null = the model's own skin
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