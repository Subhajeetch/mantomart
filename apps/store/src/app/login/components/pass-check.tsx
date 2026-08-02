"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

type PasswordCheck = { label: string; pass: boolean };

type Props = {
  password: string;
  show?: boolean;
};

function getPasswordChecks(password: string): PasswordCheck[] {
  return [
    { label: "At least 8 characters", pass: password.length >= 8 },
    { label: "One uppercase letter", pass: /[A-Z]/.test(password) },
    { label: "One lowercase letter", pass: /[a-z]/.test(password) },
    { label: "One number", pass: /[0-9]/.test(password) },
    { label: "One special character", pass: /[^A-Za-z0-9]/.test(password) },
  ];
}

function getStrength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  const passed = getPasswordChecks(password).filter((c) => c.pass).length;
  if (passed <= 2) return 1;
  if (passed <= 4) return 2;
  return 3;
}

const strengthLabel = ["", "Weak", "Good", "Strong"] as const;

const strengthBarActive = {
  1: "bg-[#ef4444]",
  2: "bg-[#f59e0b]",
  3: "bg-[#22c55e]",
} as const;

const strengthLabelColor = {
  1: "text-[#ef4444]",
  2: "text-[#f59e0b]",
  3: "text-[#22c55e]",
} as const;

function isPositiveStrength(s: 0 | 1 | 2 | 3): s is 1 | 2 | 3 {
  return s > 0;
}

export default function PassCheck({ password, show = true }: Props) {
  const passwordChecks = useMemo(() => getPasswordChecks(password), [password]);
  const strength = useMemo(() => getStrength(password), [password]);
  const showChecks = show && password.length > 0;

  if (!showChecks) return null;

  return (
    <div
      className={cn(
        "pointer-events-auto relative rounded-lg border border-[#e5e7eb] bg-white p-3 shadow-[0_4px_12px_rgba(0,0,0,0.1)]",
        "animate-in fade-in duration-200",
        "after:absolute after:bottom-[-10px] after:right-3 after:h-0 after:w-0 after:border-l-[10px] after:border-r-0 after:border-t-[10px] after:border-l-transparent after:border-r-transparent after:border-t-white after:content-[''] after:[filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.05))]",
      )}
    >
      <div className="-mt-1.5 mb-2.5 flex items-center gap-2.5">
        <div className="flex flex-1 gap-1">
          {[1, 2, 3].map((level) => (
            <div
              key={level}
              className={cn(
                "h-1 flex-1 rounded-full bg-[#e5e5e5] transition-[background] duration-[250ms] ease-in-out",
                strength >= level && isPositiveStrength(strength)
                  ? strengthBarActive[strength]
                  : undefined,
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            "min-w-[44px] text-right text-xs font-semibold",
            isPositiveStrength(strength) ? strengthLabelColor[strength] : undefined,
          )}
        >
          {strengthLabel[strength]}
        </span>
      </div>

      <ul className="mb-4 flex list-none flex-col gap-[5px] p-0">
        {passwordChecks.map((check) => (
          <li
            key={check.label}
            className={cn(
              "flex items-center gap-1.5 text-[13px] text-[#aaa] transition-colors duration-200",
              check.pass && "text-[#22c55e]",
            )}
          >
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
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}