'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import type { Session } from '@repo/types/session-client';
import { useSession } from '@/lib/auth-client';

export default function UserIndexPage() {
  const router = useRouter();
  const { data } = useSession();
  const session = data as Session | null;

  useEffect(() => {
    if (session?.session && window.matchMedia('(min-width: 1024px)').matches) {
      router.replace('/user/profile');
    }
  }, [router, session]);

  if (session?.session) return null;

  return (
    <main className="relative isolate flex min-h-[calc(100svh-4rem)] items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-8 sm:py-16">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_42%),radial-gradient(circle_at_bottom_left,color-mix(in_oklab,var(--muted)_70%,transparent),transparent_38%)]" />
      <section className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xl shadow-foreground/5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="relative min-h-56 overflow-hidden sm:min-h-72 lg:min-h-[34rem]">
          <Image
            src="/images/login-hero-2.webp"
            alt="A welcoming view of the store"
            fill
            priority
            sizes="(min-width: 1024px) 52vw, 100vw"
            className="object-cover"
          />
        </div>
        <div className="flex items-center px-6 py-10 text-center sm:px-12 sm:py-14 lg:px-12 lg:text-left">
          <div className="w-full">
            <p className="text-sm font-medium text-primary hidden lg:block">Welcome back</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Hey, good to see you.
            </h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base lg:mx-0">
              Log in to access your profile, orders, saved addresses, wishlists,
              and more.
            </p>
            <Link
              href="/login?returnTo=%2Fuser"
              className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
            >
              Log in to your account
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <p className="mt-5 text-xs text-muted-foreground">
              New here?{' '}
              <Link
                href="/login?returnTo=%2Fuser"
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
              >
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
