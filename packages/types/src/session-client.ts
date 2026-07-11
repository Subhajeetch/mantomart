type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role?: "customer" | "admin" | "owner";
  createdAt: Date;
  updatedAt: Date;
};

export type Session = {
  user: SessionUser;
  session: {
    id: string;
    expiresAt: Date;
    token: string;
    userId: string;
  };
};