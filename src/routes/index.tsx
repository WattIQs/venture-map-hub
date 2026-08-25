import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Radar, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  fetchCountries,
  fetchStates,
  fetchCitiesByState,
  fetchCitiesByCountry,
} from "@/lib/apis";
import { geocodeCityServer, searchOverpassServer } from "@/lib/geo.functions";
import { processOverpassResults } from "@/lib/lead-qualification";

import { getSavedLeads, saveLead, removeLead, isLeadSaved } from "@/lib/store";
import type {
  CategoryKey,
  City,
  Country,
  Establishment,
  SavedLead,
  SortKey,
  State,
} from "@/lib/types";
import { SORT_LABELS } from "@/lib/types";

import { CategoryChips } from "@/components/sinal-zero/CategoryChips";
import { ExportCsvButton } from "@/components/sinal-zero/ExportCsvButton";
import { PlaceRow } from "@/components/sinal-zero/PlaceRow";
import { SavedLeadsDrawer } from "@/components/sinal-zero/SavedLeadsDrawer";

const MapCanvas = lazy(() => import("@/components/sinal-zero/MapCanvas"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sinal Zero — Mapa de negócios sem presença digital" },
      {
        name: "description",
        content:
          "Mapa gratuito de prospecção: encontre restaurantes, barbearias, pet shops, lojas e mercados sem site ou Instagram, com filtros de nota, preço e contato por WhatsApp.",
      },
      {
        property: "og:title",
        content: "Sinal Zero — Mapa de negócios sem presença digital",
      },
      {
        property: "og:description",
        content:
          "Mapa gratuito de prospecção com filtros de nota, preço e categoria, e contato direto por WhatsApp ou Instagram.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const DEFAULT_CATEGORIES: CategoryKey[] = ["restaurant", "fast_food", "cafe", "bar"];

function MapSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function Index() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);

  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");

  const [categories, setCategories] = useState<CategoryKey[]>(DEFAULT_CATEGORIES);
  const [onlyLowSignal, setOnlyLowSignal] = useState(true);
  const [onlyContactable, setOnlyContactable] = useState(true);
  const [minRating, setMinRating] = useState<string>("any");
  const [priceFilter, setPriceFilter] = useState<string>("any");
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);

  const [loadingCountries, setLoadingCountries] = useState(true);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [results, setResults] = useState<Establishment[]>([]);
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCountries(true);
    fetchCountries()
      .then((data) => {
        if (!cancelled) setCountries(data);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar a lista de países.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCountries(false);
      });

    setSavedLeads(getSavedLeads());
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedCountry) {
      setStates([]);
      setSelectedState("");
      return;
    }

    let cancelled = false;
    setLoadingStates(true);
    setSelectedState("");
    setCities([]);
    setSelectedCity("");

    const loadCountryCities = () => {
      setLoadingCities(true);
      fetchCitiesByCountry(selectedCountry)
        .then((citiesData) => {
          if (!cancelled) setCities(citiesData);
        })
        .catch(() => {
          if (!cancelled) setError("Não foi possível carregar cidades deste país.");
        })
        .finally(() => {
          if (!cancelled) setLoadingCities(false);
        });
    };

    fetchStates(selectedCountry)
      .then((data) => {
        if (cancelled) return;
        setStates(data);
        if (data.length === 0) loadCountryCities();
      })
      .catch(() => {
        if (cancelled) return;
        loadCountryCities();
      })
      .finally(() => {
        if (!cancelled) setLoadingStates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCountry]);

  useEffect(() => {
    if (!selectedCountry || !selectedState) return;

    let cancelled = false;
    setLoadingCities(true);
    setSelectedCity("");

    fetchCitiesByState(selectedCountry, selectedState)
      .then((data) => {
        if (!cancelled) setCities(data);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar cidades deste estado.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCities(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCountry, selectedState]);

  const handleScan = async () => {
    if (!selectedCountry || !selectedCity) {
      setError("Selecione país e cidade para escanear.");
      return;
    }
    if (categories.length === 0) {
      setError("Selecione pelo menos uma categoria.");
      return;
    }

    setError(null);
    setScanning(true);
    setResults([]);
    setSelectedId(null);

    try {
      const geo = await geocodeCityServer({
        data: {
          country: selectedCountry,
          state: selectedState || null,
          city: selectedCity,
        },
      });
      setCenter({ lat: geo.lat, lon: geo.lon });
      const delta = 0.09;
      const area =
        geo.boundingBox ?? {
          south: geo.lat - delta,
          north: geo.lat + delta,
          west: geo.lon - delta,
          east: geo.lon + delta,
        };
      const data = await searchOverpassServer({ data: { area, categories } });
      const processed = processOverpassResults(data.elements, categories);
      setResults(processed);
      setFiltersOpen(false);
      if (processed.length === 0) {
        setError("Nenhum estabelecimento encontrado. Tente outra categoria ou cidade.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao escanear área.");
    } finally {
      setScanning(false);
    }
  };

  const handleToggleSave = (lead: Establishment) => {
    if (isLeadSaved(lead.id)) removeLead(lead.id);
    else saveLead(lead);
    setSavedLeads(getSavedLeads());
  };

  const visibleResults = useMemo(() => {
    const order: Record<"zero" | "weak" | "full", number> = { zero: 0, weak: 1, full: 2 };
    let list = results;

    if (onlyLowSignal) list = list.filter((r) => r.level !== "full");
    if (onlyContactable) list = list.filter((r) => r.contactable);
    if (minRating !== "any") {
      const min = Number.parseFloat(minRating);
      list = list.filter((r) => r.rating !== null && r.rating >= min);
    }
    if (priceFilter !== "any") {
      const level = Number.parseInt(priceFilter, 10);
      list = list.filter((r) => r.priceLevel === level);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.address.toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "rating_desc":
          return (b.rating ?? -1) - (a.rating ?? -1);
        case "rating_asc":
          return (a.rating ?? 99) - (b.rating ?? 99);
        case "price_desc":
          return (b.priceLevel ?? 0) - (a.priceLevel ?? 0);
        case "price_asc":
          return (a.priceLevel ?? 99) - (b.priceLevel ?? 99);
        case "name_asc":
          return a.name.localeCompare(b.name, "pt-BR");
        default:
          if (a.contactable !== b.contactable) return a.contactable ? -1 : 1;
          return order[a.level] - order[b.level];
      }
    });
    return sorted;
  }, [results, onlyLowSignal, onlyContactable, minRating, priceFilter, query, sortKey]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Barra superior compacta */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/80 px-3 py-2 backdrop-blur">
        <div className="flex shrink-0 items-center gap-2">
          <Radar className="h-5 w-5 text-signal-zero" />
          <span className="text-sm font-bold tracking-tight">
            Sinal <span className="text-gradient-signal">Zero</span>
          </span>
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nos resultados (nome, categoria, endereço)"
            className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-3 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-primary"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 text-xs"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
          />
        </Button>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <SavedLeadsDrawer
            leads={savedLeads}
            onRemove={(id) => {
              removeLead(id);
              setSavedLeads(getSavedLeads());
            }}
          />
          <ExportCsvButton />
        </div>
      </header>

      {/* Painel de busca / filtros — colapsável, ocupa pouco espaço */}
      {filtersOpen && (
        <div className="shrink-0 border-b border-border bg-card/60 px-3 py-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Select
              value={selectedCountry}
              onValueChange={setSelectedCountry}
              disabled={loadingCountries}
            >
              <SelectTrigger className="h-9 bg-background text-xs">
                <SelectValue
                  placeholder={loadingCountries ? "Carregando países..." : "País"}
                />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedState}
              onValueChange={setSelectedState}
              disabled={!selectedCountry || loadingStates || states.length === 0}
            >
              <SelectTrigger className="h-9 bg-background text-xs">
                <SelectValue
                  placeholder={
                    loadingStates
                      ? "Carregando estados..."
                      : states.length === 0 && selectedCountry
                        ? "País sem estados"
                        : "Estado"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedCity}
              onValueChange={setSelectedCity}
              disabled={!selectedCountry || loadingCities || cities.length === 0}
            >
              <SelectTrigger className="h-9 bg-background text-xs">
                <SelectValue
                  placeholder={loadingCities ? "Carregando cidades..." : "Cidade"}
                />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={handleScan}
              disabled={scanning || !selectedCountry || !selectedCity}
              className="h-9 gap-2 text-xs"
            >
              {scanning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Escaneando...
                </>
              ) : (
                <>
                  <Radar className="h-3.5 w-3.5" />
                  Escanear área
                </>
              )}
            </Button>
          </div>

          <div className="mt-3">
            <CategoryChips value={categories} onChange={setCategories} />
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <Select value={minRating} onValueChange={setMinRating}>
              <SelectTrigger className="h-9 bg-background text-xs">
                <SelectValue placeholder="Classificação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer classificação</SelectItem>
                <SelectItem value="2">2 estrelas ou mais</SelectItem>
                <SelectItem value="3">3 estrelas ou mais</SelectItem>
                <SelectItem value="4">4 estrelas ou mais</SelectItem>
                <SelectItem value="4.5">4,5 estrelas ou mais</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priceFilter} onValueChange={setPriceFilter}>
              <SelectTrigger className="h-9 bg-background text-xs">
                <SelectValue placeholder="Preço" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer preço</SelectItem>
                <SelectItem value="1">$ · Preço baixo</SelectItem>
                <SelectItem value="2">$$ · Preço médio</SelectItem>
                <SelectItem value="3">$$$ · Preço alto</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-9 bg-background text-xs">
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3">
              <Label htmlFor="only-contactable" className="text-[11px] text-muted-foreground">
                Só contatáveis
              </Label>
              <Switch
                id="only-contactable"
                checked={onlyContactable}
                onCheckedChange={setOnlyContactable}
              />
              <Label htmlFor="only-low" className="text-[11px] text-muted-foreground">
                Sinal fraco
              </Label>
              <Switch id="only-low" checked={onlyLowSignal} onCheckedChange={setOnlyLowSignal} />
            </div>
          </div>
        </div>
      )}

      {/* Lista à esquerda + mapa à direita */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex h-1/2 min-h-0 w-full flex-col border-b border-border bg-card/40 lg:h-auto lg:w-[400px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
            <h2 className="text-sm font-semibold">Resultados</h2>
            <span className="text-[11px] text-muted-foreground">
              {visibleResults.length} de {results.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {scanning ? (
              <div className="space-y-2 px-4 py-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-md border border-border/50 bg-muted/40"
                  />
                ))}
              </div>
            ) : error ? (
              <p className="px-4 py-6 text-xs text-destructive">{error}</p>
            ) : visibleResults.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground">
                {results.length === 0
                  ? "Escolha país, estado, cidade e categorias e clique em Escanear área."
                  : "Nenhum resultado passou nos filtros atuais."}
              </p>
            ) : (
              visibleResults.map((place) => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  active={place.id === selectedId}
                  saved={savedLeads.some((l) => l.id === place.id)}
                  onSelect={setSelectedId}
                  onToggleSave={handleToggleSave}
                />
              ))
            )}
          </div>
        </aside>

        <main className="relative min-h-0 flex-1">
          <ClientOnly fallback={<MapSkeleton />}>
            <Suspense fallback={<MapSkeleton />}>
              <MapCanvas
                places={visibleResults}
                selectedId={selectedId}
                onSelect={setSelectedId}
                center={center}
              />
            </Suspense>
          </ClientOnly>

          {scanning && (
            <div className="absolute left-1/2 top-3 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-lg">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Localizando e varrendo a área...
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
