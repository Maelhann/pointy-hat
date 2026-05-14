export type CoverageItemStatus = "matched" | "missing" | "partial";

export interface CoverageItem {
  id: string;
  type: "input" | "tool" | "catalyst";
  requirement: string;
  status: CoverageItemStatus;
  matchedTo?: string;
  confidence: number;
  required: boolean;
}

export interface CoverageResult {
  spellName: string;
  spellVersion: string;
  score: number; // 0-100
  canCast: boolean;
  items: CoverageItem[];
  missingRequired: CoverageItem[];
  missingOptional: CoverageItem[];
  warnings: string[];
}
