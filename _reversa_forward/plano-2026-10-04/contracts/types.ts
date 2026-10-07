// Tipos compartilhados (extraídos de ui/src/types/** em A17).
// Este arquivo é o "source of truth" para o frontend. Não importar de store/UI.

export type ProjectType = 'music-video' | 'short-film' | 'custom';
export type DirectorFormat = 'mp4' | 'webm' | 'mov';
export type Workflow = 'basic' | 'expert';
export type SceneStatus = 'pending' | 'running' | 'review' | 'done' | 'failed';
export type QueueState =
  | 'queued' | 'preparing' | 'running' | 'awaiting_review'
  | 'done' | 'failed' | 'cancelled';

export interface ApiErrorPayload {
  code: string;
  message: string;
  operationId: string;
  cause?: string | null;
}

export class ApiError extends Error {
  readonly code: string;
  readonly operationId: string;
  readonly status: number;
  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.code = payload.code;
    this.operationId = payload.operationId;
    this.status = status;
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  type: ProjectType;
  presetId: string | null;
  updatedAt: string;
  thumb: string | null;
}

export interface ProjectCreate {
  name: string;
  type: ProjectType;
  presetId?: string | null;
}

export interface Briefing {
  intent?: string;
  audience?: string;
  durationSec?: number;
  references?: string[];
}

export interface SceneCard {
  id: string;
  index: number;
  durationSec: number;
  takes: number;
  status: SceneStatus;
  prompt: string;
  thumb?: string | null;
}

export interface DirectorOptions {
  skill?: string;
  format?: DirectorFormat;
  workflow?: Workflow;
}

export interface Project extends ProjectSummary {
  briefing?: Briefing;
  scenes?: SceneCard[];
  options?: DirectorOptions;
}

export interface ContinueProject {
  id: string;
  name: string;
  section: string;
  updatedAt: string;
}

export interface RecentOutput {
  id: string;
  projectId: string;
  thumb: string;
  createdAt: string;
}

export interface QueueItem {
  id: string;
  projectId: string;
  label: string;
  state: QueueState;
  progress: number;
  expectedSec: number | null;
  position?: number | null;
  updatedAt: string;
}

export interface DashboardSummary {
  continueProject?: ContinueProject;
  queue: QueueItem[];
  recentOutputs: RecentOutput[];
}

// Editor (A05, A16)
export interface EditorClip {
  id: string;
  mediaPath: string;
  start: number;
  duration: number;
  label?: string | null;
  audioGain?: number;
}

export interface EditorProject {
  id: string;
  title: string;
  clips: EditorClip[];
  updatedAt: string;
}

export interface EditorProjectCreate {
  title?: string;
}

// Apêndice: Estados UI mapeados para ações (A14)
export const QUEUE_ACTIONS: Record<QueueState, ReadonlyArray<'cancel'|'review'|'reopen'|'download'>> = {
  queued: ['cancel'],
  preparing: ['cancel'],
  running: ['cancel'],
  awaiting_review: ['review'],
  done: ['review', 'download'],
  failed: ['reopen'],
  cancelled: ['reopen'],
};

export const QUEUE_LABELS: Record<QueueState, string> = {
  queued: 'Aguardando',
  preparing: 'Preparando/download',
  running: 'Gerando',
  awaiting_review: 'Aguardando revisão',
  done: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

// Navegação (A09)
export type Section = 'briefing' | 'scenes' | 'studio' | 'media' | 'review';

export type AppRoute =
  | { kind: 'dashboard' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string; section: Section }
  | { kind: 'media' }
  | { kind: 'queue' }
  | { kind: 'editor'; projectId: string }
  | { kind: 'configurations' };