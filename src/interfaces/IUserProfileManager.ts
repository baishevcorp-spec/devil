export interface UserProfile {
  codingStyle: {
    indentStyle: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
    semicolons: boolean;
  };
  preferredLibraries: string[];
  preferredPatterns: string[];
  customInstructions: string[];
  interactionHistory: InteractionRecord[];
}

export interface InteractionRecord {
  timestamp: number;
  action: string;
  details: string;
}

export interface IUserProfileManager {
  getProfile(): Promise<UserProfile>;
  updateProfile(updates: Partial<UserProfile>): Promise<void>;
  addPreference(key: string, value: string): Promise<void>;
  getPreferences(): Promise<Record<string, string[]>>;
  addInteraction(record: InteractionRecord): Promise<void>;
  getRecentInteractions(limit?: number): Promise<InteractionRecord[]>;
}
