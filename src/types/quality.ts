export interface QualityCheckResult {
  score: number; // 0.0 - 1.0
  passed: boolean;
  feedback: string;
}

export interface QualityReport {
  packageName: string;
  overallScore: number;
  toolCoverage: number;
  responseTimes: Record<string, number>;
  securityIssues: string[];
  timestamp: string;
}

// ── Security Scanner Types ──

export interface ScanFinding {
  severity: "error" | "warn" | "info";
  rule: string;
  location: string;
  message: string;
  line?: number;
}

export interface ScanResult {
  findings: ScanFinding[];
  summary: { errors: number; warnings: number; info: number };
  scannedAt: string;
}

// ── Quality Test Types ──

export interface ToolTestResult {
  name: string;
  success: boolean;
  responseTimeMs: number;
  error?: string;
}

export interface ResourceTestResult {
  uri: string;
  accessible: boolean;
  error?: string;
}

export interface TestResult {
  packageName: string;
  toolResults: ToolTestResult[];
  resourceResults: ResourceTestResult[];
  overallScore: number;
  duration: number;
  testedAt: string;
}

// ── Ratings ──

export interface Rating {
  score: number; // 1-5
  review?: string;
  userId: string;
  createdAt: string;
}

// ── Verification ──

export interface VerificationStatus {
  verified: boolean;
  verifiedAt?: string;
  qualityReport?: QualityReport;
  scanResult?: ScanResult;
  ratings: { average: number; count: number };
  compatibilityMatrix: Record<string, boolean>;
}
