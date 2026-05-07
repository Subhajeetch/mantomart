"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, Loader2, Star, ShoppingCart, ExternalLink } from "lucide-react";
import Image from "next/image";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";

//types

type Step = "search" | "results";
type Phase = "idle" | "exit" | "enter-init" | "enter";

type Product = {
    itemId: string;
    title: string;
    targetSalePrice: string;
    targetOriginalPrice: string;
    salePriceFormat: string;
    discount: string;
    itemMainPic: string;
    orders: string;
    evaluateRate: string;
    score: string;
    itemUrl: string;
};

type PaginationMeta = {
    pageIndex: number;
    pageSize: number;
    totalCount: number;
};


interface AliExpressSearchResponse {
    aliexpress_ds_text_search_response: {
        data: {
            pageIndex: number;
            pageSize: number;
            totalCount: number;
            products: {
                selection_search_product: Product[];
            };
        };
    };
}

async function fetchProducts(
    query: string,
    pageIndex: number = 1
): Promise<{ products: Product[]; pagination: PaginationMeta }> {
    const res = await fetch(
        `/api/ae/product/search?q=${encodeURIComponent(query)}&itemnum=30&page=${pageIndex}`
    );
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const json = (await res.json()) as AliExpressSearchResponse;

    const data = json?.aliexpress_ds_text_search_response?.data;

    return {
        products: data?.products?.selection_search_product ?? [],
        pagination: {
            pageIndex: data?.pageIndex ?? pageIndex,
            pageSize: data?.pageSize ?? 30,
            totalCount: data?.totalCount ?? 0,
        },
    };
}


const PLACEHOLDER_QUERIES = [
    "Search products...",
    "T-Shirts",
    "Electronics",
    "Running Shoes",
    "Phone Cases",
    "LED Strip Lights",
    "Mechanical Keyboards",
    "Yoga Mats",
    "Wireless Earbuds",
];


//configs
const TYPING_SPEED = 60;
const DELETING_SPEED = 35;
const PAUSE_AFTER_TYPE = 1600;
const PAUSE_AFTER_DELETE = 400;

function useTypingPlaceholder(queries: string[], active: boolean) {
    const [displayed, setDisplayed] = useState(queries[0]);
    const [queryIndex, setQueryIndex] = useState(0);
    const [charIndex, setCharIndex] = useState(queries[0]?.length ?? 0);
    const [isDeleting, setIsDeleting] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!active) return;
        const current = queries[queryIndex];
        if (!current) return;

        const tick = () => {
            if (!isDeleting) {
                if (charIndex < current.length) {
                    setCharIndex((c) => c + 1);
                    setDisplayed(current.slice(0, charIndex + 1));
                    timeoutRef.current = setTimeout(tick, TYPING_SPEED);
                } else {
                    timeoutRef.current = setTimeout(() => setIsDeleting(true), PAUSE_AFTER_TYPE);
                }
            } else {
                if (charIndex > 0) {
                    setCharIndex((c) => c - 1);
                    setDisplayed(current.slice(0, charIndex - 1));
                    timeoutRef.current = setTimeout(tick, DELETING_SPEED);
                } else {
                    timeoutRef.current = setTimeout(() => {
                        const next = (queryIndex + 1) % queries.length;
                        setQueryIndex(next);
                        setIsDeleting(false);
                    }, PAUSE_AFTER_DELETE);
                }
            }
        };

        timeoutRef.current = setTimeout(tick, TYPING_SPEED);
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [active, charIndex, isDeleting, queryIndex, queries]);

    useEffect(() => {
        setCharIndex(0);
        setDisplayed("");
    }, [queryIndex]);

    return displayed;
}


