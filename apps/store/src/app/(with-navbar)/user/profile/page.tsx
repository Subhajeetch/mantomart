"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, Settings, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getAccount, updateProfile } from "../api";
import type { AccountResponse, ConsumerProfile } from "../types";

const preferenceOptions = {
  currency: ["USD", "EUR", "GBP", "INR"],
  locale: ["en-US", "en-GB", "de-DE", "fr-FR"],
  timezone: ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata"],
} as const;

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function providerLabel(provider: string) {
  if (provider === "credential") return "Email and password";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export default function ProfilePage() {
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load your profile."))
      .finally(() => setLoading(false));
  }, []);

  const profile = account?.profile;
  const initials = useMemo(() => {
    const name = profile?.name ?? "";
    return name ? name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "U";
  }, [profile?.name]);

  async function saveField(field: keyof ConsumerProfile, value: string | null) {
    setSaving(true);
    setSavingField(field);
    setError(null);
    try {
      const updated = await updateProfile({ [field]: value });
      setAccount((current) => current ? { ...current, profile: updated } : current);
      setEditing(null);
      toast.add({
        title: `${fieldLabel(field)} updated`,
        description: "Your profile changes have been saved.",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save your changes.");
    } finally {
      setSaving(false);
      setSavingField(null);
    }
  }

  async function togglePreference(field: "emailNotifications" | "smsNotifications", value: boolean) {
    if (!account) return;
    setSavingField(field);
    setAccount({ ...account, profile: { ...account.profile, [field]: value } });
    try {
      const updated = await updateProfile({ [field]: value });
      setAccount((current) => current ? { ...current, profile: updated } : current);
      toast.add({
        title: `${fieldLabel(field)} updated`,
        description: "Your profile changes have been saved.",
      });
    } catch (reason) {
      setAccount({ ...account, profile: { ...account.profile, [field]: !value } });
      setError(reason instanceof Error ? reason.message : "Unable to save your preference.");
    } finally {
      setSavingField(null);
    }
  }

  if (loading) return <LoadingState />;
  if (error && !account) return <ErrorState message={error} />;
  if (!profile || !account) return <ErrorState message="Your profile is unavailable." />;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-5 md:p-10">
      <header className="border-b border-border pb-6">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Account</p>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage the personal details and preferences used across your account.</p>
      </header>

      {error && <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="border border-border">
        <div className="flex items-center gap-4 border-b border-border p-5">
          <div className="flex size-16 shrink-0 items-center justify-center bg-muted text-lg font-semibold">{profile.image ? <img src={profile.image} alt="" className="size-full object-cover" /> : initials}</div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{profile.name || "Your profile"}</h2>
            <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
          </div>
        </div>
        <div className="divide-y divide-border">
          <EditableRow label="Name" value={profile.name} editing={editing === "name"} draft={editing === "name" ? draft : profile.name} onEdit={() => { setEditing("name"); setDraft(profile.name); }} onDraft={setDraft} onSave={() => saveField("name", draft)} saving={savingField === "name"} />
          <DateOfBirthRow value={profile.dateOfBirth} editing={editing === "dateOfBirth"} onEdit={() => setEditing("dateOfBirth")} onSave={(value) => saveField("dateOfBirth", value)} saving={savingField === "dateOfBirth"} />
          <div className="flex items-center justify-between gap-4 p-5">
            <div><p className="text-xs text-muted-foreground">Gender</p><p className="mt-1 text-sm">{profile.gender?.replaceAll("_", " ") ?? "Not set"}</p></div>
            <button type="button" onClick={() => { setEditing("gender"); setDraft(profile.gender ?? ""); }} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Edit gender"><Pencil className="size-4" /></button>
          </div>
          {editing === "gender" && (
            <div className="flex items-center gap-2 bg-muted/40 p-5">
              <Select value={draft} onValueChange={(value) => setDraft(String(value))}><SelectTrigger className="flex-1"><SelectValue placeholder="Not set" /></SelectTrigger><SelectContent><SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem><SelectItem value="other">Other</SelectItem><SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem></SelectContent></Select>
              <SaveButton saving={savingField === "gender"} onClick={() => saveField("gender", draft || null)} />
            </div>
          )}
        </div>
      </section>

      <section className="border border-border">
        <SectionHeading icon={<Settings className="size-4" />} title="Preferences" description="Choose how your account communicates and displays information." />
        <div className="divide-y divide-border">
          <PreferenceToggle label="Email notifications" checked={profile.emailNotifications} onChange={(value) => togglePreference("emailNotifications", value)} saving={savingField === "emailNotifications"} />
          <PreferenceToggle label="SMS notifications" checked={profile.smsNotifications} onChange={(value) => togglePreference("smsNotifications", value)} saving={savingField === "smsNotifications"} />
          <PreferenceSelect label="Currency" value={profile.currency} options={preferenceOptions.currency} onChange={(value) => saveField("currency", value)} saving={savingField === "currency"} />
          <PreferenceSelect label="Locale" value={profile.locale} options={preferenceOptions.locale} onChange={(value) => saveField("locale", value)} saving={savingField === "locale"} />
          <PreferenceSelect label="Timezone" value={profile.timezone} options={preferenceOptions.timezone} onChange={(value) => saveField("timezone", value)} saving={savingField === "timezone"} />
        </div>
      </section>

      <section className="border border-border">
        <SectionHeading icon={<UserRound className="size-4" />} title="Connected accounts" description="Login methods linked to this account." />
        <div className="divide-y divide-border">
          {account.linkedProviders.length > 0 ? account.linkedProviders.map((provider) => <div key={provider} className="flex items-center justify-between p-5"><span className="text-sm">{providerLabel(provider)}</span><span className="flex items-center gap-1.5 text-xs text-emerald-600"><Check className="size-3.5" /> Connected</span></div>) : <p className="p-5 text-sm text-muted-foreground">No linked login methods were found.</p>}
        </div>
      </section>
    </div>
  );
}

function EditableRow({ label, value, draft, editing, type = "text", onEdit, onDraft, onSave, saving }: { label: string; value: string; draft: string; editing: boolean; type?: string; onEdit: () => void; onDraft: (value: string) => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="p-5">
      {!editing ? <div className="flex items-center justify-between gap-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm">{value || "Not set"}</p></div><button type="button" onClick={onEdit} className="text-muted-foreground transition-colors hover:text-foreground" aria-label={`Edit ${label}`}><Pencil className="size-4" /></button></div> : <div><label className="text-xs text-muted-foreground" htmlFor={`edit-${label}`}>{label}</label><div className="mt-2 flex gap-2"><Input id={`edit-${label}`} type={type} value={draft} onChange={(event) => onDraft(event.target.value)} autoFocus /><button type="button" onClick={onSave} disabled={saving} className="inline-flex h-8 items-center gap-1 bg-foreground px-3 text-xs text-background disabled:opacity-50"><Check className="size-3.5" /> Save</button></div></div>}
    </div>
  );
}

function PreferenceToggle({ label, checked, onChange, saving }: { label: string; checked: boolean; onChange: (value: boolean) => void; saving: boolean }) {
  return <div className="flex items-center justify-between gap-4 p-5"><span className="text-sm">{label}</span><div className="flex items-center gap-3">{saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}<Switch checked={checked} onCheckedChange={onChange} disabled={saving} /></div></div>;
}

function PreferenceSelect({ label, value, options, onChange, saving }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; saving: boolean }) {
  return <div className="flex items-center justify-between gap-4 p-5"><span className="text-sm">{label}</span><div className="flex items-center gap-3">{saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}<Select value={value} onValueChange={(next) => { if (typeof next === "string") onChange(next); }} disabled={saving}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div></div>;
}

