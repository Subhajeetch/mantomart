import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip"
import { TailwindThemeProvider } from "@/components/theme-provider"
import { ThemeInitScript } from "@/components/theme-script"
import { Toaster } from "@/components/ui/sonner"
import { DEFAULT_THEME } from "@/lib/theme"
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Admin Dashboard",
	description: "Mantomart Admin Dashboard",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		// className={DEFAULT_THEME}: SSR fallback matching defaultTheme so first
		// paint is dark even if the init script is delayed. suppressHydrationWarning
		// is required because the client may switch to light/system before hydrate.
		<html lang="en" className={DEFAULT_THEME} suppressHydrationWarning>
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
				<ThemeInitScript />
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
				<TailwindThemeProvider>
					<TooltipProvider>{children}</TooltipProvider>
					<Toaster />
				</TailwindThemeProvider>
			</body>
		</html>
	);
}
