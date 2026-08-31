import { LoaderCircle } from "lucide-react";

export default function Loading() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="flex items-center justify-center">
				<LoaderCircle
					className="h-6 w-6 animate-spin text-primary"
					aria-label="Loading"
				/>
			</div>
		</div>
	);
}
