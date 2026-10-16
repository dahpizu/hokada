import { useEffect, useRef, useState } from "react";

const PHOTON_URL = "https://photon.komoot.io/api/";

function formatAddress(feature) {
  const p = feature?.properties || {};
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const parts = [
    p.name,
    street,
    p.district,
    p.city || p.locality,
    p.state,
    p.country,
  ].filter(Boolean);

  return parts.filter(
    (part, index) =>
      parts.findIndex(
        (other) => other.toLowerCase() === part.toLowerCase()
      ) === index
  ).join(", ");
}

export default function GoogleAddressInput({
  value,
  placeholder,
  onChange,
  onSelect,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const search = query.trim();

    if (search.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }

    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const isIkotunIgandoArea =
          /ikotun|igando|idimu|egbe|isheri/i.test(search);

        const params = new URLSearchParams({
          q: `${search}, Lagos, Nigeria`,
          limit: "7",
          lang: "en",
          lat: isIkotunIgandoArea ? "6.55" : "6.5244",
          lon: isIkotunIgandoArea ? "3.27" : "3.3792",
          dedupe: "1",
        });

        // Keep searches for the Ikotun/Igando axis near that area,
        // rather than returning unrelated places such as Yaba.
        if (isIkotunIgandoArea) {
          params.set("bbox", "3.18,6.45,3.36,6.68");
          params.set("zoom", "13");
        }

        const response = await fetch(
          `${PHOTON_URL}?${params.toString()}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }
        );

        if (!response.ok) {
          throw new Error("Address search unavailable");
        }

        const data = await response.json();

        if (requestId !== requestRef.current) return;

        const results = (data.features || [])
          .map((feature) => ({
            id: `${feature.properties?.osm_type || "place"}-${
              feature.properties?.osm_id || formatAddress(feature)
            }`,
            description: formatAddress(feature),
            coords: {
              lng: Number(feature.geometry?.coordinates?.[0]),
              lat: Number(feature.geometry?.coordinates?.[1]),
            },
            category:
              feature.properties?.type ||
              feature.properties?.osm_value ||
              "Place",
          }))
          .filter(
            (item) =>
              item.description &&
              Number.isFinite(item.coords.lat) &&
              Number.isFinite(item.coords.lng)
          );

        setSuggestions(results);
      } catch (error) {
        if (
          error.name !== "AbortError" &&
          requestId === requestRef.current
        ) {
          setSuggestions([]);
        }
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function selectSuggestion(suggestion) {
    setSuggestions([]);
    setQuery("");
    onChange(suggestion.description);
    onSelect({
      address: suggestion.description,
      coords: suggestion.coords,
    });
  }

  return (
    <div
      className="google-address-autocomplete"
      style={{ flex: 1, minWidth: 0, position: "relative" }}
    >
      <input
        className="google-address-input"
        type="text"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
        }}
        onFocus={() => {
          if (value.trim().length >= 3) setQuery(value);
        }}
        onBlur={() => {
          window.setTimeout(() => setSuggestions([]), 180);
        }}
        style={{ width: "100%", boxSizing: "border-box" }}
      />

      {loading && (
        <div style={{ fontSize: 12, padding: "6px 0", color: "#64748b" }}>
          Searching addresses…
        </div>
      )}

      {suggestions.length > 0 && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 1000,
            background: "#fff",
            color: "#172033",
            border: "1px solid #dbe2ea",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.14)",
            overflow: "hidden",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              role="option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
              style={{
                display: "block",
                width: "100%",
                padding: 12,
                border: 0,
                borderBottom: "1px solid #edf0f4",
                background: "#fff",
                color: "#172033",
                textAlign: "left",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              <span style={{ display: "block", fontWeight: 600 }}>
                {suggestion.description}
              </span>
              <span
                style={{
                  display: "block",
                  color: "#64748b",
                  marginTop: 3,
                  fontSize: 12,
                }}
              >
                {suggestion.category} · OpenStreetMap
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