function ProductCard({ product }: { product: Product }) {
    const hasDiscount = product.discount && product.discount !== "0%";
    const hasRating = product.score && parseFloat(product.score) > 0;
    const hasOrders = product.orders && product.orders !== "";
    const ratingPct = product.evaluateRate ? parseFloat(product.evaluateRate) : null;

    const itemUrl = product.itemUrl.startsWith("//")
        ? `https:${product.itemUrl}`
        : product.itemUrl;

    return (
        <a
            href={itemUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col bg-card border border-border rounded-2xl overflow-hidden
                       hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5
                       transition-all duration-200 ease-out"
        >
            <div className="relative aspect-square bg-muted overflow-hidden">
                <Image
                    src={product.itemMainPic}
                    alt={product.title}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    unoptimized
                />
                {hasDiscount && (
                    <span
                        className="absolute top-2 left-2 bg-destructive text-destructive-foreground
                                     text-[10px] font-bold px-1.5 py-0.5 rounded-md tracking-wide"
                    >
                        -{product.discount}
                    </span>
                )}
                <span
                    className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100
                                  bg-primary text-primary-foreground rounded-full p-1.5
                                  transition-opacity duration-150 shadow"
                >
                    <ExternalLink size={11} />
                </span>
            </div>

            <div className="flex flex-col flex-1 p-3 gap-2">
                <p className="text-xs text-foreground leading-[1.45] line-clamp-2 flex-1">
                    {product.title}
                </p>

                <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-primary">
                        {product.salePriceFormat || `$${product.targetSalePrice}`}
                    </span>
                    {hasDiscount && product.targetOriginalPrice && (
                        <span className="text-[11px] text-muted-foreground line-through">
                            ${product.targetOriginalPrice}
                        </span>
                    )}
                </div>

                {(hasRating || hasOrders || ratingPct) && (
                    <div className="flex items-center gap-2 flex-wrap">
                        {hasRating && (
                            <span className="flex items-center gap-0.5 text-[11px] text-amber-500 font-medium">
                                <Star size={10} className="fill-amber-500" />
                                {parseFloat(product.score).toFixed(1)}
                            </span>
                        )}
                        {ratingPct !== null && ratingPct > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                                {ratingPct.toFixed(0)}% pos.
                            </span>
                        )}
                        {hasOrders && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto">
                                <ShoppingCart size={10} />
                                {product.orders} sold
                            </span>
                        )}
                    </div>
                )}
            </div>
        </a>
    );
}

//loader
function SkeletonCard() {
    return (
        <div className="flex flex-col bg-card border border-border rounded-2xl overflow-hidden animate-pulse">
            <div className="aspect-square bg-muted" />
            <div className="p-3 flex flex-col gap-2">
                <div className="h-3 bg-muted rounded w-full" />
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/3 mt-1" />
                <div className="h-3 bg-muted rounded w-1/2" />
            </div>
        </div>
    );
}

//for pagination
function ProductPagination({
    pagination,
    onPageChange,
    disabled,
}: {
    pagination: PaginationMeta;
    onPageChange: (page: number) => void;
    disabled: boolean;
}) {
    const { pageIndex, pageSize, totalCount } = pagination;
    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalPages <= 1) return null;


    const getPageNumbers = () => {
        const pages: (number | "ellipsis-start" | "ellipsis-end")[] = [];

        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }

        pages.push(1);

        if (pageIndex > 3) {
            pages.push("ellipsis-start");
        }

        const start = Math.max(2, pageIndex - 1);
        const end = Math.min(totalPages - 1, pageIndex + 1);

        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (pageIndex < totalPages - 2) {
            pages.push("ellipsis-end");
        }

        pages.push(totalPages);

        return pages;
    };

    const pages = getPageNumbers();

    return (
        <div className="flex flex-col items-center gap-2 pt-4 pb-2">
            <p className="text-xs text-muted-foreground">
                Page {pageIndex} of {totalPages.toLocaleString()} &mdash;{" "}
                {totalCount.toLocaleString()} total results
            </p>

            <Pagination>
                <PaginationContent>
                    {/*previous*/}
                    <PaginationItem>
                        <PaginationPrevious
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                if (pageIndex > 1 && !disabled) onPageChange(pageIndex - 1);
                            }}
                            aria-disabled={pageIndex === 1 || disabled}
                            className={
                                pageIndex === 1 || disabled
                                    ? "pointer-events-none opacity-50"
                                    : "cursor-pointer"
                            }
                        />
                    </PaginationItem>

                    {pages.map((page, i) =>
                        page === "ellipsis-start" || page === "ellipsis-end" ? (
                            <PaginationItem key={`${page}-${i}`}>
                                <PaginationEllipsis />
                            </PaginationItem>
                        ) : (
                            <PaginationItem key={page}>
                                <PaginationLink
                                    href="#"
                                    isActive={page === pageIndex}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (!disabled && page !== pageIndex) onPageChange(page);
                                    }}
                                    className={disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                >
                                    {page}
                                </PaginationLink>
                            </PaginationItem>
                        )
                    )}

                    {/*next */}
                    <PaginationItem>
                        <PaginationNext
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                if (pageIndex < totalPages && !disabled) onPageChange(pageIndex + 1);
                            }}
                            aria-disabled={pageIndex === totalPages || disabled}
                            className={
                                pageIndex === totalPages || disabled
                                    ? "pointer-events-none opacity-50"
                                    : "cursor-pointer"
                            }
                        />
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </div>
    );
}

