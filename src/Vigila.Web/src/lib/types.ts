// Sunucudaki sözleşmelerin (Features/Contracts.cs) birebir karşılıkları.

export type Role = "researcher" | "admin";
export type MediaKind = "video" | "image" | "audio";
export type StimulusKind = "visual" | "auditory" | "audiovisual";
export type PairingMode = "independent" | "paired" | "mixed";
export type PositionMode = "random" | "balancedQuadrants" | "center";
export type SeedMode = "perSession" | "fixed";
export type SessionStatus = "created" | "running" | "completed" | "aborted";
export type SessionOrigin = "lab" | "link";
export type TrialOutcome = "hit" | "miss" | "anticipation" | "notPresented";
export type ResponseMode = "keyboard" | "pointer" | "both";
export type ParticipantLanguage = "tr" | "en";
export type QuestionType = "text" | "number" | "choice" | "scale";

export interface Question {
  id: string;
  label: string;
  type: QuestionType;
  options: string[] | null;
  required: boolean;
  min: number | null;
  max: number | null;
}

export interface PracticeResult {
  trials: number;
  hits: number;
  meanRt: number | null;
}

export interface LiveSession {
  id: string;
  experimentId: string;
  experimentName: string;
  participantCode: string;
  origin: SessionOrigin;
  progressMs: number;
  durationMs: number;
  startedAt: string | null;
  lastSeenAt: string;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  creditsRemaining: number | null;
  creditsUsed: number;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  url: string;
  posterUrl: string | null;
  peaks: number[] | null;
  createdAt: string;
  usageCount: number;
}

export interface ExperimentSettings {
  repetitions: number;
  durationMinMs: number;
  durationMaxMs: number;
  pairing: PairingMode;
  positioning: PositionMode;
  imageScale: number;
  safeMargin: number;
  responseWindowMs: number;
  minGapMs: number;
  leadInMs: number;
  tailMs: number;
  minValidRtMs: number;
  responseKey: string;
  audioVolume: number;
  videoVolume: number;
  seedMode: SeedMode;
  fixedSeed: number;
  allowPause: boolean;
  practiceTrials: number;
  practiceFeedback: boolean;
  responseMode: ResponseMode;
  language: ParticipantLanguage;
  blockTouchOnly: boolean;
}

export interface LinkSettings {
  consentText: string;
  questions: Question[];
  maxParticipants: number | null;
  linkExpiresAt: string | null;
  preventRepeat: boolean;
  completionUrl: string | null;
}

export interface Readiness {
  ready: boolean;
  issues: string[];
}

export interface Experiment extends LinkSettings {
  linkCompletedCount: number;
  id: string;
  name: string;
  description: string;
  instructionText: string;
  videoId: string | null;
  instructionVideoId: string | null;
  imageIds: string[];
  audioIds: string[];
  settings: ExperimentSettings;
  runToken: string | null;
  runLinkEnabled: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  readiness: Readiness;
  trialCount: number;
  sessionCount: number;
}

export interface ExperimentDraft extends LinkSettings {
  name: string;
  description: string;
  instructionText: string;
  videoId: string | null;
  instructionVideoId: string | null;
  imageIds: string[];
  audioIds: string[];
  settings: ExperimentSettings;
}

export interface ExperimentListItem {
  id: string;
  name: string;
  description: string;
  posterUrl: string | null;
  videoName: string | null;
  videoDurationMs: number | null;
  imageCount: number;
  audioCount: number;
  trialCount: number;
  sessionCount: number;
  completedCount: number;
  meanHitRate: number | null;
  meanRt: number | null;
  lastSessionAt: string | null;
  runLinkEnabled: boolean;
  isArchived: boolean;
  ready: boolean;
  updatedAt: string;
}

export interface StimulusBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScheduledStimulus {
  index: number;
  kind: StimulusKind;
  imageId: string | null;
  audioId: string | null;
  onsetMs: number;
  durationMs: number;
  box: StimulusBox | null;
  quadrant: number | null;
}

export interface ScheduleCapacity {
  trialCount: number;
  usableMs: number;
  requiredMs: number;
  maxTrials: number;
  utilization: number;
}

export interface PreviewResponse {
  seed: number;
  ok: boolean;
  error: string | null;
  capacity: ScheduleCapacity;
  stimuli: ScheduledStimulus[];
}

export interface KindAggregate {
  kind: StimulusKind;
  trials: number;
  hits: number;
  hitRate: number;
  meanRt: number | null;
  medianRt: number | null;
}

export interface QuadrantAggregate {
  quadrant: number;
  trials: number;
  hits: number;
  hitRate: number;
  meanRt: number | null;
}

export interface SessionPoint {
  sessionId: string;
  participantCode: string;
  completedAt: string;
  hitRate: number;
  meanRt: number | null;
}

export interface ExperimentAnalytics {
  sessions: number;
  completed: number;
  participants: number;
  meanHitRate: number | null;
  meanRt: number | null;
  medianRt: number | null;
  hitRts: { kind: StimulusKind; values: number[] }[];
  byKind: KindAggregate[];
  byQuadrant: QuadrantAggregate[];
  points: SessionPoint[];
  meanDPrime: number | null;
  comparisons: { a: StimulusKind; b: StimulusKind; test: PairedTest }[];
  byBlock: { block: number; sessions: number; hitRate: number; meanRt: number | null }[];
}

export interface PairedTest {
  n: number;
  meanDiff: number;
  sdDiff: number;
  t: number | null;
  df: number;
  p: number | null;
  dz: number | null;
}

