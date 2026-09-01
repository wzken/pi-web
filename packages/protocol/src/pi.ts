export interface PiModelSummary {
  provider: string;
  id: string;
  label: string;
}

export interface PiSkillSummary {
  name: string;
  description: string;
  path: string | null;
  scope: "user" | "project" | "temporary" | "unknown";
  source: string | null;
}

export interface PiStatus {
  available: boolean;
  executable: string;
  version: string | null;
  models: PiModelSummary[];
  skills: PiSkillSummary[];
  packages: string[];
  errors: string[];
}

export interface PiUpdateInfo {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  changelogUrl: string;
  note: string | null;
  error: string | null;
}

export interface PiDoctorProbe {
  available: boolean;
  version: string | null;
  minimumVersion: string;
  compatible: boolean;
  rpcStartable: boolean;
  rpcCommands: string[];
  packageCommands: boolean;
  errors: string[];
}

export interface SessiondDoctorResult {
  database: boolean;
  socket: string;
  scheduler: boolean;
  activeWorkers: number;
  pi: PiDoctorProbe;
}
