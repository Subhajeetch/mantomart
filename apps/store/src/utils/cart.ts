export type CartActionInput = {
  productId: string;
  slug: string;
  skuId: string | null;
  quantity: number;
};

/** Add the selected SKU to the cart. Persistence is not wired yet. */
export function addToCart(_input: CartActionInput): void {}

/** Jump to checkout with the selected SKU. Checkout is not wired yet. */
export function handleBuyNow(_input: CartActionInput): void {}
