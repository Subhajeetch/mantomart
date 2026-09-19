"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import config from "@/mine.config";
import PassCheck from "./pass-check";
import { cn } from "@/lib/utils";

type AuthClient = {
  signIn: {
    social: (opts: { provider: string; callbackURL: string }) => Promise<unknown>;
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
  appUrl: string;
  successRedirect?: string | null;
  onSuccess: () => void;
};

const inputClass =
  "h-12 w-full rounded-xl border border-[#8c8c8c] bg-white px-4 text-[15px] text-[#171717] outline-none transition-[border,box-shadow] placeholder:text-[#777] focus:border-primary focus:ring-4 focus:ring-primary/10";
const labelClass = "mb-2 block text-[14px] font-semibold text-[#171717]";

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
      : `${APP_URL}/user`;

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupPasswordFocused, setSignupPasswordFocused] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function handleGoogle() {
    setError("");
    setLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: oauthCallback,
      });
    } catch {
      setError("Google sign-in failed. Please try again.");
      setLoading(false);
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

    if (mode === "login" && (!loginEmail.trim() || !loginPassword)) {
      return setError("Please fill in all fields.");
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
      } else {
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
    if (!forgotEmail.trim()) return setError("Please enter your email address.");

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

  const title =
    mode === "forgot"
      ? "Reset your password"
      : mode === "signup"
        ? "Create an account"
        : "Welcome back";

  return (
    <main className="min-h-screen bg-white text-[#171717]">
      <header className="border-b border-[#e5e5e5]">
        <div className="mx-auto flex h-24 w-full max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label={`${config.brandName} home`}>
            <Image
              src={config.logoLong}
              alt={config.brandName}
              width={190}
              height={48}
              priority
              className="h-9 w-auto object-contain sm:h-10"
            />
          </Link>
          <Link
            href="/"
            aria-label="Close login"
            className="rounded-full p-2 text-[#1e3b12] transition-colors hover:bg-[#f4f6f1]"
          >
            <CloseIcon />
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[520px] px-5 pb-16 pt-10 sm:px-8 sm:pt-12 md:pt-14">
        <div className="mb-8 text-center">
          <h1 className="text-[29px] font-bold tracking-[-0.035em] sm:text-[32px]">
            {title}
          </h1>
          {mode !== "forgot" && (
            <p className="mt-3 text-[15px] text-[#494949]">
              {mode === "login" ? "New here? " : "Already have an account?"}
              {mode === "login" && (
                <button
                  type="button"
                  className="ml-1 font-semibold text-primary underline underline-offset-2 hover:opacity-75"
                  onClick={() => switchMode("signup")}
                >
                  Sign up
                </button>
              )}
              {mode === "signup" && (
                <button
                  type="button"
                  className="ml-1 font-semibold text-primary underline underline-offset-2 hover:opacity-75"
                  onClick={() => switchMode("login")}
                >
                  Log in
                </button>
              )}
            </p>
          )}
        </div>

        {mode === "forgot" ? (
          forgotSent ? (
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-5 text-center">
              <h2 className="font-semibold">Check your inbox</h2>
              <p className="mt-2 text-sm leading-6 text-[#555]">
                We sent a password reset link to{" "}
                <strong className="text-[#171717]">{forgotEmail}</strong>.
              </p>
              <button
                type="button"
                className="mt-5 text-sm font-semibold text-primary underline underline-offset-2"
                onClick={() => {
                  setForgotSent(false);
                  switchMode("login");
                }}
              >
                Back to log in
              </button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleForgot} noValidate>
              <Field label="Your email address">
                <input
                  className={inputClass}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="Email address"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                />
              </Field>
              <ErrorMessage error={error} />
              <SubmitButton loading={loading}>Send reset link</SubmitButton>
              <button
                type="button"
                className="text-sm font-semibold text-primary underline underline-offset-2"
                onClick={() => switchMode("login")}
              >
                Back to log in
              </button>
            </form>
          )
        ) : (
          <>
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {mode === "signup" && (
                <>
                  <Field label="Your name">
                    <input
                      className={inputClass}
                      type="text"
                      required
                      autoComplete="name"
                      placeholder="Full name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field label="Your email address">
                    <input
                      className={inputClass}
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="Email address"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                    />
                  </Field>
                  <Field label="Your password">
                    <div className="relative">
                      <input
                        className={cn(inputClass, "pr-12")}
                        type={showSignupPassword ? "text" : "password"}
                        required
                        autoComplete="new-password"
                        placeholder="Password"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        onFocus={() => setSignupPasswordFocused(true)}
                        onBlur={() => setSignupPasswordFocused(false)}
                      />
                      <PasswordToggle
                        shown={showSignupPassword}
                        onClick={() => setShowSignupPassword((value) => !value)}
                      />
                      <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-60">
                        <PassCheck
                          password={signupPassword}
                          show={signupPasswordFocused}
                        />
                      </div>
                    </div>
                  </Field>
                  <Field label="Confirm your password">
                    <div className="relative">
                      <input
                        className={cn(inputClass, "pr-12")}
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        autoComplete="new-password"
                        placeholder="Confirm password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                      <PasswordToggle
                        shown={showConfirmPassword}
                        onClick={() => setShowConfirmPassword((value) => !value)}
                      />
                    </div>
                  </Field>
                  <Field label="Gender">
                    <select
                      className={cn(inputClass, !gender && "text-[#777]")}
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Select an option
                      </option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </Field>
                </>
              )}

              {mode === "login" && (
                <>
                  <Field label="Your email address">
                    <input
                      className={inputClass}
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="Email address"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </Field>
                  <Field label="Your password">
                    <div className="relative">
                      <input
                        className={cn(inputClass, "pr-12")}
                        type={showLoginPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        placeholder="Password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                      />
                      <PasswordToggle
                        shown={showLoginPassword}
                        onClick={() => setShowLoginPassword((value) => !value)}
                      />
                    </div>
                  </Field>
                  <button
                    type="button"
                    className="text-sm font-semibold text-primary underline underline-offset-2 hover:opacity-75"
                    onClick={() => switchMode("forgot")}
                  >
                    Trouble logging in?
                  </button>
                </>
              )}

              <ErrorMessage error={error} />
              <SubmitButton loading={loading}>
                {mode === "login" ? "Log in" : "Create account"}
              </SubmitButton>
            </form>

            <div className="mt-7">
              <p className="mb-4 text-[15px] text-[#555]">Or log in with</p>
              <button
                type="button"
                className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#d8d8d8] bg-white text-[15px] font-semibold transition-colors hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleGoogle}
                disabled={loading}
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </div>

            <p className="mt-8 text-center text-xs leading-5 text-[#777]">
              By continuing, you agree to {config.brandName}&apos;s{" "}
              <a href="#" className="underline underline-offset-2">
                Terms
              </a>{" "}
              and{" "}
              <a href="#" className="underline underline-offset-2">
                Privacy Policy
              </a>
              .
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function ErrorMessage({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p
      className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm leading-5 text-destructive"
      role="alert"
    >
      {error}
    </p>
  );
}

function SubmitButton({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className="h-12 w-full rounded-full bg-primary px-5 text-[15px] font-bold text-primary-foreground transition-all hover:brightness-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={loading}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

function PasswordToggle({
  shown,
  onClick,
}: {
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#355126] hover:bg-[#f4f6f1]"
      onClick={onClick}
      aria-label={shown ? "Hide password" : "Show password"}
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
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
      width="19"
      height="19"
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
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
    </svg>
  );
}
