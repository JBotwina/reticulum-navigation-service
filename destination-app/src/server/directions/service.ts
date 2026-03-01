import { sql } from "drizzle-orm";
import { db } from "#/server/db/connection";

type RouteStep = {
	seq: number;
	roadName: string;
	lengthM: number;
	bearingDeg: number | null;
	instruction: string;
};

type RouteSegmentRow = {
	seq: number | string;
	road_name: string | null;
	length_m: number | string;
	bearing_deg: number | string | null;
};

type ResolvedLocation = {
	raw: string;
	lat: number;
	lon: number;
	source: "coords" | "geocoded";
};

export type DirectionsRequest = {
	startInput: string;
	destinationInput: string;
};

export type DirectionsResponse = {
	start: ResolvedLocation;
	destination: ResolvedLocation;
	totalDistanceM: number;
	estimatedMinutes: number;
	steps: RouteStep[];
};

const COORDINATE_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const CONNECTOR_MAX_LENGTH_M = 20;

function getRoutingWaysTable() {
	return process.env.PGR_WAYS_TABLE ?? "ways";
}

function getRoutingVerticesTable() {
	return process.env.PGR_VERTICES_TABLE ?? "ways_vertices_pgr";
}

function getGeocoderUserAgent() {
	return process.env.GEOCODER_USER_AGENT ?? "destination_directions_bot";
}

function getEstimatedSpeedKmh() {
	const rawSpeed = Number(process.env.DIRECTIONS_SPEED_KMH ?? "40");
	return Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 40;
}

function getDisallowedRoadClasses() {
	return ["footway", "pedestrian", "steps", "path", "cycleway", "bridleway"];
}

function getDisallowedRoadClassesSql() {
	return getDisallowedRoadClasses()
		.map((roadClass) => `'${roadClass}'`)
		.join(", ");
}

function assertSafeTableName(tableName: string) {
	if (!TABLE_NAME_PATTERN.test(tableName)) {
		throw new Error(`Unsafe table name: ${tableName}`);
	}
}

function parseCoordinates(raw: string) {
	const match = COORDINATE_PATTERN.exec(raw);
	if (!match) {
		return null;
	}

	const lat = Number(match[1]);
	const lon = Number(match[2]);
	const isValid = lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

	if (!isValid) {
		return null;
	}

	return { lat, lon };
}

