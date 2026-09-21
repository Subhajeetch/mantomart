'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Check,
  ChevronDown,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
  Pencil,
} from 'lucide-react';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useMediaQuery } from '@/hooks/use-media-query';

type Country = { code: string; name: string; dial: string };
type Address = {
  id: string; firstName: string; lastName: string; countryCode: string; countryName: string;
  phoneCountryCode: string; phone: string; addressLine1: string; addressLine2: string | null;
  city: string; state: string; postalCode: string; deliveryInstructions: string | null;
  isDefault: boolean;
};
type SearchContext = { name?: string; country_code?: string };
type SearchResult = {
  id: string;
  label: string;
  longitude: number | null;
  latitude: number | null;
  context: Record<string, SearchContext>;
};

function createEmptyForm() {
  return {
    firstName: '', lastName: '', phone: '', addressLine1: '', addressLine2: '',
    city: '', state: '', postalCode: '', deliveryInstructions: '', isDefault: false,
    mapboxPlaceId: '', latitude: null as number | null, longitude: null as number | null,
  };
}

const countries: Country[] = getCountries().map((code) => ({
  code,
  dial: `+${getCountryCallingCode(code)}`,
  name: new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));

function apiUrl(path: string) {
  return `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`;
}

function Flag({ code }: { code: string }) {
  const countryCode = code.toLowerCase();
  const countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  return (
    <picture>
      <source
        type="image/webp"
        srcSet={`https://flagcdn.com/w20/${countryCode}.webp, https://flagcdn.com/w40/${countryCode}.webp 2x`}
      />
      <source
        type="image/png"
        srcSet={`https://flagcdn.com/w20/${countryCode}.png, https://flagcdn.com/w40/${countryCode}.png 2x`}
      />
      <img
        src={`https://flagcdn.com/w20/${countryCode}.png`}
        alt={countryName}
        width={20}
        height={15}
        loading="lazy"
        decoding="async"
        className="inline-block h-[15px] w-5 rounded-[2px] object-cover shadow-[0_0_0_1px_rgb(0_0_0/0.08)]"
      />
    </picture>
  );
}

function splitName(name: string | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() ?? '', lastName: parts.join(' ') };
}

