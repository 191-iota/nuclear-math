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
  // Whether this mode solves the problem once and caches the worked solution for
  // the session, then verifies later scans against it (cheaper) instead of
  // re-deriving every scan. Uses structured output. Defaults to false.
  cacheSolution?: boolean;
}
