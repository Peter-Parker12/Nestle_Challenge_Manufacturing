export const ENGINE_VERSION = "baf1-engine-1.0.0";

export type AttrDef = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  type: "numeric" | "choice";
  choices?: string[] | null;
  required: boolean;
  absMin: number | null;
  absMax: number | null;
};

export type ParamDef = {
  id: string;
  code: string;
  name: string;
  unit: string;
  absMin: number;
  absMax: number;
  isCritical: boolean;
  isLocked: boolean;
  stepSeq: number;
};

export type Attrs = Record<string, number | string>;

/** A closed launch used as evidence. */
export type HistLaunch = {
  launchId: string;
  code: string;
  productName: string;
  lineId: string;
  attrs: Attrs;
  /** Settings of the accepted run (parameter code -> actual value). null if the launch never reached acceptance. */
  acceptedParams: Record<string, number> | null;
  runs: number;
  totalLossKg: number;
  firstPass: boolean;
  /** reason codes recorded on failed / marginal runs of this launch */
  reasons: string[];
};

export type WeightLevels = {
  attributes: Record<string, number>; // attribute code -> 0..5
  parameters: Record<string, number>; // parameter code -> 0..5
};

export type LineCaps = Record<string, { min: number; max: number }>; // parameter code -> capability

export type SmeRule = {
  id: string;
  condition: RuleCondition;
  severity: "Low" | "Medium" | "High";
  message: string;
};
export type RuleCondition =
  | { attr: string; op: ">" | ">=" | "<" | "<=" | "=="; value: number | string }
  | { all: RuleCondition[] };

export type Severity = "Low" | "Medium" | "High";
export type Confidence = "High" | "Medium" | "Low";

export type RiskFlag = {
  type: "low_evidence" | "rework_history" | "out_of_range" | "spread" | "sme_rule" | "clipped";
  severity: Severity;
  message: string;
  detail?: Record<string, unknown>;
  smeRuleId?: string;
};

export type Neighbour = {
  launchId: string;
  code: string;
  similarity: number;
  rank: number;
  wasGood: boolean; // reached acceptance on the first run
};

export type RecLine = {
  code: string;
  startValue: number;
  windowLow: number;
  windowHigh: number;
  clipped: boolean;
  clipReason?: string;
  basedOn: number; // number of neighbour launches contributing
};

export type RecResult = {
  engineVersion: string;
  neighbours: Neighbour[];
  lines: RecLine[];
  confidence: Confidence;
  flags: RiskFlag[];
  overallRisk: Severity;
  nMatched: number;
  meanSimilarity: number;
  normalisedWeights: { attributes: Record<string, number>; parameters: Record<string, number> };
};

export type RecInput = {
  attrDefs: AttrDef[];
  paramDefs: ParamDef[];
  target: Attrs;
  lineId: string;
  lineCaps: LineCaps;
  history: HistLaunch[];
  weights: WeightLevels;
  rules: SmeRule[];
  topN: number;
  minMatched: number;
};
