"use client";

import { useState } from "react";
import { SlidersIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";

export type VideoFilters = {
  brightness: number;
  contrast: number;
  saturation: number;
};

const DEFAULTS: VideoFilters = { brightness: 1, contrast: 1, saturation: 1 };

const STORAGE_KEY = "sharescreen:videoFilters";

function loadFilters(id: string): VideoFilters {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const all = JSON.parse(raw) as Record<string, VideoFilters>;
    return all[id] ? { ...DEFAULTS, ...all[id] } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveFilters(id: string, filters: VideoFilters): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, VideoFilters> : {};
    all[id] = filters;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function getFilterStyle(filters: VideoFilters): React.CSSProperties | undefined {
  if (filters.brightness === 1 && filters.contrast === 1 && filters.saturation === 1) return undefined;
  return {
    filter: `brightness(${filters.brightness}) contrast(${filters.contrast}) saturate(${filters.saturation})`,
  };
}

export function VideoFiltersPanel({
  tileId,
  filters: externalFilters,
  onFiltersChange,
}: {
  tileId: string;
  filters: VideoFilters;
  onFiltersChange: (f: VideoFilters) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const update = (key: keyof VideoFilters, value: number) => {
    const next = { ...externalFilters, [key]: value };
    onFiltersChange(next);
    saveFilters(tileId, next);
  };

  const reset = () => {
    onFiltersChange({ ...DEFAULTS });
    saveFilters(tileId, { ...DEFAULTS });
  };

  const isDefault =
    externalFilters.brightness === DEFAULTS.brightness &&
    externalFilters.contrast === DEFAULTS.contrast &&
    externalFilters.saturation === DEFAULTS.saturation;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <Tooltip content="Ajustes de imagem">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          aria-label="Ajustes de imagem"
          className={`rounded-full p-2 text-white active:bg-black/80 ${
            isOpen ? "bg-white/20" : "bg-black/60 hover:bg-black/80"
          }`}
        >
          <SlidersIcon className="h-5 w-5" />
        </button>
      </Tooltip>
      {isOpen && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-white/10 bg-zinc-900/95 p-3 shadow-xl backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-white">Ajustes de imagem</span>
            {!isDefault && (
              <button
                type="button"
                onClick={reset}
                className="text-[10px] text-zinc-400 hover:text-white"
              >
                Redefinir
              </button>
            )}
          </div>
          <FilterSlider
            label="Brilho"
            value={externalFilters.brightness}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => update("brightness", v)}
          />
          <FilterSlider
            label="Contraste"
            value={externalFilters.contrast}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => update("contrast", v)}
          />
          <FilterSlider
            label="Saturação"
            value={externalFilters.saturation}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => update("saturation", v)}
          />
        </div>
      )}
    </div>
  );
}

function FilterSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{label}</span>
        <span className="text-[11px] text-zinc-500">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-white/70"
      />
    </div>
  );
}

export function useVideoFilters(tileId: string) {
  const [filters, setFilters] = useState<VideoFilters>(() => loadFilters(tileId));
  return { filters, setFilters };
}
