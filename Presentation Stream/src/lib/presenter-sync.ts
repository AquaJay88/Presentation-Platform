// BroadcastChannel-based sync between audience window (/present/$deckId)
// and presenter notes window (/present/$deckId/notes). Same-origin only.

export type AgendaSummary = {
  id: string;
  title: string;
  leader: string | null;
};

export type StepSummary = {
  kind: "transition" | "slide";
  slideKind: "youtube" | "pdf" | "image" | "text" | "website" | "docx" | null;
  title: string;
  agendaTitle: string | null;
  agendaIndex: number | null;
};

export type PresenterState = {
  deckTitle: string;
  i: number;
  totalSteps: number;
  page: number;
  totalPdfPages: number;
  blank: boolean;
  current: StepSummary | null;
  next: StepSummary | null;
  agenda: AgendaSummary[];
  // index of the first transition step for each agenda item, for jumping
  agendaStepIndex: Record<string, number>;
  currentAgendaId: string | null;
};

export type AudienceMessage =
  | { type: "state"; state: PresenterState }
  | { type: "pong" };

export type PresenterMessage =
  | { type: "hello" }
  | { type: "goto"; i: number; page?: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "toggle-blank" };

export type ChannelMessage = AudienceMessage | PresenterMessage;

export function channelName(deckId: string): string {
  return `presenter-sync:${deckId}`;
}

export function openChannel(deckId: string): BroadcastChannel {
  return new BroadcastChannel(channelName(deckId));
}