export interface RunInfo {
  experimentName: string;
  instructionText: string;
  instructionVideoUrl: string | null;
  responseKey: string;
  allowPause: boolean;
  videoDurationMs: number;
  trialCount: number;
  consentText: string;
  questions: Question[];
  responseMode: ResponseMode;
  language: ParticipantLanguage;
  blockTouchOnly: boolean;
  practiceTrials: number;
  preventRepeat: boolean;
}

export interface ClientInfo {
  userAgent: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  pixelRatio: number | null;
  refreshRateHz: number | null;
  audioOutputLatencyMs: number | null;
  audioBaseLatencyMs: number | null;
  videoFrameCallback: boolean | null;
  fullscreen: boolean | null;
  timezone: string | null;
  language: string | null;
}

export interface RunAsset {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
}

export interface RunPayload {
  sessionId: string;
  sessionKey: string;
  participantCode: string;
  experimentName: string;
  origin: SessionOrigin;
  settings: {
    responseKey: string;
    responseWindowMs: number;
    allowPause: boolean;
    audioVolume: number;
    videoVolume: number;
    minValidRtMs: number;
    responseMode: ResponseMode;
    language: ParticipantLanguage;
    practiceFeedback: boolean;
  };
  video: { url: string; durationMs: number; width: number; height: number; sizeBytes: number };
  stimuli: ScheduledStimulus[];
  images: RunAsset[];
  audios: RunAsset[];
  practice: { durationMs: number; stimuli: ScheduledStimulus[] } | null;
}

export interface StimulusPresentation {
  index: number;
  visualOnset: number | null;
  audioOnset: number | null;
  offset: number | null;
  mediaOnsetMs: number | null;
  interrupted: boolean;
}

export interface ResponseEvent {
  time: number;
  mediaMs: number;
  key: string;
}

export interface Interruption {
  reason: "pause" | "hidden" | "fullscreen" | "buffering";
  atMediaMs: number;
  atTime: number;
  resumedAt: number | null;
}

export interface KindStats {
  kind: StimulusKind;
  trials: number;
  hits: number;
  misses: number;
  anticipations: number;
  hitRate: number;
  meanRt: number | null;
  medianRt: number | null;
  sdRt: number | null;
}

export interface QuadrantStats {
  quadrant: number;
  trials: number;
  hits: number;
  hitRate: number;
  meanRt: number | null;
}

export interface SessionSummary {
  trials: number;
  presented: number;
  hits: number;
  misses: number;
  anticipations: number;
  falseAlarms: number;
  extraResponses: number;
  hitRate: number;
  meanRt: number | null;
  medianRt: number | null;
  sdRt: number | null;
  minRt: number | null;
  maxRt: number | null;
  falseAlarmsPerMinute: number;
  redundancyGainMs: number | null;
  byKind: KindStats[];
  byQuadrant: QuadrantStats[];
  timing: {
    meanOnsetLagMs: number | null;
    maxOnsetLagMs: number | null;
    meanAvAsyncMs: number | null;
    interruptions: number;
  };
  falseAlarmRate: number | null;
  dPrime: number | null;
  criterion: number | null;
  ies: number | null;
  trimmedMeanRt: number | null;
  byBlock: { block: number; trials: number; hits: number; hitRate: number; meanRt: number | null }[] | null;
}

export interface CompleteResponse {
  sessionId: string;
  status: SessionStatus;
  summary: SessionSummary | null;
  redirectUrl: string | null;
}

export interface SessionListItem {
  id: string;
  experimentId: string;
  experimentName: string;
  participantCode: string;
  origin: SessionOrigin;
  status: SessionStatus;
  createdAt: string;
  completedAt: string | null;
  trialCount: number;
  hitRate: number | null;
  meanRt: number | null;
  falseAlarms: number | null;
}

export interface TrialResult {
  index: number;
  kind: StimulusKind;
  plannedOnsetMs: number;
  durationMs: number;
  onsetTime: number | null;
  onsetLagMs: number | null;
  avAsyncMs: number | null;
  outcome: TrialOutcome;
  rtMs: number | null;
  extraResponses: number;
  quadrant: number | null;
  imageId: string | null;
  audioId: string | null;
  interrupted: boolean;
}

export interface AssetRef {
  id: string;
  kind: MediaKind;
  name: string;
  url: string;
  width: number | null;
  height: number | null;
  peaks: number[] | null;
}

export interface SessionDetail {
  info: SessionListItem;
  seed: number;
  settings: ExperimentSettings;
  video: { videoId: string; name: string; durationMs: number; width: number; height: number };
  videoUrl: string | null;
  posterUrl: string | null;
  schedule: ScheduledStimulus[];
  trials: TrialResult[];
  falseAlarms: { time: number; mediaMs: number }[];
  responses: ResponseEvent[];
  interruptions: Interruption[];
  client: ClientInfo | null;
  summary: SessionSummary | null;
  assets: AssetRef[];
  startedAt: string | null;
  answers: Record<string, string>;
  questions: Question[];
  consentAt: string | null;
  practice: PracticeResult | null;
}

export interface Dashboard {
  experiments: number;
  activeLinks: number;
  sessionsCompleted: number;
  sessionsThisWeek: number;
  participants: number;
  meanHitRate: number | null;
  meanRt: number | null;
  creditsRemaining: number | null;
  creditsUsed: number;
  activity: { date: string; count: number }[];
  recent: SessionListItem[];
  trend: { at: string; meanRt: number | null; hitRate: number | null }[];
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  creditsRemaining: number | null;
  creditsUsed: number;
  createdAt: string;
  lastLoginAt: string | null;
  experimentCount: number;
  sessionCount: number;
}
