"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { getAccount, revokeSession } from "../api";
import type { ConsumerSession } from "../types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function deviceIcon(userAgent: string | null) {
  if (!userAgent) return Monitor;
  if (/mobile|iphone|android/i.test(userAgent)) return Smartphone;
  if (/tablet|ipad/i.test(userAgent)) return Tablet;
  return Monitor;
}

function deviceName(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/android/i.test(userAgent)) return "Android device";
  if (/windows/i.test(userAgent)) return "Windows computer";
  if (/mac os/i.test(userAgent)) return "Mac computer";
  if (/linux/i.test(userAgent)) return "Linux computer";
  return "Web browser";
}

function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unknown";
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ConsumerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConsumerSession | null>(null);

  useEffect(() => {
    getAccount().then((account) => setSessions(account.sessions)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load sessions.")).finally(() => setLoading(false));
  }, []);

  async function logout(session: ConsumerSession) {
    setBusy(session.id);
    setError(null);
    try {
      await revokeSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      if (session.current) {
        await authClient.signOut();
        window.location.assign("/login");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign out that session.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-5 md:p-10">
      <header className="border-b border-border pb-6"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Security</p><h1 className="text-2xl font-semibold tracking-tight">Manage Sessions</h1><p className="mt-2 text-sm text-muted-foreground">Review where your account is signed in and end sessions you no longer recognize.</p></header>
      {error && <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
      {loading ? <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : sessions.length === 0 ? <div className="border border-border p-8 text-center text-sm text-muted-foreground">No active sessions found.</div> : <div className="border border-border">{sessions.map((session) => { const Icon = deviceIcon(session.userAgent); return <div key={session.id} className="flex flex-col gap-4 border-b border-border p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="bg-muted p-2"><Icon className="size-4" /></div><div><p className="text-sm font-medium">{deviceName(session.userAgent)} {session.current && <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" /> This device</span>}</p><p className="mt-1 text-xs text-muted-foreground">Last active {dateLabel(session.updatedAt)} · Signed in {dateLabel(session.createdAt)}</p></div></div><button type="button" onClick={() => setConfirming(session)} disabled={busy === session.id} className="h-8 border border-border px-3 text-xs transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50">{busy === session.id ? "Signing out..." : session.current ? "Sign out" : "End session"}</button></div>; })}</div>}
      <Dialog open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this session?</DialogTitle>
            <DialogDescription>This device will be signed out and will need to authenticate again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={Boolean(busy)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirming) { const target = confirming; setConfirming(null); void logout(target); } }} disabled={Boolean(busy)}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
