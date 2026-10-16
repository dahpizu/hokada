import { useEffect, useState } from "react";
export default function AddressLocationSection({
  title,
  value,
  onChange,
  onSelect,
}) {
  const [house, setHouse] = useState("");
  const [street, setStreet] = useState("");
  const [busStop, setBusStop] = useState("");
  const [landmark, setLandmark] = useState("");
  const [area, setArea] = useState("");
  const [state, setState] = useState("Lagos");

  const [areaSearchStatus, setAreaSearchStatus] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState([]);

  // Search all address fields, then progressively try broader searches.
  useEffect(() => {
    const fullAddress = [
      house.trim(),
      street.trim(),
      busStop.trim(),
      landmark.trim(),
      area.trim(),
      state,
      "Nigeria",
    ].filter(Boolean).join(", ");

    if (
      !house.trim() &&
      !street.trim() &&
      !busStop.trim() &&
      !landmark.trim() &&
      area.trim().length < 3
    ) {
      setAreaSearchStatus("");
      setPlaceSuggestions([]);
      return;
    }

    const queries = [];
    const addQuery = (parts) => {
      const query = parts.filter(Boolean).join(", ");
      if (query && !queries.includes(query)) queries.push(query);
    };

    // Prioritise the street address so a generic bus stop name
    // cannot pull the map into an unrelated neighbourhood.
    if (house.trim() && street.trim()) {
      addQuery([house.trim(), street.trim(), area.trim(), state, "Nigeria"]);
    }

    if (street.trim()) {
      addQuery([street.trim(), area.trim(), state, "Nigeria"]);
    }

    if (landmark.trim() && street.trim()) {
      addQuery([landmark.trim(), street.trim(), area.trim(), state, "Nigeria"]);
    }

    if (busStop.trim() && street.trim()) {
      addQuery([busStop.trim(), street.trim(), area.trim(), state, "Nigeria"]);
    }

    if (landmark.trim() || busStop.trim()) {
      addQuery([landmark.trim(), busStop.trim(), area.trim(), state, "Nigeria"]);
      addQuery([busStop.trim(), area.trim(), state, "Nigeria"]);
      addQuery([landmark.trim(), area.trim(), state, "Nigeria"]);
    }

    addQuery([fullAddress]);

    if (area.trim()) {
      addQuery([area.trim(), state, "Nigeria"]);
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setAreaSearchStatus("Searching address and nearby places...");
      setPlaceSuggestions([]);

      try {
        let matches = [];

        for (const query of queries) {
          const params = new URLSearchParams({
            q: query,
            limit: "5",
            lang: "en",
            lat: "6.55",
            lon: "3.27",
            dedupe: "1",
          });

          const response = await fetch(
            `https://photon.komoot.io/api/?${params.toString()}`,
            { headers: { Accept: "application/json" } }
          );

          if (!response.ok) continue;

          const data = await response.json();
          const features = (data.features || []).filter((feature) => {
            const point = feature.geometry?.coordinates;
            return (
              Array.isArray(point) &&
              Number.isFinite(Number(point[0])) &&
              Number.isFinite(Number(point[1]))
            );
          });

          if (features.length) {
            matches = features;
            break;
          }
        }

        if (cancelled) return;

        if (!matches.length) {
          setAreaSearchStatus(
            "No matching place found. Try another spelling or add more address details."
          );
          setPlaceSuggestions([]);
          return;
        }

        const suggestions = matches.map((feature, index) => {
          const p = feature.properties || {};
          const name = p.name || p.street || p.locality || p.city || "Nearby location";
          const detail = [
            p.street && p.name !== p.street ? p.street : "",
            p.district,
            p.locality,
            p.city,
            p.state,
          ].filter(Boolean).filter((item, i, arr) => arr.indexOf(item) === i).join(", ");

          return {
            id: `${name}-${index}`,
            label: name,
            detail,
            lat: Number(feature.geometry.coordinates[1]),
            lng: Number(feature.geometry.coordinates[0]),
          };
        });

        setPlaceSuggestions(suggestions);
        setAreaSearchStatus(
          "Choose the correct matching place to save its delivery coordinates."
        );
      } catch {
        if (!cancelled) {
          setAreaSearchStatus(
            "Search is temporarily unavailable. You can still enter the full address manually."
          );
          setPlaceSuggestions([]);
        }
      }
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [house, street, busStop, landmark, area, state]);

  function chooseSuggestion(place) {
    const nextCoords = { lat: place.lat, lng: place.lng };
    const address = [
      house.trim(),
      street.trim(),
      busStop.trim() && `Near ${busStop.trim()}`,
      landmark.trim() && `Landmark: ${landmark.trim()}`,
      place.label,
      state,
      "Nigeria",
    ].filter(Boolean).join(", ");

    setArea(place.label);
    onChange(address);
    onSelect({ address, coords: nextCoords });
    setPlaceSuggestions([]);
    setAreaSearchStatus("Address selected. Location coordinates saved for delivery routing.");
  }

  function updateField(setter, nextValue) {
    setter(nextValue);
    setPinConfirmed(false);

    const fields = {
      house,
      street,
      busStop,
      landmark,
      area,
      state,
    };

    if (setter === setHouse) fields.house = nextValue;
    if (setter === setStreet) fields.street = nextValue;
    if (setter === setBusStop) fields.busStop = nextValue;
    if (setter === setLandmark) fields.landmark = nextValue;
    if (setter === setArea) fields.area = nextValue;
    if (setter === setState) fields.state = nextValue;

    const address = [
      fields.house,
      fields.street,
      fields.busStop && `Near ${fields.busStop}`,
      fields.landmark && `Landmark: ${fields.landmark}`,
      fields.area,
      fields.state,
      "Nigeria",
    ].filter(Boolean).join(", ");

    onChange(address);
  }

  return (
    <section className="form-section hokada-address-section">
      <label className="hokada-address-heading">{title}</label>
      <p className="hokada-address-help">
        Add as much detail as you can to help the rider find the exact location.
      </p>

      <div className="hokada-address-fields">
        <label>
          House / building number
          <input
            value={house}
            onChange={(event) => updateField(setHouse, event.target.value)}
            placeholder="e.g. No. 12, Block B"
            autoComplete="address-line1"
          />
        </label>

        <label>
          Street address
          <input
            value={street}
            onChange={(event) => updateField(setStreet, event.target.value)}
            placeholder="e.g. Bakare Street"
            autoComplete="address-line2"
          />
        </label>

        <label>
          Bus stop / nearest junction
          <input
            value={busStop}
            onChange={(event) => updateField(setBusStop, event.target.value)}
            placeholder="e.g. Ikotun Roundabout"
          />
        </label>

        <label>
          Popular place / landmark (optional)
          <input
            value={landmark}
            onChange={(event) => updateField(setLandmark, event.target.value)}
            placeholder="e.g. Near a market or filling station"
          />
        </label>

        <label>
          Area / neighbourhood
          <input
            value={area}
            onChange={(event) => updateField(setArea, event.target.value)}
            placeholder="e.g. Ikotun, Igando, Ikoyi"
            autoComplete="address-level3"
          />
          {areaSearchStatus && (
            <small role="status">{areaSearchStatus}</small>
          )}
          {placeSuggestions.length > 0 && (
            <div className="hokada-place-suggestions">
              <strong>Matching places</strong>
              {placeSuggestions.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => chooseSuggestion(place)}
                  className="hokada-place-suggestion"
                >
                  <span>{place.label}</span>
                  {place.detail && <small>{place.detail}</small>}
                </button>
              ))}
            </div>
          )}
        </label>

        <label>
          State
          <select
            value={state}
            onChange={(event) => updateField(setState, event.target.value)}
          >
            <option value="Lagos">Lagos</option>
            <option value="Ogun">Ogun</option>
            <option value="Oyo">Oyo</option>
            <option value="Other">Other</option>
          </select>
        </label>
      </div>

      <div className="hokada-address-summary">
        <strong>Full address</strong>
        <p>{value || "Your completed address will appear here."}</p>
      </div>

    </section>
  );
}
