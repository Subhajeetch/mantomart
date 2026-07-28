"use client";

import { useState } from "react";
import PassCheck from "./pass-check";
import "../styles/login-form.css";

type AuthClient = {
  signIn: {
    social: (opts: { provider: string; callbackURL: string }) => Promise<unknown>;
    email: (opts: { email: string; password: string }) => Promise<{ error?: { message?: string } | null }>;
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
  appUrl?: string;
  onSuccess: () => void;
};


const shortLogoUrl  = "/logos/mantomart-logo-short.png";
const fullLogoUrl   = "/logos/mantomart-logo.png";
const heroImageUrl  = "/images/login-hero-image.webp";
const brandName = "Mantomart"

export default function LoginForm({ authClient, appUrl, onSuccess }: Props) {
  const APP_URL = appUrl ?? "http://localhost:8000";

  const [mode, setMode] = useState<Mode>("login");

  // signup fields
  const [name, setName]                     = useState("");
  const [gender, setGender]                 = useState("");
  const [signupEmail, setSignupEmail]       = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignupPw, setShowSignupPw]     = useState(false);
  const [showConfirmPw, setShowConfirmPw]   = useState(false);
  const [signupPasswordFocused, setSignupPasswordFocused] = useState(false);

  //login fields
  const [loginEmail, setLoginEmail]         = useState("");
  const [loginPassword, setLoginPassword]   = useState("");
  const [showLoginPw, setShowLoginPw]       = useState(false);

  //forgot password fields
  const [forgotEmail, setForgotEmail]       = useState("");
  const [forgotSent, setForgotSent]         = useState(false);

  //shared 
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState("");



  //helpers
  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  //handlers
  async function handleGoogle() {
    setError("");
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: `${APP_URL}/home` });
    } catch {
      setError("Google sign-in failed. Please try again.");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (mode === "signup") {
      if (!name.trim())        return setError("Please enter your name.");
      if (!gender)             return setError("Please select your gender.");

      if (!signupPassword)     return setError("Please enter a password.");
      if (signupPassword !== confirmPassword) return setError("Passwords do not match.");
    }

    setLoading(true);
    try {
      if (mode === "login") {
        if (!loginEmail || !loginPassword) return setError("Please fill in all fields.");
        const res = await authClient.signIn.email({ email: loginEmail, password: loginPassword });
        if (res?.error) setError(res.error.message ?? "Login failed. Please try again.");
        else onSuccess();

      } else if (mode === "signup") {
        const res = await authClient.signUp.email({
          email: signupEmail,
          password: signupPassword,
          name: name.trim(),
          gender,
        });
        if (res?.error) setError(res.error.message ?? "Sign-up failed. Please try again.");
        else onSuccess();
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
    if (!forgotEmail) return setError("Please enter your email address.");

    setLoading(true);
    try {
      const res = await authClient.requestPasswordReset({
        email: forgotEmail,
        redirectTo: `${APP_URL}/reset-password`,
      });
      if (res?.error) setError(res.error.message ?? "Failed to send reset email.");
      else setForgotSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  //render

  return (
    <main className="auth-page">
      <header>
        <div className="full-logo-container">
          <img src={fullLogoUrl} alt="Logo" className="full-logo" />
        </div>
        <div className="header-spacer" />
      </header>

      <div className="auth-grid-container">
        <div className="auth-layout">
          <div className="auth-hero">
            <img src={heroImageUrl} alt="hero" />
          </div>

          <div className="auth-container">
            {/* brand */}
            <div className="brand">
              <div className="brand-icon">
                <img src={shortLogoUrl} alt="Logo" className="short-logo" />
              </div>
              <span className="brand-name">{brandName}</span>
            </div>

            {/*forgot password*/}
            {mode === "forgot" && (
              <>
                <h1 className="auth-heading">Reset password</h1>

                {forgotSent ? (
                  <div className="forgot-success">
                    <p className="forgot-success-title">Check your inbox</p>
                    <p className="forgot-success-body">
                      We sent a password reset link to <strong>{forgotEmail}</strong>. It expires in 1 hour.
                    </p>
                    <button className="switch-link" type="button" onClick={() => { setForgotSent(false); switchMode("login"); }}>
                      Back to log in
                    </button>
                  </div>
                ) : (
                  <form className="auth-form" onSubmit={handleForgot} noValidate>
                    <p className="forgot-hint">
                      Enter the email address associated with your account and we'll send you a link to reset your password.
                    </p>

                    <div className="field">
                      <input
                        className="field-input"
                        type="email"
                        placeholder="Email address"
                        required
                        autoComplete="email"
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                      />
                    </div>

                    {error && <p className="error-msg" role="alert">{error}</p>}

                    <button type="submit" className="btn-primary" disabled={loading}>
                      {loading ? "Sending…" : "Send reset link"}
                    </button>

                    <button className="switch-link" type="button" onClick={() => switchMode("login")}>
                      Back to log in
                    </button>
                  </form>
                )}
              </>
            )}

            {/* login/signup*/}
            {mode !== "forgot" && (
              <>
                <h1 className="auth-heading">
                  {mode === "login" ? "Log In" : "Create Account"}
                </h1>

                <form className="auth-form" onSubmit={handleSubmit} noValidate>

                  {/*signup fields*/}
                  {mode === "signup" && (
                    <>
                      <div className="field">
                        <input
                          className="field-input"
                          type="text"
                          placeholder="Full name"
                          required
                          autoComplete="name"
                          value={name}
                          onChange={e => setName(e.target.value)}
                        />
                      </div>

                      <div className="field">
                        <input
                          className="field-input"
                          type="email"
                          placeholder="Email address"
                          required
                          autoComplete="email"
                          value={signupEmail}
                          onChange={e => setSignupEmail(e.target.value)}
                        />
                      </div>

                      <div className="field field-password">
                        <input
                          className="field-input"
                          type={showSignupPw ? "text" : "password"}
                          placeholder="Password"
                          required
                          autoComplete="new-password"
                          value={signupPassword}
                          onChange={e => setSignupPassword(e.target.value)}
                          onFocus={() => setSignupPasswordFocused(true)}
                          onBlur={() => setSignupPasswordFocused(false)}
                        />
                        <button
                          type="button"
                          className="pw-toggle"
                          onClick={() => setShowSignupPw(v => !v)}
                          aria-label={showSignupPw ? "Hide password" : "Show password"}
                        >
                          {showSignupPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                        {/* pass float */}
                        <div className="password-strength-float">
                          <PassCheck password={signupPassword} show={signupPasswordFocused} />
                        </div>
                      </div>

                      <div className="field">
                        <input
                          className="field-input"
                          type={showConfirmPw ? "text" : "password"}
                          placeholder="Confirm password"
                          required
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="pw-toggle"
                          onClick={() => setShowConfirmPw(v => !v)}
                          aria-label={showConfirmPw ? "Hide password" : "Show password"}
                        >
                          {showConfirmPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>

                      <div className="field">
                        <div className="select-wrapper">
                          <select
                            className={`gender-select${!gender ? " unselected" : ""}`}
                            value={gender}
                            onChange={e => setGender(e.target.value)}
                            required
                          >
                            <option value="" disabled>Gender</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                            <option value="prefer_not_to_say">Prefer not to say</option>
                          </select>
                          <span className="select-arrow"><ChevronDownIcon /></span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* login*/}
                  {mode === "login" && (
                    <>
                      <div className="field">
                        <input
                          className="field-input"
                          type="email"
                          placeholder="Email address"
                          required
                          autoComplete="email"
                          value={loginEmail}
                          onChange={e => setLoginEmail(e.target.value)}
                        />
                      </div>

                      <div className="field">
                        <input
                          className="field-input"
                          type={showLoginPw ? "text" : "password"}
                          placeholder="Password"
                          required
                          autoComplete="current-password"
                          value={loginPassword}
                          onChange={e => setLoginPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="pw-toggle"
                          onClick={() => setShowLoginPw(v => !v)}
                          aria-label={showLoginPw ? "Hide password" : "Show password"}
                        >
                          {showLoginPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>

                      <div className="forgot-password-container">
                        <button
                          className="forgot-password-text"
                          type="button"
                          onClick={() => switchMode("forgot")}
                        >
                          Forgot password?
                        </button>
                      </div>
                    </>
                  )}

                  {error && <p className="error-msg" role="alert">{error}</p>}

                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? "Please wait…" : mode === "login" ? "Log In" : "Create Account"}
                  </button>
                </form>

                <button className="switch-link" onClick={() => switchMode(mode === "login" ? "signup" : "login")} type="button">
                  {mode === "login"
                    ? "Don't have an account? Sign up"
                    : "Already have an account? Log in"}
                </button>

                <p className="legal-text">
                  By {mode === "login" ? "logging in" : "creating an account"}, you agree to ragimart's{" "}
                  <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
                </p>

                <div className="or-divider-container">
                  <div className="or-divider-line" />
                  <p className="or-divider-text">or</p>
                  <div className="or-divider-line" />
                </div>

                <button className="btn-social" onClick={handleGoogle} type="button">
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

//icons
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