async function geocodeAddress(raw: string) {
	const searchParams = new URLSearchParams({
		q: raw,
		format: "jsonv2",
		limit: "1",
	});

	const response = await fetch(
		`https://nominatim.openstreetmap.org/search?${searchParams.toString()}`,
		{
			headers: {
				"User-Agent": getGeocoderUserAgent(),
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Geocoder failed with status ${response.status}`);
	}

	const payload = (await response.json()) as Array<{
		lat: string;
		lon: string;
	}>;
	const firstResult = payload[0];

	if (!firstResult) {
		return null;
	}

	const lat = Number(firstResult.lat);
	const lon = Number(firstResult.lon);

	if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
		return null;
	}

	return { lat, lon };
}

async function resolveLocation(raw: string): Promise<ResolvedLocation | null> {
	const normalizedInput = raw.trim();
	const coordinates = parseCoordinates(normalizedInput);

	if (coordinates) {
		return {
			raw: normalizedInput,
			lat: coordinates.lat,
			lon: coordinates.lon,
			source: "coords",
		};
	}

	const geocoded = await geocodeAddress(normalizedInput);
	if (!geocoded) {
		return null;
	}

	return {
		raw: normalizedInput,
		lat: geocoded.lat,
		lon: geocoded.lon,
		source: "geocoded",
	};
}

async function findNearestVertexId(
	verticesTable: string,
	waysTable: string,
	disallowedRoadClassesSql: string,
	lat: number,
	lon: number,
) {
	const nearestVertexResult = await db.execute<{ id: number | string }>(
		sql`SELECT id
        FROM ${sql.raw(verticesTable)}
        WHERE EXISTS (
          SELECT 1
          FROM ${sql.raw(waysTable)} AS w
          LEFT JOIN public.configuration AS c ON w.tag_id = c.tag_id
          WHERE (w.source = ${sql.raw(verticesTable)}.id OR w.target = ${sql.raw(verticesTable)}.id)
            AND COALESCE(c.tag_value, '') NOT IN (${sql.raw(disallowedRoadClassesSql)})
        )
        ORDER BY the_geom <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
        LIMIT 1`,
	);

	const nearestVertex = nearestVertexResult[0];
	if (!nearestVertex) {
		throw new Error("No nearby vertex found");
	}

	return Number(nearestVertex.id);
}

function compactSteps(steps: RouteStep[]) {
	if (steps.length === 0) {
		return [];
	}

	const compacted: RouteStep[] = [
		{
			seq: 1,
			roadName: steps[0].roadName,
			lengthM: steps[0].lengthM,
			bearingDeg: steps[0].bearingDeg,
			instruction: steps[0].instruction,
		},
	];

	for (const step of steps.slice(1)) {
		const previous = compacted[compacted.length - 1];

		if (step.roadName === previous.roadName) {
			const previousLength = previous.lengthM;
			previous.lengthM += step.lengthM;
			previous.bearingDeg = weightedBearing(
				previous.bearingDeg,
				previousLength,
				step.bearingDeg,
				step.lengthM,
			);
			continue;
		}

		compacted.push({
			seq: compacted.length + 1,
			roadName: step.roadName,
			lengthM: step.lengthM,
			bearingDeg: step.bearingDeg,
			instruction: step.instruction,
		});
	}

	return compacted;
}

function collapseConnectorDetours(steps: RouteStep[]) {
	if (steps.length < 3) {
		return steps;
	}

	const normalizedSteps = [...steps];
	let index = 1;

	while (index < normalizedSteps.length - 1) {
		const previous = normalizedSteps[index - 1];
		const current = normalizedSteps[index];
		const next = normalizedSteps[index + 1];

		const isShortConnector = current.lengthM <= CONNECTOR_MAX_LENGTH_M;
		const returnsToSameRoad = previous.roadName === next.roadName;

		if (!isShortConnector || !returnsToSameRoad) {
			index += 1;
			continue;
		}

		const previousLength = previous.lengthM;
		previous.lengthM += current.lengthM + next.lengthM;
		previous.bearingDeg = weightedBearing(
			previous.bearingDeg,
			previousLength,
			next.bearingDeg,
			next.lengthM,
		);

		normalizedSteps.splice(index, 2);
	}

	for (const [normalizedIndex, step] of normalizedSteps.entries()) {
		step.seq = normalizedIndex + 1;
	}

	return normalizedSteps;
}

function weightedBearing(
	firstBearingDeg: number | null,
	firstLengthM: number,
	secondBearingDeg: number | null,
	secondLengthM: number,
) {
	if (firstBearingDeg === null) {
		return secondBearingDeg;
	}

	if (secondBearingDeg === null) {
		return firstBearingDeg;
	}

	const totalLength = firstLengthM + secondLengthM;
	if (totalLength <= 0) {
		return firstBearingDeg;
	}

	return (
		(firstBearingDeg * firstLengthM + secondBearingDeg * secondLengthM) /
		totalLength
	);
}

function normalizeTurnDelta(deltaDeg: number) {
	let normalizedDelta = deltaDeg;
	while (normalizedDelta > 180) {
		normalizedDelta -= 360;
	}
	while (normalizedDelta <= -180) {
		normalizedDelta += 360;
	}
	return normalizedDelta;
}

function getInstructionForStep(
	currentRoadName: string,
	currentBearingDeg: number | null,
	previousBearingDeg: number | null,
	isFirstStep: boolean,
) {
	if (
		isFirstStep ||
		currentBearingDeg === null ||
		previousBearingDeg === null
	) {
		return `Head on ${currentRoadName}`;
	}

	const turnDelta = normalizeTurnDelta(currentBearingDeg - previousBearingDeg);
	const absoluteDelta = Math.abs(turnDelta);
	const turnSide = turnDelta >= 0 ? "right" : "left";

	if (absoluteDelta < 20) {
		return `Continue straight onto ${currentRoadName}`;
	}

	if (absoluteDelta < 45) {
		return `Slight ${turnSide} onto ${currentRoadName}`;
	}

	if (absoluteDelta < 135) {
		return `Turn ${turnSide} onto ${currentRoadName}`;
	}

	if (absoluteDelta > 160) {
		return `Make a U-turn onto ${currentRoadName}`;
	}

	return `Make a sharp ${turnSide} onto ${currentRoadName}`;
}

function attachTurnInstructions(steps: RouteStep[]) {
	const enrichedSteps: RouteStep[] = [];
	let previousBearingDeg: number | null = null;

	for (const [index, step] of steps.entries()) {
		const instruction = getInstructionForStep(
			step.roadName,
			step.bearingDeg,
			previousBearingDeg,
			index === 0,
		);
		enrichedSteps.push({
			...step,
			instruction,
		});
		previousBearingDeg = step.bearingDeg;
	}

	return enrichedSteps;
}

async function fetchRouteSegments(
	edgesSql: string,
	startVertexId: number,
	destinationVertexId: number,
	waysTable: string,
) {
	return db.execute<RouteSegmentRow>(sql`WITH route AS (
      SELECT *
      FROM pgr_dijkstra(
        ${edgesSql}::text,
        ${startVertexId}::bigint,
        ${destinationVertexId}::bigint,
        true
      )
    )
    , route_edges AS (
      SELECT
        route.seq,
        COALESCE(
          NULLIF(w.name, ''),
          CASE
            WHEN NULLIF(c.tag_value, '') IS NULL THEN NULL
            ELSE INITCAP(REPLACE(c.tag_value, '_', ' '))
          END,
          'Unnamed road'
        ) AS road_name,
        COALESCE(route.cost, 0)::double precision AS length_m,
        CASE
          WHEN route.node = w.source THEN w.the_geom
          ELSE ST_Reverse(w.the_geom)
        END AS oriented_geom
      FROM route
      JOIN ${sql.raw(waysTable)} AS w ON route.edge = w.gid
      LEFT JOIN public.configuration AS c ON w.tag_id = c.tag_id
      WHERE route.edge <> -1
    )
    SELECT
      seq,
      road_name,
      length_m,
      DEGREES(
        ST_Azimuth(
          ST_StartPoint(oriented_geom),
          ST_EndPoint(oriented_geom)
        )
      ) AS bearing_deg
    FROM route_edges
    ORDER BY seq`);
}

export async function getDirections(
	request: DirectionsRequest,
): Promise<DirectionsResponse> {
	const start = await resolveLocation(request.startInput);
	if (!start) {
		throw new Error("Could not resolve start location.");
	}

	const destination = await resolveLocation(request.destinationInput);
	if (!destination) {
		throw new Error("Could not resolve destination location.");
	}

	const waysTable = getRoutingWaysTable();
	const verticesTable = getRoutingVerticesTable();
	const disallowedRoadClassesSql = getDisallowedRoadClassesSql();

	assertSafeTableName(waysTable);
	assertSafeTableName(verticesTable);

	const startVertexId = await findNearestVertexId(
		verticesTable,
		waysTable,
		disallowedRoadClassesSql,
		start.lat,
		start.lon,
	);
	const destinationVertexId = await findNearestVertexId(
		verticesTable,
		waysTable,
		disallowedRoadClassesSql,
		destination.lat,
		destination.lon,
	);

	const distanceExpression = `COALESCE(NULLIF(w.length_m, 0), NULLIF(w.length * 1000.0, 0), NULLIF(ST_Length(w.the_geom::geography), 0), 0)`;
	const edgesSql = `SELECT w.gid AS id, w.source, w.target, ${distanceExpression} AS cost, ${distanceExpression} AS reverse_cost FROM ${waysTable} w LEFT JOIN public.configuration c ON w.tag_id = c.tag_id WHERE COALESCE(c.tag_value, '') NOT IN (${disallowedRoadClassesSql})`;

	const routeSegmentsResult = await fetchRouteSegments(
		edgesSql,
		startVertexId,
		destinationVertexId,
		waysTable,
	);

	const routeSteps: RouteStep[] = routeSegmentsResult.map((segment, index) => ({
		seq: index + 1,
		roadName: segment.road_name ?? "Unnamed road",
		lengthM: Number(segment.length_m),
		bearingDeg:
			segment.bearing_deg === null ? null : Number(segment.bearing_deg),
		instruction: "",
	}));

	const compactedSteps = compactSteps(routeSteps);
	const smoothedSteps = collapseConnectorDetours(compactedSteps);
	const steps = attachTurnInstructions(smoothedSteps);
	if (steps.length === 0) {
		throw new Error(
			"No drivable route found between start and destination in the current graph.",
		);
	}

	const totalDistanceM = steps.reduce((sum, step) => sum + step.lengthM, 0);
	const estimatedMinutes = Math.max(
		1,
		Math.round((totalDistanceM / 1000 / getEstimatedSpeedKmh()) * 60),
	);

	return {
		start,
		destination,
		steps,
		totalDistanceM,
		estimatedMinutes,
	};
}
