import {
  getHeaderNav,
  MobileBottomNav,
  StoreNavbar,
} from "@/components/navbar";
import { NeedLoginProvider } from "@/components/need-login-context";
import { WishlistProvider } from "@/components/wishlist-context";
import { CartProvider } from "@/components/cart-context";

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
  const collections = await getHeaderNav();

  return (
    <NeedLoginProvider>
      <CartProvider>
        <WishlistProvider>
          <StoreNavbar collections={collections} />
          <main className="min-h-[calc(100svh-4rem)] pb-20 sm:pb-0">
            {children}
          </main>
          <MobileBottomNav />
        </WishlistProvider>
      </CartProvider>
    </NeedLoginProvider>
  )
}
