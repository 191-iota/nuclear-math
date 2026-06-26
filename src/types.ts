export type FeedbackStyle = 'spoken' | 'chime' | 'both';

export interface Mode {
  id: string;
  label: string;
  systemPrompt: string;
  feedbackStyle: FeedbackStyle;
  debounceMs: number;
  // Whether this mode grades work (reports errors) vs. just reads/summarises it.
  // Controls the cross-scan context the app adds. Defaults to true when omitted.
  errorChecking?: boolean;
}
