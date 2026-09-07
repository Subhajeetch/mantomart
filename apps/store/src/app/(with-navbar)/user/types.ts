export type ConsumerProfile = {
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: "male" | "female" | "other" | "prefer_not_to_say" | null;
  emailNotifications: boolean;
  smsNotifications: boolean;
  currency: string;
  locale: string;
  timezone: string;
};

export type ConsumerSession = {
  id: string;
  userAgent: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  current: boolean;
};

export type AccountResponse = {
  profile: ConsumerProfile;
  linkedProviders: string[];
  sessions: ConsumerSession[];
};
