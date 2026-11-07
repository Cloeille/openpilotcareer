import type { CentreView, CourseView, OwnWhy, PilotRef, RetrainResult, RetrainView, RetrainWhy, TrainOffer, TrainPlace, TrainResult, TrainingView } from '@opc/shared';
import { api } from './api.ts';
import { ApiError } from './errors.ts';

/**
 * Typed client for the TRAINING lot of docs/v4-plan.md (B.3, C26): the training centre, its courses and the reconversion of a captain into an instructor.
 * The wire types are the server's, from `@opc/shared` (`shared/src/training.ts`). A route the server does not have answers 404/405: `null` means "feature off", any other failure still throws.
 * Money is euros and computed by the server; instants are epoch milliseconds.
 */
export type { CentreView, CourseView, OwnWhy, PilotRef, RetrainResult, RetrainView, RetrainWhy, TrainOffer, TrainPlace, TrainResult, TrainingView };

async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export const fetchTraining = (): Promise<TrainingView | null> => optional<TrainingView>('/training');
export const bookCourse = (staffId: number, type: string, place: TrainPlace): Promise<TrainResult> => api<TrainResult>('/training/courses', { method: 'POST', body: { staffId, type, place } });
/** `null`: no such employee, or the server has no reconversion. */
export const fetchRetrain = (id: number): Promise<RetrainView | null> => optional<RetrainView>(`/staff/${id}/retrain`);
export const retrainMember = (id: number): Promise<RetrainResult> => api<RetrainResult>(`/staff/${id}/retrain`, { method: 'POST', body: { option: 'instructor' } });
