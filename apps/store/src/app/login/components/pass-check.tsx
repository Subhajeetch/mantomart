"use client";

import { useMemo } from "react";

type PasswordCheck = { label: string; pass: boolean };

type Props = {
  password: string;
  show?: boolean;
};

function getPasswordChecks(password: string): PasswordCheck[] {
  return [
    { label: "At least 8 characters",    pass: password.length >= 8 },
    { label: "One uppercase letter",      pass: /[A-Z]/.test(password) },
    { label: "One lowercase letter",      pass: /[a-z]/.test(password) },
    { label: "One number",               pass: /[0-9]/.test(password) },
    { label: "One special character",    pass: /[^A-Za-z0-9]/.test(password) },
  ];
}

function getStrength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  const passed = getPasswordChecks(password).filter(c => c.pass).length;
  if (passed <= 2) return 1;
  if (passed <= 4) return 2;
  return 3;
}

const strengthLabel = ["", "Weak", "Good", "Strong"] as const;
const strengthClass = ["", "weak", "good", "strong"] as const;

export default function PassCheck({ password, show = true }: Props) {
  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
  const strength       = useMemo(() => getStrength(password), [password]);
  const showChecks     = show && password.length > 0;

  if (!showChecks) return null;

  return (
    <div className="pw-strength-container">
      <div className="pw-strength-wrap">
        <div className="pw-strength-bars">
          {[1, 2, 3].map(level => (
            <div
              key={level}
              className={`pw-strength-bar ${strength >= level ? strengthClass[strength] : ""}`}
            />
          ))}
        </div>
        <span className={`pw-strength-label ${strengthClass[strength]}`}>
          {strengthLabel[strength]}
        </span>
      </div>

      <ul className="pw-checks">
        {passwordChecks.map(check => (
          <li key={check.label} className={`pw-check ${check.pass ? "pass" : ""}`}>
            {check.pass ? <CheckIcon /> : <DotIcon />}
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}


function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}