function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = countries.find((country) => country.code === value) ?? { code: 'US', name: 'United States', dial: '+1' };
  const filtered = countries.filter((country) => `${country.name} ${country.code} ${country.dial}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm" />}>
        <span className="flex items-center gap-2"><Flag code={selected.code} /><span>{selected.name}</span></span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search countries" className="pl-8" />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.map((country) => (
            <button key={country.code} type="button" onClick={() => { onChange(country.code); setOpen(false); setQuery(''); }} className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-muted">
              <span className="flex items-center gap-2"><Flag code={country.code} />{country.name}</span>
              <span className="text-xs text-muted-foreground">{country.dial}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PhoneCountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = countries.find((country) => country.code === value) ?? { code: 'US', name: 'United States', dial: '+1' };
  const filtered = countries.filter((country) => `${country.name} ${country.code} ${country.dial}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Select phone country code"
            className="flex h-10 shrink-0 items-center gap-1.5 border-0 bg-transparent px-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
          />
        }
      >
        <Flag code={selected.code} />
        <span className="tabular-nums">{selected.dial}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search country or code"
            className="pl-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.map((country) => (
            <button
              key={country.code}
              type="button"
              onClick={() => { onChange(country.code); setOpen(false); setQuery(''); }}
              className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <Flag code={country.code} />
                <span className="tabular-nums">{country.dial}</span>
              </span>
              <span className="text-xs text-muted-foreground">{country.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LocationPicker({
  value,
  country,
  types,
  stateCode,
  placeholder,
  onChange,
}: {
  value: string;
  country: Country;
  types: string;
  stateCode?: string;
  placeholder: string;
  onChange: (value: string, code?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Array<{ id: string; label: string; code?: string }>>([]);
  const requiresState = types === 'place,locality';

  useEffect(() => {
    if (!open || manual) {
      setResults([]);
      setSearching(false);
      return;
    }
    if (requiresState && !stateCode) {
      setResults([]);
      setSearching(false);
      setError('');
      return;
    }
    setSearching(true);
    setError('');
    const timeout = window.setTimeout(async () => {
      try {
        const searchParams = new URLSearchParams({
          country: country.code,
          type: types === 'region' ? 'state' : 'city',
        });
        if (query.trim()) searchParams.set('q', query.trim());
        if (stateCode) searchParams.set('state', stateCode);
        const response = await fetch(`${apiUrl('/api/store/addresses/locations')}?${searchParams}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const body = await response.json() as { data?: { options?: Array<{ id: string; label: string; code?: string }> }; error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Location search is unavailable.');
        setResults(body.data?.options ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Location search is unavailable.');
      } finally {
        setSearching(false);
      }
    }, query.trim() ? 350 : 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [country, manual, open, query, requiresState, stateCode, types]);

  if (manual) {
    return (
      <div className="relative">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 rounded-md"
        />
        <button type="button" onClick={() => setManual(false)} className="mt-1 text-xs text-primary hover:underline">
          Search {placeholder.toLowerCase()} instead
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setQuery(''); }}>
      <PopoverTrigger
        render={
          <button type="button" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm">
            <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{value || placeholder}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${placeholder.toLowerCase()}`} className="pl-8 pr-8" />
          {searching && <Spinner className="absolute right-2.5 top-2.5 size-4 text-muted-foreground" />}
        </div>
        <div className="mt-1 max-h-56 overflow-y-auto">
          {requiresState && !stateCode ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              <strong className="font-semibold text-foreground">Select state first</strong> to choose a city.
            </p>
          ) : searching ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Spinner /> Searching...</div>
          ) : error ? (
            <div className="px-2 py-2 text-xs"><p className="text-destructive">{error}</p><button type="button" onClick={() => { setManual(true); setOpen(false); }} className="mt-1 text-primary hover:underline">Enter manually instead</button></div>
          ) : results.length > 0 ? (
            results.map((result) => (
              <button key={result.id} type="button" onClick={() => { onChange(result.label, result.code); setOpen(false); setQuery(''); }} className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted">
                {result.label}
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {requiresState ? 'No cities found for this state.' : 'No matching locations found.'}
            </p>
          )}
        </div>
        <button type="button" onClick={() => { setManual(true); setOpen(false); }} className="mt-1 w-full border-t border-border px-2 pt-2 text-left text-xs text-primary hover:underline">
          Enter manually instead
        </button>
      </PopoverContent>
    </Popover>
  );
}

function AddressesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Address | null>(null);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [country, setCountry] = useState('US');
  const [phoneCountry, setPhoneCountry] = useState('US');
  const [stateCode, setStateCode] = useState('');
  const [manual, setManual] = useState(params.get('tab') === 'add-new' || Boolean(params.get('edit_id')));
  const editId = params.get('edit_id');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [form, setForm] = useState(createEmptyForm);

  const selectedCountry = countries.find((item) => item.code === country) ?? { code: 'US', name: 'United States', dial: '+1' };
  const phoneCountryData = countries.find((item) => item.code === phoneCountry) ?? { code: 'US', name: 'United States', dial: '+1' };
  const phoneError = form.phone && (!parsePhoneNumberFromString(form.phone, phoneCountry as never)?.isValid()
    ? `Enter a valid phone number for ${phoneCountryData.name} (${phoneCountryData.dial}).`
    : '');
  const nameFallback = useMemo(() => splitName(session?.user?.name), [session?.user?.name]);

  const loadAddresses = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(apiUrl('/api/store/addresses'), { credentials: 'include', headers: { Accept: 'application/json' }, cache: 'no-store' });
      const body = await response.json() as { data?: { addresses?: Address[] }; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to load your addresses.');
      setAddresses(body.data?.addresses ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load your addresses.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadAddresses(); }, []);
  useEffect(() => {
    if (session?.user?.name && !form.firstName && !form.lastName) setForm((current) => ({ ...current, ...nameFallback }));
  }, [nameFallback, session?.user?.name, form.firstName, form.lastName]);
  useEffect(() => { setManual(params.get('tab') === 'add-new' || Boolean(params.get('edit_id'))); }, [params]);

  useEffect(() => {
    if (!editId || addresses.length === 0) return;
    const address = addresses.find((item) => item.id === editId);
    if (!address) {
      setError('That address could not be found.');
      return;
    }
    setCountry(address.countryCode);
    setPhoneCountry(address.phoneCountryCode);
    const parsedPhone = parsePhoneNumberFromString(address.phone, address.phoneCountryCode as never);
    setForm({
      firstName: address.firstName,
      lastName: address.lastName,
      phone: parsedPhone?.nationalNumber ?? address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      deliveryInstructions: address.deliveryInstructions ?? '',
      isDefault: address.isDefault,
      mapboxPlaceId: '',
      latitude: null,
      longitude: null,
    });
  }, [addresses, editId]);

  const updateTab = (addNew: boolean) => {
    setManual(addNew);
    if (addNew) {
      setForm(createEmptyForm());
      setCountry('US');
      setPhoneCountry('US');
      setStateCode('');
      setQuery('');
      setResults([]);
      setSearchError('');
    }
    router.push(addNew ? '/user/addresses?tab=add-new' : '/user/addresses');
    if (!addNew) setError('');
  };
  const editAddress = (id: string) => {
    router.push(`/user/addresses?edit_id=${encodeURIComponent(id)}`);
  };
  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }

    setSearching(true);
    setSearchError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      if (trimmedQuery.length < 3) {
        setSearching(false);
        return;
      }
      try {
        const searchParams = new URLSearchParams({ q: trimmedQuery, country: country.toLowerCase() });
        const response = await fetch(`${apiUrl('/api/store/addresses/search')}?${searchParams}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        const body = await response.json() as { data?: { results?: SearchResult[] }; error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Address search is unavailable.');
        setResults(body.data?.results ?? []);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setSearchError(cause instanceof Error ? cause.message : 'Address search is unavailable.');
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 600);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [country, query]);
  const save = async () => {
    setSaving(true); setError('');
    try {
      const response = await fetch(apiUrl(editId ? `/api/store/addresses/${encodeURIComponent(editId)}` : '/api/store/addresses'), {
        method: editId ? 'PATCH' : 'POST', credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, countryCode: country, countryName: selectedCountry.name, phoneCountryCode: phoneCountry }),
      });
      const body = await response.json() as { data?: { address?: Address }; error?: string };
      if (!response.ok || !body.data?.address) throw new Error(body.error ?? 'Unable to save your address.');
      setAddresses((current) => {
        const saved = body.data!.address!;
        if (editId) {
          return current.map((item) => item.id === saved.id ? saved : item);
        }
        return [saved, ...current.filter((item) => !saved.isDefault || !item.isDefault)];
      });
      setForm(createEmptyForm());
      updateTab(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your address.'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(apiUrl(`/api/store/addresses/${encodeURIComponent(deleteTarget.id)}`), { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to delete that address.');
      setAddresses((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      if (editId === deleteTarget.id) {
        setForm(createEmptyForm());
        setCountry('US');
        setPhoneCountry('US');
        setStateCode('');
        setQuery('');
        setResults([]);
        setSearchError('');
        setManual(true);
        router.push('/user/addresses?tab=add-new');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete that address.');
    } finally {
      setDeleting(false);
    }
  };
  const setField = (key: keyof typeof form, value: string | boolean | number | null) => setForm((current) => ({ ...current, [key]: value }));

  if (loading) return <div className="flex min-h-96 items-center justify-center"><Spinner className="size-6 text-primary" /></div>;
  return (
    <div className="min-h-[calc(100svh-4rem)]">
      <div className="mx-auto max-w-5xl p-5 md:p-10">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            {!manual && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Account</p>}
            <h1 className="text-2xl font-bold">{manual ? (editId ? 'Edit Address' : 'Add New Address') : 'Saved Addresses'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {manual ? (editId ? 'Update your delivery address details.' : 'Add a delivery address for a faster checkout experience.') : 'Manage the addresses used for your deliveries.'}
            </p>
          </div>
          {!manual && <Button onClick={() => updateTab(true)}><Plus /> Add new</Button>}
        </header>
        {error && <div className="mb-4 flex items-center justify-between border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}<button type="button" onClick={() => setError('')}><X className="size-4" /></button></div>}
        {!manual && addresses.length === 0 ? (
          <Empty className="min-h-80 border border-border bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MapPin className="text-primary" />
              </EmptyMedia>
              <EmptyTitle>No saved addresses</EmptyTitle>
              <EmptyDescription>
                Add an address to make checkout faster.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => updateTab(true)}>
                <Plus /> Add new address
              </Button>
            </EmptyContent>
          </Empty>
        ) : !manual ? (<div className="grid gap-4 md:grid-cols-2">{addresses.map((address) => <div key={address.id} className="rounded-lg border border-border bg-background p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{address.firstName} {address.lastName}</h2><p className="mt-1 text-sm text-muted-foreground">{address.addressLine1}{address.addressLine2 ? `, ${address.addressLine2}` : ''}</p><p className="text-sm text-muted-foreground">{address.city}, {address.state} {address.postalCode}</p><p className="mt-2 text-sm">{address.phone}</p></div>{address.isDefault && <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary"><Check className="size-3" /> Default</span>}</div><div className="mt-5 flex gap-4"><button type="button" onClick={() => editAddress(address.id)} className="flex items-center gap-1 text-sm text-foreground/70 hover:underline"><Pencil className="size-4" /> Edit</button><button type="button" onClick={() => setDeleteTarget(address)} className="flex items-center gap-1 text-sm text-destructive hover:underline"><Trash2 className="size-4" /> Delete</button></div></div>)}</div>)
        : (
          <div className="bg-background">
            <section className="mt-7"><h3 className="mb-3 font-semibold">Country/region</h3><CountryPicker value={country} onChange={(value) => { setCountry(value); setStateCode(''); setResults([]); setQuery(''); setSearchError(''); setField('state', ''); setField('city', ''); setField('postalCode', ''); setField('mapboxPlaceId', ''); setField('latitude', null); setField('longitude', null); if (phoneCountry === country) setPhoneCountry(value); }} /></section>
            <section className="mt-7"><h3 className="mb-3 font-semibold">Contact information</h3><div className="grid gap-3 md:grid-cols-3"><Input className="h-10" value={form.firstName} onChange={(event) => setField('firstName', event.target.value)} placeholder="First name*" aria-label="First name" /><Input className="h-10" value={form.lastName} onChange={(event) => setField('lastName', event.target.value)} placeholder="Last name*" aria-label="Last name" /><div><div className="flex h-10 overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"><PhoneCountryPicker value={phoneCountry} onChange={setPhoneCountry} /><div className="my-2 w-px bg-border" /><Input className="h-full rounded-none border-0 bg-transparent px-3 shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0" value={form.phone} onChange={(event) => setField('phone', event.target.value)} placeholder="Phone*" aria-label="Phone number" /></div><p className="mt-2 text-xs text-muted-foreground">Your phone number will be kept secure.</p></div></div>{phoneCountry !== country && <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">Phone country differs from shipping country. <button type="button" onClick={() => setPhoneCountry(country)} aria-label="Use shipping country"><X className="size-4" /></button></div>}{phoneError && <p className="mt-2 text-xs text-destructive">{phoneError}</p>}</section>
            <section className="mt-7"><h3 className="mb-3 font-semibold">Address</h3><div className="relative"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by address (e.g. 123 Main St, Apt 4B)" className="h-10 rounded-md pl-9 pr-10" />{searching && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}</div>{query.trim() && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-background p-1 shadow-lg">{searching ? <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"><Spinner /> Searching addresses...</div> : searchError ? <p className="px-3 py-3 text-sm text-destructive">{searchError}</p> : results.length > 0 ? results.map((result) => <button key={result.id} type="button" onClick={() => { const context = result.context; setField('addressLine1', result.label); setField('city', context.place?.name ?? context.locality?.name ?? ''); setField('state', context.region?.name ?? ''); setField('postalCode', context.postcode?.name ?? ''); setField('mapboxPlaceId', result.id); setField('latitude', result.latitude); setField('longitude', result.longitude); setQuery(''); setResults([]); }} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted">{result.label}</button>) : <p className="px-3 py-3 text-sm text-muted-foreground">No matching addresses found.</p>}</div>}</div><div className="mt-3 grid gap-3 md:grid-cols-2"><div><Input className="h-10" value={form.addressLine1} onChange={(event) => setField('addressLine1', event.target.value)} placeholder="Street address*" /><p className="mt-2 text-xs text-muted-foreground">Please enter an address with 5-35 characters including building or house number</p></div><Input className="h-10" value={form.addressLine2} onChange={(event) => setField('addressLine2', event.target.value)} placeholder="Apt, suite, unit, etc. (optional)" /></div><div className="mt-3 grid gap-3 md:grid-cols-3"><LocationPicker key={`${country}-state`} value={form.state} country={selectedCountry} types="region" placeholder="State / province*" onChange={(value, code) => { setField('state', value); setStateCode(code ?? ''); setField('city', ''); }} /><LocationPicker key={`${country}-${stateCode}-city`} value={form.city} country={selectedCountry} stateCode={stateCode} types="place,locality" placeholder="City*" onChange={(value) => setField('city', value)} /><Input className="h-10" value={form.postalCode} onChange={(event) => setField('postalCode', event.target.value)} placeholder="ZIP / postal code*" /></div><Input className="mt-3 h-10" value={form.deliveryInstructions} onChange={(event) => setField('deliveryInstructions', event.target.value)} placeholder="Delivery instructions (optional)" /></section>
            <label className="group mt-7 flex cursor-pointer items-center gap-3 text-sm text-foreground">
              <Checkbox
                checked={form.isDefault}
                onCheckedChange={(checked) => setField('isDefault', checked === true)}
                aria-label="Set as default shipping address"
              />
              <span className="select-none">Set as default shipping address</span>
            </label>
            <div className="mt-7 flex gap-3"><Button className="min-w-40" disabled={saving || Boolean(phoneError)} onClick={() => void save()}>{saving ? <Spinner /> : 'Confirm'}</Button><Button variant="outline" className="min-w-40" onClick={() => updateTab(false)}>Cancel</Button></div>
          </div>
        )}
        {isDesktop ? (
          <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this address?</DialogTitle>
                <DialogDescription>
                  This saved address will be permanently removed from your account.
                </DialogDescription>
                {deleteTarget && (
                  <p className="rounded-md bg-muted p-3 text-sm">
                    {deleteTarget.addressLine1}, {deleteTarget.city}, {deleteTarget.state} {deleteTarget.postalCode}
                  </p>
                )}
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</Button>
                <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
                  {deleting ? <Spinner /> : <Trash2 />}
                  Delete address
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Drawer open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
            <DrawerContent>
              <DrawerHeader className="text-left">
                <DrawerTitle>Delete this address?</DrawerTitle>
                <DrawerDescription>
                  This saved address will be permanently removed from your account.
                </DrawerDescription>
                {deleteTarget && (
                  <p className="rounded-md bg-muted p-3 text-sm">
                    {deleteTarget.addressLine1}, {deleteTarget.city}, {deleteTarget.state} {deleteTarget.postalCode}
                  </p>
                )}
              </DrawerHeader>
              <DrawerFooter>
                <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
                  {deleting ? <Spinner /> : <Trash2 />}
                  Delete address
                </Button>
                <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    </div>
  );
}

export default function AddressesPage() {
  return <Suspense fallback={<div className="flex min-h-96 items-center justify-center"><Spinner className="size-6" /></div>}><AddressesContent /></Suspense>;
}