function SectionHeading({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex items-start gap-3 border-b border-border p-5"><div className="mt-0.5">{icon}</div><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></div>;
}

function LoadingState() { return <div className="flex min-h-96 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>; }
function ErrorState({ message }: { message: string }) { return <div className="p-5 md:p-10"><div className="border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">{message}</div></div>; }

function fieldLabel(field: keyof ConsumerProfile) {
  return field === "dateOfBirth" ? "Date of birth" : field.charAt(0).toUpperCase() + field.slice(1);
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} disabled={saving} className="inline-flex h-8 items-center gap-1 bg-foreground px-3 text-xs text-background disabled:opacity-50">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {saving ? "Saving" : "Save"}</button>;
}

function DateOfBirthRow({ value, editing, onEdit, onSave, saving }: { value: string | null; editing: boolean; onEdit: () => void; onSave: (value: string | null) => void; saving: boolean }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(value ? new Date(value) : undefined);
  return <div className="p-5">{!editing ? <div className="flex items-center justify-between gap-4"><div><p className="text-xs text-muted-foreground">Date of birth</p><p className="mt-1 text-sm">{formatDate(value)}</p></div><button type="button" onClick={onEdit} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Edit date of birth"><Pencil className="size-4" /></button></div> : <div><p className="text-xs text-muted-foreground">Date of birth</p><div className="mt-2 flex gap-2"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button variant="outline" className="flex-1 justify-start font-normal">{date ? date.toLocaleDateString() : "Select date"}</Button>} /><PopoverContent className="w-auto overflow-hidden p-0" align="start"><Calendar mode="single" selected={date} defaultMonth={date} captionLayout="dropdown" onSelect={(next) => { setDate(next); setOpen(false); }} /></PopoverContent></Popover><SaveButton saving={saving} onClick={() => onSave(date ? date.toISOString() : null)} /></div></div>}</div>;
}
