import type { City, Country, GeoPoint, State } from "./types";

const DEFAULT_RETRIES = 3;
const INITIAL_DELAY_MS = 500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delayMs?: number; context?: string } = {}
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let delay = options.delayMs ?? INITIAL_DELAY_MS;
  const context = options.context ? ` (${options.context})` : "";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === retries;
      if (isLast) {
        throw error;
      }
      console.warn(`Tentativa ${attempt} falhou${context}. Retentando em ${delay}ms...`);
      await sleep(delay);
      delay *= 2;
    }
  }

  throw new Error(`Falha após ${retries} tentativas${context}`);
}

const FALLBACK_COUNTRIES: Country[] = [
  { name: "Brazil" },
  { name: "United States" },
  { name: "Argentina" },
  { name: "Portugal" },
  { name: "Spain" },
  { name: "Mexico" },
  { name: "Chile" },
  { name: "Colombia" },
  { name: "France" },
  { name: "Italy" },
];

export async function fetchCountries(): Promise<Country[]> {
  return fetchWithRetry(
    async () => {
      const response = await fetch(
        "https://countries.dev/countries?fields=name&sort=name"
      );
      if (!response.ok) {
        throw new Error(`Erro ao carregar países: ${response.status}`);
      }
      const data = (await response.json()) as { name: string }[] | Country[];
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Resposta de países vazia ou inválida");
      }
      return data.map((item) => ({ name: item.name }));
    },
    { context: "lista de países" }
  ).catch(() => {
    console.warn("countries.dev falhou; usando lista de países fallback.");
    return FALLBACK_COUNTRIES;
  });
}

export async function fetchStates(country: string): Promise<State[]> {
  return fetchWithRetry(
    async () => {
      const response = await fetch(
        "https://countriesnow.space/api/v0.1/countries/states",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ country }),
        }
      );
      const data = (await response.json()) as {
        error?: boolean;
        msg?: string;
        data?: { states?: { name: string }[] };
      };
      if (data.error) {
        throw new Error(data.msg || "Erro ao carregar estados");
      }
      const states = data.data?.states ?? [];
      return states.map((s) => ({ name: s.name }));
    },
    { context: `estados de ${country}` }
  );
}

export async function fetchCitiesByState(
  country: string,
  state: string
): Promise<City[]> {
  return fetchWithRetry(
    async () => {
      const response = await fetch(
        "https://countriesnow.space/api/v0.1/countries/state/cities",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ country, state }),
        }
      );
      const data = (await response.json()) as {
        error?: boolean;
        msg?: string;
        data?: string[];
      };
      if (data.error) {
        throw new Error(data.msg || "Erro ao carregar cidades");
      }
      return (data.data ?? []).map((name) => ({ name }));
    },
    { context: `cidades de ${state}, ${country}` }
  );
}

export async function fetchCitiesByCountry(country: string): Promise<City[]> {
  return fetchWithRetry(
    async () => {
      const response = await fetch(
        "https://countriesnow.space/api/v0.1/countries/cities",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ country }),
        }
      );
      const data = (await response.json()) as {
        error?: boolean;
        msg?: string;
        data?: string[];
      };
      if (data.error) {
        throw new Error(data.msg || "Erro ao carregar cidades do país");
      }
      return (data.data ?? []).map((name) => ({ name }));
    },
    { context: `cidades do país ${country}` }
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function geocodeCity(
  country: string,
  state: string | null,
  city: string
): Promise<GeoPoint> {
  const query = state
    ? `${city}, ${state}, ${country}`
    : `${city}, ${country}`;

  return fetchWithRetry(
    async () => {
      const response = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&limit=1`,
        { headers: { Accept: "application/json" } },
        12000
      );
      if (!response.ok) {
        throw new Error(`Nominatim respondeu ${response.status}`);
      }
      const results = (await response.json()) as {
        lat: string;
        lon: string;
        boundingbox?: [string, string, string, string];
      }[];
      const first = results?.[0];
      if (!first) {
        throw new Error(
          "Cidade não encontrada. Tente simplificar o nome (sem bairro ou acentos)."
        );
      }
      const bb = first.boundingbox;
      return {
        lat: Number.parseFloat(first.lat),
        lon: Number.parseFloat(first.lon),
        boundingBox: bb
          ? {
              south: Number.parseFloat(bb[0]),
              north: Number.parseFloat(bb[1]),
              west: Number.parseFloat(bb[2]),
              east: Number.parseFloat(bb[3]),
            }
          : null,
      };
    },
    { retries: 2, context: "geocodificação da cidade" }
  );
}

