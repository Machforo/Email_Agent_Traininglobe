export type ResearchGap = {
  gap: string;
  evidence: string;
  whyItExists: string;
  impact: string;
};

export type ResearchSolution = {
  forGap: string;
  solution: string;
  proofPoint: string;
};

export type ResearchResult = {
  overview: string;
  programs: string[];
  recentDevelopments: string[];
  gaps: ResearchGap[];
  solutions: ResearchSolution[];
  personalizationHooks: string[];
  contactFindings: { nameFound?: string; titleFound?: string; note?: string };
  sources: string[];
  confidence: number;
};

export type ComposedEmail = {
  subject: string;
  body: string;
  rationale: string;
  personalizationUsed: string[];
};

export type VerificationCheck = {
  claim: string;
  status: 'VERIFIED' | 'UNVERIFIED' | 'CONTRADICTED';
  evidence?: string;
  source?: string;
};

export type VerificationCorrection = {
  issue: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  fix: string;
};

export type VerificationResult = {
  verdict: 'PASS' | 'REVISE' | 'BLOCK';
  confidence: number;
  checks: VerificationCheck[];
  corrections: VerificationCorrection[];
  contactVerified: boolean;
  contactNotes: string;
  sources: string[];
};

export type ReplyAnalysis = {
  summary: string;
  keyPoints: string[];
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  intent:
    | 'INTERESTED'
    | 'MEETING_REQUEST'
    | 'QUESTION'
    | 'NOT_INTERESTED'
    | 'OUT_OF_OFFICE'
    | 'UNSUBSCRIBE'
    | 'REFERRAL'
    | 'OTHER';
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
  suggestedAction: string;
  shouldStopSequence: boolean;
};

export type InsightsResult = {
  headline: string;
  strengths: string[];
  problems: { issue: string; evidence: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }[];
  recommendations: { action: string; why: string; expectedImpact: string }[];
  benchmark: string;
};