//main

const SearchProduct = () => {
    const router = useRouter();
    const searchParams = useSearchParams();

    const queryParam = searchParams.get("q") ?? "";
    const pageParam = parseInt(searchParams.get("page") ?? "1", 10);

    const [step, setStep] = useState<Step>(queryParam ? "results" : "search");
    const [inputValue, setInputValue] = useState(queryParam);
    const [searchQuery, setSearchQuery] = useState(queryParam);
    const [products, setProducts] = useState<Product[]>([]);
    const [pagination, setPagination] = useState<PaginationMeta>({
        pageIndex: pageParam,
        pageSize: 30,
        totalCount: 0,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isFocused, setIsFocused] = useState(false);

    const [phase, setPhase] = useState<Phase>("idle");
    const [direction, setDirection] = useState<"forward" | "back">("forward");
    const inputRef = useRef<HTMLInputElement>(null);
    const rafRef = useRef<number | null>(null);
    const resultsTopRef = useRef<HTMLDivElement>(null);

    const animatedPlaceholder = useTypingPlaceholder(
        PLACEHOLDER_QUERIES,
        step === "search" && !isFocused && inputValue === ""
    );

    useEffect(() => {
        if (queryParam) runSearch(queryParam, pageParam, false);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    const runSearch = async (query: string, page: number = 1, animate = true) => {
        if (!query.trim()) return;
        setLoading(true);
        setError(null);

        const doFetch = async () => {
            try {
                const { products: results, pagination: meta } = await fetchProducts(query, page);
                setProducts(results);
                setPagination(meta);
                resultsTopRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            } catch {
                setError("Something went wrong. Please try again.");
                setProducts([]);
            } finally {
                setLoading(false);
            }
        };

        if (animate) {
            transitionTo("results", "forward", doFetch);
        } else {
            await doFetch();
        }
    };

    const transitionTo = (
        nextStep: Step,
        dir: "forward" | "back",
        onMidpoint?: () => void
    ) => {
        setDirection(dir);
        setPhase("exit");

        setTimeout(() => {
            setStep(nextStep);
            onMidpoint?.();
            setPhase("enter-init");

            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = requestAnimationFrame(() => {
                    setPhase("enter");
                    setTimeout(() => {
                        setPhase("idle");
                        if (nextStep === "search") inputRef.current?.focus();
                    }, 350);
                });
            });
        }, 300);
    };

    const getStyle = (): React.CSSProperties => {
        const exitX = direction === "forward" ? "-60px" : "60px";
        const enterFromX = direction === "forward" ? "60px" : "-60px";
        switch (phase) {
            case "exit":
                return {
                    opacity: 0,
                    transform: `translateX(${exitX})`,
                    transition: "opacity 280ms ease, transform 280ms cubic-bezier(0.4,0,0.2,1)",
                };
            case "enter-init":
                return { opacity: 0, transform: `translateX(${enterFromX})`, transition: "none" };
            case "enter":
                return {
                    opacity: 1,
                    transform: "translateX(0)",
                    transition: "opacity 320ms ease, transform 320ms cubic-bezier(0.2,0,0,1)",
                };
            default:
                return { opacity: 1, transform: "translateX(0)", transition: "none" };
        }
    };

    const handleSearch = () => {
        const query = inputValue.trim();
        if (!query) return;
        setSearchQuery(query);
        const params = new URLSearchParams(searchParams.toString());
        params.set("q", query);
        params.set("page", "1");
        router.push(`?${params.toString()}`);
        runSearch(query, 1);
    };

    const handlePageChange = (page: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("page", String(page));
        router.push(`?${params.toString()}`);
        runSearch(searchQuery, page, false);
    };

    const handleBack = () => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("q");
        params.delete("page");
        router.push(`?${params.toString()}`);
        transitionTo("search", "back");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") handleSearch();
    };

    return (
        <div className="relative overflow-hidden h-[calc(100vh-120px)]">
            <div className="h-full" style={getStyle()}>

                {/*step1*/}
                {step === "search" && (
                    <div className="flex flex-col items-center justify-center h-full gap-6 pb-24">
                        <Image
                            src="/icons/aliexpress_logo_long.png"
                            alt="AliExpress"
                            width={280}
                            height={100}
                            className="object-contain"
                        />

                        <div className="flex w-full max-w-xl gap-2">
                            <div className="relative flex-1">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onFocus={() => setIsFocused(true)}
                                    onBlur={() => setIsFocused(false)}
                                    placeholder=""
                                    className="w-full h-11 rounded-full border border-input bg-background
                                               px-5 text-sm shadow-sm outline-none
                                               focus:ring-2 focus:ring-ring focus:border-ring
                                               transition-shadow peer"
                                />
                                {inputValue === "" && (
                                    <span
                                        className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2
                                                      text-sm text-muted-foreground/60 flex items-center gap-px"
                                    >
                                        {animatedPlaceholder}
                                        {!isFocused && (
                                            <span
                                                className="inline-block w-[1.5px] h-3.5 bg-muted-foreground/40 ml-px"
                                                style={{ animation: "blink 1s step-start infinite" }}
                                            />
                                        )}
                                    </span>
                                )}
                            </div>

                            <button
                                onClick={handleSearch}
                                disabled={!inputValue.trim() || phase !== "idle"}
                                className="h-11 px-5 rounded-full bg-primary text-primary-foreground
                                           text-sm font-medium flex items-center gap-2
                                           hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                                           transition-colors"
                            >
                                <Search size={15} />
                                Search
                            </button>
                        </div>

                        <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
                    </div>
                )}

                {/*step2*/}
                {step === "results" && (
                    <div className="flex flex-col h-full">

                        <div className="flex items-center gap-3 py-3 border-b border-border shrink-0">
                            <button
                                onClick={handleBack}
                                disabled={phase !== "idle"}
                                className="flex items-center justify-center h-8 w-8 rounded-full
                                           bg-muted hover:bg-muted/80 transition-colors shrink-0
                                           disabled:pointer-events-none"
                                aria-label="Go back to search"
                            >
                                <ArrowLeft size={16} />
                            </button>

                            <div className="flex flex-1 gap-2 max-w-md">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={`"${searchQuery}"`}
                                        className="w-full h-8 rounded-full border border-input bg-background
                                                   px-4 text-xs shadow-sm outline-none
                                                   focus:ring-2 focus:ring-ring focus:border-ring
                                                   transition-shadow"
                                    />
                                </div>
                                <button
                                    onClick={handleSearch}
                                    disabled={!inputValue.trim() || phase !== "idle" || loading}
                                    className="h-8 px-3 rounded-full bg-primary text-primary-foreground
                                               text-xs font-medium flex items-center gap-1.5
                                               hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                                               transition-colors shrink-0"
                                >
                                    <Search size={12} />
                                    Search
                                </button>
                            </div>

                            {!loading && products.length > 0 && (
                                <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                                    {pagination.totalCount.toLocaleString()} results
                                </span>
                            )}
                        </div>

                        <div ref={resultsTopRef} className="flex-1 overflow-y-auto py-4">

                            {error && !loading && (
                                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                                    <p className="text-sm text-destructive font-medium">{error}</p>
                                    <button
                                        onClick={() => runSearch(searchQuery, pagination.pageIndex)}
                                        className="text-xs text-primary underline underline-offset-2"
                                    >
                                        Try again
                                    </button>
                                </div>
                            )}

                            {loading && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                    {Array.from({ length: 10 }).map((_, i) => (
                                        <SkeletonCard key={i} />
                                    ))}
                                </div>
                            )}

                            {!loading && !error && products.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-40 gap-2">
                                    <p className="text-sm text-muted-foreground">
                                        No products found for &ldquo;{searchQuery}&rdquo;
                                    </p>
                                </div>
                            )}

                            {!loading && !error && products.length > 0 && (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                        {products.map((product) => (
                                            <ProductCard key={product.itemId} product={product} />
                                        ))}
                                    </div>

                                    <ProductPagination
                                        pagination={pagination}
                                        onPageChange={handlePageChange}
                                        disabled={loading || phase !== "idle"}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SearchProduct;