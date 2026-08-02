"use client";

import { useState } from "react";
import PassCheck from "./pass-check";
import { cn } from "@/lib/utils";

type AuthClient = {
  signIn: {
    social: (opts: {
      provider: string;
      callbackURL: string;
    }) => Promise<unknown>;
    email: (opts: {
      email: string;
      password: string;
    }) => Promise<{ error?: { message?: string } | null }>;
  };
  signUp: {
    email: (opts: {
      email: string;
      password: string;
      name: string;
      gender?: string;
    }) => Promise<{ error?: { message?: string } | null }>;
  };
  requestPasswordReset: (opts: {
    email: string;
    redirectTo: string;
  }) => Promise<{ error?: { message?: string } | null }>;
};

type Mode = "login" | "signup" | "forgot";

type Props = {
  authClient: AuthClient;
  /** Absolute store origin used for OAuth + password-reset redirects. */
  appUrl: string;
  /**
   * Optional post-auth absolute URL (already sanitized by LoginClient).
   * Used as Google OAuth callbackURL so admin returnTo works after social login.
   */
  successRedirect?: string | null;
  onSuccess: () => void;
};

const shortLogoUrl = "/logos/mantomart-logo-short.png";
const fullLogoUrl = "/logos/mantomart-logo.png";
const heroImageUrl = "/images/login-hero-image.webp";
const brandName = "Mantomart";

const fieldInputClass =
  "w-full appearance-none rounded-none border-0 border-b-[1.5px] border-solid border-[#ccc] bg-transparent pt-2.5 pr-10 pb-1.5 pl-0 text-base text-[#111] outline-none transition-[border-color] duration-[180ms] ease-in-out placeholder:text-base placeholder:text-[#aaa] focus:border-[#555]";

const fieldClass = "relative mb-[18px]";

