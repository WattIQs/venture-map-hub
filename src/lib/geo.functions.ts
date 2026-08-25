import { createServerFn } from "@tanstack/react-start";
import type { BoundingBox, CategoryKey, GeoPoint } from "./types";
import { buildOverpassQuery } from "./overpass-query";
import { fetchWithTimeout, OSM_UA, OVERPASS_MIRRORS } from "./geo.server";

export interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface PlaceSuggestion {
  label: string;
  shortLabel: string;
  lat: number;
  lon: number;
  boundingBox: BoundingBox | null;
}

export const geocodeCityServer = createServerFn({ method: "POST" })
  .inputValidator((data: { country: string; state?: string | null; city: string }) => data)
  .handler(async ({ data }): Promise<GeoPoint> => {
    const query = data.state
      ? `${data.city}, ${data.state}, ${data.country}`
      : `${data.city}, ${data.country}`;

    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { Accept: "application/json", "User-Agent": OSM_UA } },
      20000
    );
    if (!response.ok) {
      throw new Error(
        `Não foi possível localizar a cidade agora (código ${response.status}). Tente novamente em alguns segundos.`
      );
    }
    const results = (await response.json()) as {
      lat: string;
      lon: string;
      boundingbox?: [string, string, string, string];
    }[];
    const first = results[0];
    if (!first) {
      throw new Error(
        "Cidade não encontrada. Tente escrever o nome sem bairro e sem abreviações."
      );
    }
    const bb = first.boundingbox;
    return {
      lat: Number.parseFloat(first.lat),
      lon: Number.parseFloat(first.lon),
      boundingBox: bb
        ? {
            south: Number.parseFloat(bb[0]!),
            north: Number.parseFloat(bb[1]!),
            west: Number.parseFloat(bb[2]!),
            east: Number.parseFloat(bb[3]!),
          }
        : null,
    };
  });

/** Busca livre: país, estado, cidade, bairro, rua ou ponto de referência. */
export const searchPlacesServer = createServerFn({ method: "POST" })
  .inputValidator((data: { q: string }) => data)
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => {
    const q = data.q.trim();
    if (q.length < 3) return [];

    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
      { headers: { Accept: "application/json", "User-Agent": OSM_UA } },
      20000
    );
    if (!response.ok) {
      throw new Error(
        `Busca de lugares indisponível agora (código ${response.status}). Tente de novo em alguns segundos.`
      );
    }
    const results = (await response.json()) as {
      display_name: string;
      lat: string;
      lon: string;
      boundingbox?: [string, string, string, string];
    }[];

    return results.map((r) => {
      const bb = r.boundingbox;
      const parts = r.display_name.split(",").map((p) => p.trim());
      return {
        label: r.display_name,
        shortLabel: parts.slice(0, 3).join(", "),
        lat: Number.parseFloat(r.lat),
        lon: Number.parseFloat(r.lon),
        boundingBox: bb
          ? {
              south: Number.parseFloat(bb[0]!),
              north: Number.parseFloat(bb[1]!),
              west: Number.parseFloat(bb[2]!),
              east: Number.parseFloat(bb[3]!),
            }
          : null,
      };
    });
  });

export const searchOverpassServer = createServerFn({ method: "POST" })
  .inputValidator((data: { area: BoundingBox; categories: CategoryKey[] }) => data)
  .handler(async ({ data }): Promise<{ elements: OverpassElement[] }> => {
    const query = buildOverpassQuery(data.area, data.categories);

    const errors: string[] = [];
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const response = await fetchWithTimeout(
          mirror,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": OSM_UA,
            },
            body: `data=${encodeURIComponent(query)}`,
          },
          55000
        );
        if (!response.ok) {
          errors.push(`${mirror}: ${response.status}`);
          continue;
        }
        const json = (await response.json()) as { elements?: OverpassElement[] };
        return { elements: json.elements ?? [] };
      } catch (error) {
        errors.push(`${mirror}: ${(error as Error).message}`);
      }
    }

    throw new Error(
      `Os servidores do OpenStreetMap estão sobrecarregados agora. Tente novamente em alguns segundos. (${errors.join(" | ")})`
    );
  });
