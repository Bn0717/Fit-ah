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
  skinTone?: string | null;
  // the shopper's own tape measurements (cm; waist + hips all the way round, inside leg crotch to floor), optional:
  // the pants advice uses them instead of the 3D body's estimated ones (app/fit-lab/jeansFit.ts)
  tape?: { waist: number | null; hip: number | null; inseam: number | null };      // Monk Skin Tone Scale id (app/fit-lab/skinTone.ts), null = the model's own skin
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