export default function LoginForm({
  authClient,
  appUrl,
  successRedirect,
  onSuccess,
}: Props) {
  const APP_URL = appUrl.replace(/\/$/, "") || "http://localhost:8000";
  const oauthCallback =
    successRedirect && successRedirect.trim()
      ? successRedirect
      : `${APP_URL}/home`;

  const [mode, setMode] = useState<Mode>("login");

  // signup fields
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [signupPasswordFocused, setSignupPasswordFocused] = useState(false);

  // login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);

  // forgot password fields
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function handleGoogle() {
    setError("");
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: oauthCallback,
      });
    } catch {
      setError("Google sign-in failed. Please try again.");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (mode === "signup") {
      if (!name.trim()) return setError("Please enter your name.");
      if (!gender) return setError("Please select your gender.");
      if (!signupEmail.trim()) return setError("Please enter your email address.");
      if (!signupPassword) return setError("Please enter a password.");
      if (signupPassword !== confirmPassword) {
        return setError("Passwords do not match.");
      }
    }

    if (mode === "login") {
      if (!loginEmail.trim() || !loginPassword) {
        return setError("Please fill in all fields.");
      }
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const res = await authClient.signIn.email({
          email: loginEmail.trim(),
          password: loginPassword,
        });
        if (res?.error) {
          setError(res.error.message ?? "Login failed. Please try again.");
        } else {
          onSuccess();
        }
      } else if (mode === "signup") {
        const res = await authClient.signUp.email({
          email: signupEmail.trim(),
          password: signupPassword,
          name: name.trim(),
          gender,
        });
        if (res?.error) {
          setError(res.error.message ?? "Sign-up failed. Please try again.");
        } else {
          onSuccess();
        }
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!forgotEmail.trim()) {
      return setError("Please enter your email address.");
    }

    setLoading(true);
    try {
      const res = await authClient.requestPasswordReset({
        email: forgotEmail.trim(),
        redirectTo: `${APP_URL}/reset-password`,
      });
      if (res?.error) {
        setError(res.error.message ?? "Failed to send reset email.");
      } else {
        setForgotSent(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className={cn(
        "flex min-h-screen w-full flex-col bg-white text-[#111] antialiased",
        "min-[600px]:items-center min-[600px]:bg-[#f0f1f3] min-[600px]:bg-[linear-gradient(135deg,#dfeee7,#c3ebfd,#e2bbfc)]",
        "min-[1024px]:h-screen min-[1024px]:items-center min-[1024px]:pr-4",
      )}
    >
      <header
        className={cn(
          "mx-auto hidden w-full max-w-[1200px] py-2.5 px-4",
          "min-[1024px]:flex",
        )}
      >
        <div>
          {/* Decorative brand assets — next/image not required for static public logos */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullLogoUrl}
            alt="Mantomart"
            className="h-auto w-[240px] object-contain"
          />
        </div>
        <div className="grow" />
      </header>

      <div
        className={cn(
          "w-full",
          "min-[600px]:items-center min-[600px]:justify-center min-[1024px]:mx-auto min-[1024px]:flex min-[1024px]:h-[84%] min-[1024px]:w-full min-[1024px]:max-w-[1200px] min-[1024px]:items-center min-[1024px]:justify-center",
        )}
      >
        <div
          className={cn(
            "min-[600px]:flex min-[600px]:justify-center min-[600px]:items-center min-[1024px]:grid min-[1024px]:w-full min-[1024px]:grid-cols-[1fr_410px] min-[1024px]:items-center min-[1024px]:gap-[60px]",
          )}
        >
          <div
            className={cn(
              "hidden",
              "min-[1024px]:flex min-[1024px]:items-center min-[1024px]:justify-center",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImageUrl}
              alt=""
              className="pointer-events-none h-auto w-full max-w-[660px] select-none object-contain"
            />
          </div>

          <div
            className={cn(
              "w-full max-w-full px-6 pb-12 pt-10",
              "min-[600px]:my-10 min-[600px]:max-w-120 min-[600px]:rounded-[18px] min-[600px]:bg-white min-[600px]:px-11 min-[600px]:pb-11 min-[600px]:pt-12 min-[600px]:shadow-[0_2px_24px_rgba(0,0,0,0.09),0_1px_4px_rgba(0,0,0,0.05)]",
              "min-[1024px]:m-0 min-[1024px]:max-w-105 min-[1024px]:rounded-2xl min-[1024px]:bg-white min-[1024px]:px-9 min-[1024px]:py-10 min-[1024px]:shadow-[0_10px_40px_rgba(0,0,0,0.08)] ",
            )}
          >
            <div className="mb-7 flex items-center gap-2.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#e7e7e7]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shortLogoUrl}
                  alt=""
                  className="h-10 w-10 object-contain"
                />
              </div>
              <span className="text-[26px] font-bold tracking-[-0.3px] text-[#111]">
                {brandName}
              </span>
            </div>

            {mode === "forgot" && (
              <>
                <h1
                  className={cn(
                    "mb-[30px] text-[26px] font-bold leading-tight tracking-[-0.5px] text-[#111]",
                    "min-[600px]:text-[30px]",
                  )}
                >
                  Reset password
                </h1>

                {forgotSent ? (
                  <div className="flex flex-col gap-2.5">
                    <p className="text-lg font-bold text-[#111]">
                      Check your inbox
                    </p>
                    <p className="mb-2 text-sm leading-[1.6] text-[#666]">
                      We sent a password reset link to{" "}
                      <strong>{forgotEmail}</strong>. It expires in 1 hour.
                    </p>
                    <button
                      className="mb-[18px] block w-full cursor-pointer border-0 bg-transparent text-center text-[15px] font-medium text-[#2d7ff9] hover:underline"
                      type="button"
                      onClick={() => {
                        setForgotSent(false);
                        switchMode("login");
                      }}
                    >
                      Back to log in
                    </button>
                  </div>
                ) : (
                  <form
                    className="flex flex-col"
                    onSubmit={handleForgot}
                    noValidate
                  >
                    <p className="mb-6 text-sm leading-[1.6] text-[#666]">
                      Enter the email address associated with your account and
                      we&apos;ll send you a link to reset your password.
                    </p>

                    <div className={fieldClass}>
                      <input
                        className={fieldInputClass}
                        type="email"
                        placeholder="Email address"
                        required
                        autoComplete="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                      />
                    </div>

                    {error && (
                      <p
                        className="-mt-3 mb-3 text-[13px] text-[#e53935]"
                        role="alert"
                      >
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      className={cn(
                        "mb-5 mt-4 w-full cursor-pointer rounded-full border-0 bg-[#2d7ff9] px-5 py-3 text-[17px] font-semibold text-white transition-[background,transform] duration-150 ease-in-out",
                        "hover:enabled:bg-[#1a6fe0]",
                        "active:enabled:scale-[0.985]",
                        "disabled:cursor-not-allowed disabled:opacity-55",
                      )}
                      disabled={loading}
                    >
                      {loading ? "Sending…" : "Send reset link"}
                    </button>

                    <button
                      className="mb-[18px] block w-full cursor-pointer border-0 bg-transparent text-center text-[15px] font-medium text-[#2d7ff9] hover:underline"
                      type="button"
                      onClick={() => switchMode("login")}
                    >
                      Back to log in
                    </button>
                  </form>
                )}
              </>
            )}

            {mode !== "forgot" && (
              <>
                <h1
                  className={cn(
                    "mb-[30px] text-[26px] font-bold leading-tight tracking-[-0.5px] text-[#111]",
                    "min-[600px]:text-[30px]",
                  )}
                >
                  {mode === "login" ? "Log In" : "Create Account"}
                </h1>

                <form
                  className="flex flex-col"
                  onSubmit={handleSubmit}
                  noValidate
                >
                  {mode === "signup" && (
                    <>
                      <div className={fieldClass}>
                        <input
                          className={fieldInputClass}
                          type="text"
                          placeholder="Full name"
                          required
                          autoComplete="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>

                      <div className={fieldClass}>
                        <input
                          className={fieldInputClass}
                          type="email"
                          placeholder="Email address"
                          required
                          autoComplete="email"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                        />
                      </div>

                      <div className={cn(fieldClass, "relative")}>
                        <input
                          className={fieldInputClass}
                          type={showSignupPw ? "text" : "password"}
                          placeholder="Password"
                          required
                          autoComplete="new-password"
                          value={signupPassword}
                          onChange={(e) => setSignupPassword(e.target.value)}
                          onFocus={() => setSignupPasswordFocused(true)}
                          onBlur={() => setSignupPasswordFocused(false)}
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 flex -translate-y-1/2 cursor-pointer items-center border-0 bg-transparent p-1 leading-none text-[#999] hover:text-[#555]"
                          onClick={() => setShowSignupPw((v) => !v)}
                          aria-label={
                            showSignupPw ? "Hide password" : "Show password"
                          }
                        >
                          {showSignupPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                        <div className="pointer-events-none absolute bottom-full right-5 z-10 mb-2 w-[240px]">
                          <PassCheck
                            password={signupPassword}
                            show={signupPasswordFocused}
                          />
                        </div>
                      </div>

                      <div className={fieldClass}>
                        <input
                          className={fieldInputClass}
                          type={showConfirmPw ? "text" : "password"}
                          placeholder="Confirm password"
                          required
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 flex -translate-y-1/2 cursor-pointer items-center border-0 bg-transparent p-1 leading-none text-[#999] hover:text-[#555]"
                          onClick={() => setShowConfirmPw((v) => !v)}
                          aria-label={
                            showConfirmPw ? "Hide password" : "Show password"
                          }
                        >
                          {showConfirmPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>

                      <div className={fieldClass}>
                        <div className="relative">
                          <select
                            className={cn(
                              "w-full cursor-pointer appearance-none rounded-none border-0 border-b-[1.5px] border-solid border-[#ccc] bg-transparent py-2.5 pr-10 pl-0 text-base outline-none transition-[border-color] duration-[180ms] ease-in-out focus:border-[#555]",
                              !gender ? "text-[#aaa]" : "text-[#111]",
                            )}
                            value={gender}
                            onChange={(e) => setGender(e.target.value)}
                            required
                          >
                            <option value="" disabled className="bg-white text-[#111]">
                              Gender
                            </option>
                            <option value="male" className="bg-white text-[#111]">
                              Male
                            </option>
                            <option value="female" className="bg-white text-[#111]">
                              Female
                            </option>
                            <option value="other" className="bg-white text-[#111]">
                              Other
                            </option>
                            <option
                              value="prefer_not_to_say"
                              className="bg-white text-[#111]"
                            >
                              Prefer not to say
                            </option>
                          </select>
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 leading-none text-[#999]">
                            <ChevronDownIcon />
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  {mode === "login" && (
                    <>
                      <div className={fieldClass}>
                        <input
                          className={fieldInputClass}
                          type="email"
                          placeholder="Email address"
                          required
                          autoComplete="email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                        />
                      </div>

                      <div className={fieldClass}>
                        <input
                          className={fieldInputClass}
                          type={showLoginPw ? "text" : "password"}
                          placeholder="Password"
                          required
                          autoComplete="current-password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 flex -translate-y-1/2 cursor-pointer items-center border-0 bg-transparent p-1 leading-none text-[#999] hover:text-[#555]"
                          onClick={() => setShowLoginPw((v) => !v)}
                          aria-label={
                            showLoginPw ? "Hide password" : "Show password"
                          }
                        >
                          {showLoginPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>

                      <div className="mb-[18px] flex justify-end">
                        <button
                          className="cursor-pointer border-0 bg-transparent p-0 text-sm text-[#2d7ff9] hover:underline"
                          type="button"
                          onClick={() => switchMode("forgot")}
                        >
                          Forgot password?
                        </button>
                      </div>
                    </>
                  )}

                  {error && (
                    <p
                      className="-mt-3 mb-3 text-[13px] text-[#e53935]"
                      role="alert"
                    >
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    className={cn(
                      "mb-5 mt-4 w-full cursor-pointer rounded-full border-0 bg-[#2d7ff9] px-5 py-3 text-[17px] font-semibold text-white transition-[background,transform] duration-150 ease-in-out",
                      "hover:enabled:bg-[#1a6fe0]",
                      "active:enabled:scale-[0.985]",
                      "disabled:cursor-not-allowed disabled:opacity-55",
                    )}
                    disabled={loading}
                  >
                    {loading
                      ? "Please wait…"
                      : mode === "login"
                        ? "Log In"
                        : "Create Account"}
                  </button>
                </form>

                <button
                  className="mb-[18px] block w-full cursor-pointer border-0 bg-transparent text-center text-[15px] font-medium text-[#2d7ff9] hover:underline"
                  onClick={() =>
                    switchMode(mode === "login" ? "signup" : "login")
                  }
                  type="button"
                >
                  {mode === "login"
                    ? "Don't have an account? Sign up"
                    : "Already have an account? Log in"}
                </button>

                <p className="mb-7 text-[12.5px] leading-[1.6] text-[#888]">
                  By {mode === "login" ? "logging in" : "creating an account"},
                  you agree to mantomart&apos;s{" "}
                  <a
                    href="#"
                    className="text-[#2d7ff9] no-underline hover:underline"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="#"
                    className="text-[#2d7ff9] no-underline hover:underline"
                  >
                    Privacy Policy
                  </a>
                  .
                </p>

                <div className="mb-5 flex items-center gap-3">
                  <div className="h-px grow bg-[#ddd]" />
                  <p className="text-sm font-medium text-[#888]">or</p>
                  <div className="h-px grow bg-[#ddd]" />
                </div>

                <button
                  className={cn(
                    "mb-3 flex w-full cursor-pointer items-center justify-center gap-3 rounded-full border-[1.8px] border-solid border-[#111] bg-white px-5 py-3 text-base font-semibold text-[#111] transition-[background,transform] duration-150 ease-in-out",
                    "hover:bg-[#f5f5f5]",
                    "active:scale-[0.985]",
                  )}
                  onClick={handleGoogle}
                  type="button"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
