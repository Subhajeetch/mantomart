"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, Loader2 } from "lucide-react";
import Image from "next/image";

type Step = "search" | "results";
type Phase = "idle" | "exit" | "enter-init" | "enter";

type Product = {
    id: number;
    name: string;
    price: string;
};

async function fetchProducts(query: string): Promise<Product[]> {
    await new Promise((res) => setTimeout(res, 800));
    return Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        name: `${query} Product ${i + 1}`,
        price: (Math.random() * 100 + 10).toFixed(2),
    }));
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


// config
const TYPING_SPEED = 60;
const DELETING_SPEED = 35;
const PAUSE_AFTER_TYPE = 1600;
const PAUSE_AFTER_DELETE = 400;


// for fun lol
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
                    timeoutRef.current = setTimeout(() => {
                        setIsDeleting(true);
                    }, PAUSE_AFTER_TYPE);
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

const SearchProduct = () => {
    const router = useRouter();
    const searchParams = useSearchParams();

    const queryParam = searchParams.get("q") ?? "";

    const [step, setStep] = useState<Step>(queryParam ? "results" : "search");
    const [inputValue, setInputValue] = useState(queryParam);
    const [searchQuery, setSearchQuery] = useState(queryParam);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    const [phase, setPhase] = useState<Phase>("idle");
    const [direction, setDirection] = useState<"forward" | "back">("forward");
    const inputRef = useRef<HTMLInputElement>(null);
    const rafRef = useRef<number | null>(null);

    const animatedPlaceholder = useTypingPlaceholder(
        PLACEHOLDER_QUERIES,
        step === "search" && !isFocused && inputValue === ""
    );

    useEffect(() => {
        if (queryParam) {
            runSearch(queryParam, false);
        }
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    const runSearch = async (query: string, animate = true) => {
        if (!query.trim()) return;
        setLoading(true);

        if (animate) {
            transitionTo("results", "forward", async () => {
                const results = await fetchProducts(query);
                setProducts(results);
                setLoading(false);
            });
        } else {
            const results = await fetchProducts(query);
            setProducts(results);
            setLoading(false);
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
                        if (nextStep === "search") {
                            inputRef.current?.focus();
                        }
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
                return {
                    opacity: 0,
                    transform: `translateX(${enterFromX})`,
                    transition: "none",
                };
            case "enter":
                return {
                    opacity: 1,
                    transform: "translateX(0)",
                    transition: "opacity 320ms ease, transform 320ms cubic-bezier(0.2,0,0,1)",
                };
            case "idle":
            default:
                return {
                    opacity: 1,
                    transform: "translateX(0)",
                    transition: "none",
                };
        }
    };

    const handleSearch = () => {
        const query = inputValue.trim();
        if (!query) return;
        setSearchQuery(query);

        const params = new URLSearchParams(searchParams.toString());
        params.set("q", query);
        router.push(`?${params.toString()}`);

        runSearch(query);
    };

    const handleBack = () => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("q");
        router.push(`?${params.toString()}`);
        transitionTo("search", "back");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") handleSearch();
    };

    return (
        <div className="relative overflow-hidden h-[calc(100vh-120px)]">
            <div className="h-full" style={getStyle()}>

                {/* ── Step 1: Search ── */}
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
                            {/*custom input wrapper for fake animated placeholder*/}
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
                                    className="
                                        w-full h-11 rounded-full border border-input bg-background
                                        px-5 text-sm shadow-sm outline-none
                                        focus:ring-2 focus:ring-ring focus:border-ring
                                        transition-shadow peer
                                    "
                                />
                                {inputValue === "" && (
                                    <span
                                        className="
                                            pointer-events-none absolute left-5 top-1/2 -translate-y-1/2
                                            text-sm text-muted-foreground/60 flex items-center gap-px
                                        "
                                    >
                                        {animatedPlaceholder}
                                        {/*made it with calude*/}
                                        {!isFocused && (
                                            <span
                                                className="inline-block w-[1.5px] h-3.5 bg-muted-foreground/40 ml-px"
                                                style={{
                                                    animation: "blink 1s step-start infinite",
                                                }}
                                            />
                                        )}
                                    </span>
                                )}
                            </div>

                            <button
                                onClick={handleSearch}
                                disabled={!inputValue.trim() || phase !== "idle"}
                                className="
                                    h-11 px-5 rounded-full bg-primary text-primary-foreground
                                    text-sm font-medium flex items-center gap-2
                                    hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                                    transition-colors
                                "
                            >
                                <Search size={15} />
                                Search
                            </button>
                        </div>

                        <style>{`
                            @keyframes blink {
                                0%, 100% { opacity: 1; }
                                50% { opacity: 0; }
                            }
                        `}</style>
                    </div>
                )}

                {/*step 2*/}
                {step === "results" && (
                    <div className="flex flex-col h-full">
                        <div className="flex items-center gap-3 py-3 border-b border-border shrink-0">
                            <button
                                onClick={handleBack}
                                disabled={phase !== "idle"}
                                className="
                                    flex items-center justify-center h-8 w-8 rounded-full
                                    bg-muted hover:bg-muted/80 transition-colors shrink-0
                                    disabled:pointer-events-none
                                "
                                aria-label="Go back to search"
                            >
                                <ArrowLeft size={16} />
                            </button>
                            <div className="flex flex-col">
                                <span className="text-xs text-muted-foreground leading-none mb-0.5">
                                    Results for
                                </span>
                                <span className="font-semibold text-sm leading-none">
                                    &ldquo;{searchQuery}&rdquo;
                                </span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto py-4">
                            {loading ? (
                                <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
                                    <Loader2 size={18} className="animate-spin" />
                                    <span className="text-sm">Searching...</span>
                                </div>
                            ) : (
                                <div>
                                    <pre className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3">
                                        {JSON.stringify(products, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default SearchProduct;