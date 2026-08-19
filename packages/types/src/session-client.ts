type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  role?: "customer" | "admin" | "owner";
  /**
   * Denormalized completed-order count. `0` means a first-time shopper
   * (used to show `audience: 'new_user'` homepage promo slides).
   */
  totalOrders?: number;
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