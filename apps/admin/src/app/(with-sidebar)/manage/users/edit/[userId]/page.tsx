'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Edit,
  Loader2,
  Mail,
  RefreshCw,
  ShieldAlert,
  StickyNote,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  ALL_GENDERS,
  FIELD_LABELS,
  formatBool,
  formatDate,
  formatFieldValue,
  genderLabel,
  getInitials,
  getRoleBadgeVariant,
  getStatusBadgeVariant,
  getUserStatus,
  requestJson,
  type UserDetail,
  type UserDetailMeta,
  type UserGender,
  type UserUpdatePayload,
} from '../../utils';

// ─── Section definitions ──────────────────────────────────────────────────────

type EditSectionId =
  | 'profile'
  | 'contact'
  | 'preferences'
  | 'adminNotes';

type SectionDef = {
  id: EditSectionId;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: (keyof UserUpdatePayload)[];
  sensitive?: boolean;
  warning?: string;
};

const SECTIONS: SectionDef[] = [
  {
    id: 'profile',
    title: 'Profile',
    description:
      'Display name, legal name, avatar, date of birth, and gender. Does not change role or account status.',
    icon: User,
    fields: ['name', 'firstName', 'lastName', 'image', 'dateOfBirth', 'gender'],
  },
  {
    id: 'contact',
    title: 'Contact & verification',
    description:
      'Email, phone, and verification flags. Changing email or verification can affect sign-in and trust signals.',
    icon: Mail,
    fields: ['email', 'emailVerified', 'phone', 'phoneVerified'],
    sensitive: true,
    warning:
      'Email changes must stay unique across all accounts. Marking email/phone as verified without a real confirmation flow can mislead support and the user.',
  },
  {
    id: 'preferences',
    title: 'Notifications & locale',
    description:
      'Notification opt-ins and regional preferences (currency, locale, timezone).',
    icon: Bell,
    fields: [
      'emailNotifications',
      'smsNotifications',
      'currency',
      'locale',
      'timezone',
    ],
  },
  {
    id: 'adminNotes',
    title: 'Admin notes',
    description:
      'Internal notes visible only to admins. Never shown to the customer.',
    icon: StickyNote,
    fields: ['adminNotes'],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapshotFromUser(
  user: UserDetail,
  fields: (keyof UserUpdatePayload)[]
): UserUpdatePayload {
  const snap: UserUpdatePayload = {};
  for (const field of fields) {
    switch (field) {
      case 'name':
        snap.name = user.name;
        break;
      case 'email':
        snap.email = user.email;
        break;
      case 'emailVerified':
        snap.emailVerified = user.emailVerified;
        break;
      case 'image':
        snap.image = user.image;
        break;
      case 'firstName':
        snap.firstName = user.firstName;
        break;
      case 'lastName':
        snap.lastName = user.lastName;
        break;
      case 'dateOfBirth':
        snap.dateOfBirth = user.dateOfBirth
          ? user.dateOfBirth.slice(0, 10)
          : null;
        break;
      case 'gender':
        snap.gender = user.gender;
        break;
      case 'phone':
        snap.phone = user.phone;
        break;
      case 'phoneVerified':
        snap.phoneVerified = user.phoneVerified;
        break;
      case 'emailNotifications':
        snap.emailNotifications = user.emailNotifications;
        break;
      case 'smsNotifications':
        snap.smsNotifications = user.smsNotifications;
        break;
      case 'currency':
        snap.currency = user.currency;
        break;
      case 'locale':
        snap.locale = user.locale;
        break;
      case 'timezone':
        snap.timezone = user.timezone;
        break;
      case 'adminNotes':
        snap.adminNotes = user.adminNotes;
        break;
    }
  }
  return snap;
}

function normalizeForCompare(
  field: keyof UserUpdatePayload,
  value: unknown
): unknown {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (field === 'email') return trimmed.toLowerCase();
    if (field === 'currency') return trimmed.toUpperCase();
    if (field === 'dateOfBirth') return trimmed.slice(0, 10);
    return trimmed;
  }
  return value;
}

function diffPayload(
  original: UserUpdatePayload,
  draft: UserUpdatePayload,
  fields: (keyof UserUpdatePayload)[]
): UserUpdatePayload {
  const out: UserUpdatePayload = {};
  for (const field of fields) {
    const from = normalizeForCompare(field, original[field]);
    const to = normalizeForCompare(field, draft[field]);
    if (from !== to) {
      (out as Record<string, unknown>)[field] = draft[field] ?? null;
    }
  }
  return out;
}

function validateDraft(
  section: SectionDef,
  draft: UserUpdatePayload
): string | null {
  if (section.fields.includes('name')) {
    const name = (draft.name ?? '').trim();
    if (!name) return 'Display name is required.';
    if (name.length > 120) return 'Display name is too long.';
  }
  if (section.fields.includes('email')) {
    const email = (draft.email ?? '').trim();
    if (!email) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return 'Enter a valid email address.';
    }
  }
  if (section.fields.includes('image') && draft.image) {
    const image = draft.image.trim();
    if (image) {
      try {
        const url = new URL(image);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return 'Avatar URL must start with http:// or https://.';
        }
      } catch {
        return 'Avatar URL is not a valid URL.';
      }
    }
  }
  if (section.fields.includes('phone') && draft.phone) {
    const phone = draft.phone.trim();
    if (phone && !/^[+]?[\d().\-\s]{5,}$/.test(phone)) {
      return 'Phone number does not look valid.';
    }
  }
  if (section.fields.includes('currency') && draft.currency) {
    if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) {
      return 'Currency must be a 3-letter code (e.g. USD).';
    }
  }
  if (section.fields.includes('locale') && draft.locale) {
    if (!/^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)*$/.test(draft.locale.trim())) {
      return 'Locale must look like en-US.';
    }
  }
  if (section.fields.includes('adminNotes') && draft.adminNotes) {
    if (draft.adminNotes.length > 2000) {
      return 'Admin notes must be at most 2000 characters.';
    }
  }
  return null;
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium break-all">{value}</p>
    </div>
  );
}

function BoolSelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ? 'true' : 'false'}
        onValueChange={(v) => onChange(v === 'true')}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes / On</SelectItem>
          <SelectItem value="false">No / Off</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Edit section dialog ──────────────────────────────────────────────────────

function EditSectionDialog({
  section,
  user,
  open,
  saving,
  onOpenChange,
  onSave,
}: {
  section: SectionDef | null;
  user: UserDetail;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: UserUpdatePayload) => Promise<void>;
}) {
  const [draft, setDraft] = useState<UserUpdatePayload>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && section) {
      setDraft(snapshotFromUser(user, section.fields));
      setConfirming(false);
      setError(null);
    }
  }, [open, section, user]);

  const original = useMemo(
    () => (section ? snapshotFromUser(user, section.fields) : {}),
    [section, user]
  );

  const changes = useMemo(
    () => (section ? diffPayload(original, draft, section.fields) : {}),
    [section, original, draft]
  );

  const changeEntries = Object.entries(changes) as [
    keyof UserUpdatePayload,
    unknown,
  ][];
  const hasChanges = changeEntries.length > 0;

  function updateField<K extends keyof UserUpdatePayload>(
    field: K,
    value: UserUpdatePayload[K]
  ) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  function handleReview() {
    if (!section) return;
    const validationError = validateDraft(section, draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!hasChanges) {
      setError('No changes to save.');
      return;
    }
    setConfirming(true);
  }

  async function handleConfirm() {
    if (!section || !hasChanges) return;
    const validationError = validateDraft(section, draft);
    if (validationError) {
      setError(validationError);
      setConfirming(false);
      return;
    }
    await onSave(changes);
  }

  if (!section) return null;

  const Icon = section.icon;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4" />
            {confirming ? 'Confirm changes' : `Edit ${section.title.toLowerCase()}`}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>{section.description}</p>
              <p className="text-muted-foreground">
                Editing <strong>{user.name}</strong> ({user.email})
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
          {section.warning && !confirming && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{section.warning}</p>
            </div>
          )}

          {confirming ? (
            <div className="space-y-3">
              <p className="text-sm">
                Review the changes below. They will be applied immediately and
                recorded in the audit log.
              </p>
              <div className="divide-y rounded-lg border">
                {changeEntries.map(([field, to]) => (
                  <div key={field} className="space-y-1 p-3 text-sm">
                    <p className="font-medium">{FIELD_LABELS[field]}</p>
                    <div className="text-muted-foreground grid gap-1 sm:grid-cols-2">
                      <p>
                        <span className="text-xs uppercase tracking-wide opacity-70">
                          From
                        </span>
                        <br />
                        <span className="text-foreground">
                          {formatFieldValue(field, original[field])}
                        </span>
                      </p>
                      <p>
                        <span className="text-xs uppercase tracking-wide opacity-70">
                          To
                        </span>
                        <br />
                        <span className="text-foreground font-medium">
                          {formatFieldValue(field, to)}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {section.sensitive && (
                <div className="border-destructive/20 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  Sensitive fields are included. Double-check before confirming.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {section.fields.includes('name') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-name">Display name</Label>
                  <Input
                    id="edit-name"
                    value={draft.name ?? ''}
                    onChange={(e) => updateField('name', e.target.value)}
                    maxLength={120}
                    disabled={saving}
                  />
                </div>
              )}
              {section.fields.includes('firstName') && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-firstName">First name</Label>
                    <Input
                      id="edit-firstName"
                      value={draft.firstName ?? ''}
                      onChange={(e) => updateField('firstName', e.target.value)}
                      maxLength={80}
                      disabled={saving}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-lastName">Last name</Label>
                    <Input
                      id="edit-lastName"
                      value={draft.lastName ?? ''}
                      onChange={(e) => updateField('lastName', e.target.value)}
                      maxLength={80}
                      disabled={saving}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              )}
              {section.fields.includes('image') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-image">Avatar URL</Label>
                  <Input
                    id="edit-image"
                    value={draft.image ?? ''}
                    onChange={(e) => updateField('image', e.target.value)}
                    maxLength={2048}
                    disabled={saving}
                    placeholder="https://..."
                  />
                </div>
              )}
              {section.fields.includes('dateOfBirth') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-dob">Date of birth</Label>
                  <Input
                    id="edit-dob"
                    type="date"
                    value={
                      typeof draft.dateOfBirth === 'string'
                        ? draft.dateOfBirth.slice(0, 10)
                        : ''
                    }
                    onChange={(e) =>
                      updateField(
                        'dateOfBirth',
                        e.target.value ? e.target.value : null
                      )
                    }
                    disabled={saving}
                  />
                </div>
              )}
              {section.fields.includes('gender') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-gender">Gender</Label>
                  <Select
                    value={draft.gender ?? 'unset'}
                    onValueChange={(v) =>
                      updateField(
                        'gender',
                        v === 'unset' ? null : (v as UserGender)
                      )
                    }
                    disabled={saving}
                  >
                    <SelectTrigger id="edit-gender">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">Not set</SelectItem>
                      {ALL_GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {genderLabel(g)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {section.fields.includes('email') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={draft.email ?? ''}
                    onChange={(e) => updateField('email', e.target.value)}
                    maxLength={254}
                    disabled={saving}
                    autoComplete="off"
                  />
                </div>
              )}
              {section.fields.includes('emailVerified') && (
                <BoolSelect
                  id="edit-emailVerified"
                  label="Email verified"
                  value={!!draft.emailVerified}
                  onChange={(v) => updateField('emailVerified', v)}
                  disabled={saving}
                />
              )}
              {section.fields.includes('phone') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    type="tel"
                    value={draft.phone ?? ''}
                    onChange={(e) => updateField('phone', e.target.value)}
                    maxLength={32}
                    disabled={saving}
                    placeholder="Optional"
                  />
                </div>
              )}
              {section.fields.includes('phoneVerified') && (
                <BoolSelect
                  id="edit-phoneVerified"
                  label="Phone verified"
                  value={!!draft.phoneVerified}
                  onChange={(v) => updateField('phoneVerified', v)}
                  disabled={saving}
                />
              )}

              {section.fields.includes('emailNotifications') && (
                <BoolSelect
                  id="edit-emailNotifications"
                  label="Email notifications"
                  value={!!draft.emailNotifications}
                  onChange={(v) => updateField('emailNotifications', v)}
                  disabled={saving}
                />
              )}
              {section.fields.includes('smsNotifications') && (
                <BoolSelect
                  id="edit-smsNotifications"
                  label="SMS notifications"
                  value={!!draft.smsNotifications}
                  onChange={(v) => updateField('smsNotifications', v)}
                  disabled={saving}
                />
              )}
              {section.fields.includes('currency') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-currency">Currency</Label>
                  <Input
                    id="edit-currency"
                    value={draft.currency ?? ''}
                    onChange={(e) => updateField('currency', e.target.value)}
                    maxLength={3}
                    disabled={saving}
                    placeholder="USD"
                    className="uppercase"
                  />
                </div>
              )}
              {section.fields.includes('locale') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-locale">Locale</Label>
                  <Input
                    id="edit-locale"
                    value={draft.locale ?? ''}
                    onChange={(e) => updateField('locale', e.target.value)}
                    maxLength={32}
                    disabled={saving}
                    placeholder="en-US"
                  />
                </div>
              )}
              {section.fields.includes('timezone') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-timezone">Timezone</Label>
                  <Input
                    id="edit-timezone"
                    value={draft.timezone ?? ''}
                    onChange={(e) => updateField('timezone', e.target.value)}
                    maxLength={64}
                    disabled={saving}
                    placeholder="UTC"
                  />
                  <p className="text-muted-foreground text-xs">
                    Use an IANA name such as America/New_York or UTC.
                  </p>
                </div>
              )}

              {section.fields.includes('adminNotes') && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-adminNotes">Admin notes</Label>
                  <Textarea
                    id="edit-adminNotes"
                    value={draft.adminNotes ?? ''}
                    onChange={(e) => updateField('adminNotes', e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                    rows={6}
                    placeholder="Internal notes about this account..."
                  />
                  <p className="text-muted-foreground text-xs">
                    {(draft.adminNotes ?? '').length}/2000
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {confirming ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={saving}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={saving || !hasChanges}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Confirm & save
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleReview}
                disabled={saving || !hasChanges}
                className="gap-1.5"
              >
                Review changes
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserEditPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [meta, setMeta] = useState<UserDetailMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<EditSectionId | null>(
    null
  );

  const loadUser = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await requestJson<{
          success: true;
          data: UserDetail;
          meta: UserDetailMeta;
        }>(`/${userId}`);
        setUser(res.data);
        setMeta(res.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load user.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  async function handleSave(payload: UserUpdatePayload) {
    if (!user) return;
    setSaving(true);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: UserDetail;
      }>(`/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast.success(res.message || 'User updated.');
      setUser(res.data);
      setActiveSection(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user.');
    } finally {
      setSaving(false);
    }
  }

  const section = SECTIONS.find((s) => s.id === activeSection) ?? null;
  const status = user ? getUserStatus(user) : 'active';
  const canEdit = !!meta?.canEdit;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Edit User</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/manage/users/view/${userId}`}>
                <ArrowLeft className="size-3.5" />
                User
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/manage/users">All users</Link>
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || refreshing}
            onClick={() => void loadUser(true)}
            className="gap-1.5"
          >
            <RefreshCw
              className={cn('size-3.5', refreshing && 'animate-spin')}
            />
            Reload
          </Button>
        </div>

        {loading ? (
          <Card>
            <CardContent className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading editor...
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load user</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadUser()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : user ? (
          <>
            {!canEdit && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  You do not have permission to edit this user, or the account
                  cannot be edited (deleted / protected role). You can still
                  review the current values below.
                </p>
              </div>
            )}

            {/* User summary */}
            <Card>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <Avatar className="size-16 shadow-sm ring-2 ring-background">
                  <AvatarImage src={user.image ?? undefined} alt={user.name} />
                  <AvatarFallback className="bg-muted text-lg font-semibold">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-semibold tracking-tight">
                      {user.name}
                    </h1>
                    <Badge variant={getRoleBadgeVariant(user.role)}>
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </Badge>
                    <Badge variant={getStatusBadgeVariant(status)}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground truncate text-sm">
                    {user.email}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {user.id}
                  </p>
                </div>
              </CardContent>
            </Card>

            {canEdit && (
              <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
                <p className="font-medium">What you can edit</p>
                <p className="text-muted-foreground mt-1">
                  Profile, contact, preferences, and internal notes. Role, spend
                  stats, ban state, login metadata, and soft-delete flags are
                  read-only here — use ban/delete actions or Manage Admins for
                  those.
                </p>
              </div>
            )}
            
            <div className="grid gap-4 lg:grid-cols-2">
              {SECTIONS.map((sec) => {
                const Icon = sec.icon;
                return (
                  <Card key={sec.id}>
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h2 className="flex items-center gap-2 font-medium">
                            <Icon className="size-4" />
                            {sec.title}
                          </h2>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            {sec.description}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 gap-1.5"
                          disabled={!canEdit}
                          onClick={() => setActiveSection(sec.id)}
                        >
                          <Edit className="size-3.5" />
                          Edit
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {sec.id === 'profile' && (
                          <>
                            <ReadOnlyField
                              label="Display name"
                              value={user.name}
                            />
                            <ReadOnlyField
                              label="First name"
                              value={user.firstName || 'Not set'}
                            />
                            <ReadOnlyField
                              label="Last name"
                              value={user.lastName || 'Not set'}
                            />
                            <ReadOnlyField
                              label="Date of birth"
                              value={formatDate(user.dateOfBirth)}
                            />
                            <ReadOnlyField
                              label="Gender"
                              value={genderLabel(user.gender)}
                            />
                            <ReadOnlyField
                              label="Avatar"
                              value={user.image ? 'Set' : 'Not set'}
                            />
                          </>
                        )}
                        {sec.id === 'contact' && (
                          <>
                            <ReadOnlyField label="Email" value={user.email} />
                            <ReadOnlyField
                              label="Email verified"
                              value={formatBool(user.emailVerified)}
                            />
                            <ReadOnlyField
                              label="Phone"
                              value={user.phone || 'Not set'}
                            />
                            <ReadOnlyField
                              label="Phone verified"
                              value={formatBool(user.phoneVerified)}
                            />
                          </>
                        )}
                        {sec.id === 'preferences' && (
                          <>
                            <ReadOnlyField
                              label="Email notifications"
                              value={formatBool(user.emailNotifications)}
                            />
                            <ReadOnlyField
                              label="SMS notifications"
                              value={formatBool(user.smsNotifications)}
                            />
                            <ReadOnlyField
                              label="Currency"
                              value={user.currency}
                            />
                            <ReadOnlyField
                              label="Locale"
                              value={user.locale}
                            />
                            <ReadOnlyField
                              label="Timezone"
                              value={user.timezone}
                            />
                          </>
                        )}
                        {sec.id === 'adminNotes' && (
                          <div className="sm:col-span-2">
                            {user.adminNotes ? (
                              <div className="bg-muted/40 max-h-40 overflow-y-auto rounded-lg border p-3 text-sm whitespace-pre-wrap">
                                {user.adminNotes}
                              </div>
                            ) : (
                              <p className="text-muted-foreground text-sm">
                                No notes yet.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        ) : null}
      </main>

      {user && (
        <EditSectionDialog
          section={section}
          user={user}
          open={!!activeSection}
          saving={saving}
          onOpenChange={(open) => {
            if (!open) setActiveSection(null);
          }}
          onSave={handleSave}
        />
      )}
    </>
  );
}
