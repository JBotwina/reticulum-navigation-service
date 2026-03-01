import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { DirectionsResponse } from "#/server/directions/service";

type DirectionsFormInput = {
	startInput: string;
	destinationInput: string;
};

const getDirections = createServerFn({ method: "POST" })
	.inputValidator((data: DirectionsFormInput) => data)
	.handler(async ({ data }) => {
		const directionsService = await import("#/server/directions/service");
		return directionsService.getDirections(data);
	});

export const Route = createFileRoute("/directions")({
	component: DirectionsPage,
});

function DirectionsPage() {
	const [result, setResult] = useState<DirectionsResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isCopied, setIsCopied] = useState(false);

	return (
		<main className="page-wrap px-4 pb-8 pt-14">
			<section className="island-shell rounded-2xl p-6 sm:p-8">
				<p className="island-kicker mb-2">Routing Playground</p>
				<h1 className="display-title m-0 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
					Directions
				</h1>
				<p className="mt-3 text-sm text-[var(--sea-ink-soft)]">
					Enter a start and destination as address or <code>lat,lon</code>. The
					route is computed from pgRouting tables in Postgres.
				</p>
			</section>

			<section className="island-shell mt-6 rounded-2xl p-5">
				<form
					className="grid gap-3"
					onSubmit={async (event) => {
						event.preventDefault();
						setError(null);
						setIsSubmitting(true);

						try {
							const formData = new FormData(event.currentTarget);
							const startInput = String(
								formData.get("startInput") ?? "",
							).trim();
							const destinationInput = String(
								formData.get("destinationInput") ?? "",
							).trim();

							const response = await getDirections({
								data: {
									startInput,
									destinationInput,
								},
							});

							setResult(response);
						} catch (submitError) {
							const rawErrorMessage =
								submitError instanceof Error
									? submitError.message
									: "Directions service is temporarily unavailable.";
							const errorMessage = rawErrorMessage.includes("Failed query:")
								? "Directions service query failed. Verify pgRouting tables and try coordinate input."
								: rawErrorMessage;
							setError(errorMessage);
							setResult(null);
						} finally {
							setIsSubmitting(false);
						}
					}}
				>
					<label className="grid gap-1 text-sm font-semibold text-[var(--sea-ink)]">
						Start address or coordinates
						<input
							name="startInput"
							placeholder="40.7145,-73.9630 or 5th Ave NYC"
							className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
							required
						/>
					</label>

					<label className="grid gap-1 text-sm font-semibold text-[var(--sea-ink)]">
						Destination address or coordinates
						<input
							name="destinationInput"
							placeholder="40.7081,-73.9571 or Brooklyn Bridge"
							className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2 text-sm"
							required
						/>
					</label>

					<button
						type="submit"
						disabled={isSubmitting}
						className="w-fit rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
					>
						{isSubmitting ? "Calculating…" : "Get Directions"}
					</button>
				</form>
			</section>

			{error ? (
				<section className="island-shell mt-6 rounded-2xl border-[rgba(130,45,60,0.25)] bg-[rgba(170,64,85,0.08)] p-5 text-sm text-[rgb(132,45,66)]">
					{error}
				</section>
			) : null}

			{result ? (
				<section className="island-shell mt-6 rounded-2xl p-5">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="m-0 text-xl font-semibold text-[var(--sea-ink)]">
							Route Summary
						</h2>
						<button
							type="button"
							className="rounded-xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-xs font-semibold"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(
										formatDirectionsCopyText(result),
									);
									setIsCopied(true);
									setTimeout(() => {
										setIsCopied(false);
									}, 1200);
								} catch {
									setError(
										"Could not copy to clipboard. Please copy the text manually.",
									);
								}
							}}
						>
							{isCopied ? "Copied" : "Copy Output"}
						</button>
					</div>
					<p className="mb-1 mt-3 text-sm text-[var(--sea-ink-soft)]">
						<strong>Start:</strong> {result.start.raw} (
						{result.start.lat.toFixed(5)}, {result.start.lon.toFixed(5)})
					</p>
					<p className="mb-1 mt-0 text-sm text-[var(--sea-ink-soft)]">
						<strong>Destination:</strong> {result.destination.raw} (
						{result.destination.lat.toFixed(5)},{" "}
						{result.destination.lon.toFixed(5)})
					</p>
					<p className="mb-0 mt-0 text-sm text-[var(--sea-ink-soft)]">
						<strong>Total distance:</strong>{" "}
						{formatDistance(result.totalDistanceM)} |{" "}
						<strong>Estimated time:</strong> ~{result.estimatedMinutes} min
					</p>

					<ol className="mt-4 space-y-2 pl-5 text-sm text-[var(--sea-ink-soft)]">
						{result.steps.map((step) => (
							<li key={`${step.seq}-${step.roadName}`}>
								<strong>{step.instruction}</strong> for{" "}
								{formatDistance(step.lengthM)}
							</li>
						))}
						<li>Arrive at destination</li>
					</ol>
				</section>
			) : null}
		</main>
	);
}

function formatDistance(lengthM: number) {
	if (lengthM >= 1000) {
		return `${(lengthM / 1000).toFixed(2)} km`;
	}

	if (lengthM >= 100) {
		return `${lengthM.toFixed(0)} m`;
	}

	return `${lengthM.toFixed(1)} m`;
}

function formatDirectionsCopyText(result: DirectionsResponse) {
	const lines: string[] = [
		"Route Summary",
		`Start: ${result.start.raw} (${result.start.lat.toFixed(5)}, ${result.start.lon.toFixed(5)})`,
		`Destination: ${result.destination.raw} (${result.destination.lat.toFixed(5)}, ${result.destination.lon.toFixed(5)})`,
		`Total distance: ${formatDistance(result.totalDistanceM)}`,
		`Estimated time: ~${result.estimatedMinutes} min`,
		"",
		"Steps:",
	];

	for (const step of result.steps) {
		lines.push(
			`${step.seq}. ${step.instruction} for ${formatDistance(step.lengthM)}`,
		);
	}

	lines.push(`${result.steps.length + 1}. Arrive at destination`);

	return lines.join("\n");
}
