import { useEffect, useMemo, useState } from "react";
import {
  MapPin,
  Search,
  LoaderCircle,
  CheckCircle2,
  LocateFixed,
  History,
  ChevronDown,
  Trash2
} from "lucide-react";

const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa",
  "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo",
  "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna",
  "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
  "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

const AREAS = {
  Lagos: [
    "Agege", "Ajah", "Alimosho", "Amuwo-Odofin", "Apapa",
    "Badagry", "Egbeda", "Ejigbo", "Epe", "Festac Town",
    "Gbagada", "Ibeju-Lekki", "Ikeja", "Ikorodu", "Ikotun",
    "Isolo", "Ketu", "Lekki", "Maryland", "Mushin",
    "Ojo", "Ojodu", "Ojota", "Okota", "Oniru",
    "Orile", "Oshodi", "Surulere", "Victoria Island", "Yaba"
  ],
  Ogun: [
    "Abeokuta", "Agbara", "Ijebu Ode", "Mowe",
    "Odogbolu", "Ota", "Sagamu"
  ],
  Oyo: ["Ibadan", "Ogbomoso", "Oyo", "Iseyin"],
  FCT: [
    "Abuja Municipal", "Gwagwalada", "Kuje",
    "Kubwa", "Lugbe", "Nyanya"
  ]
};

export default function AddressLocationSection({
  title = "Pickup Address",
  value = "",
  onChange = () => {},
  onSelect = () => {},
  savedAddresses = [],
  onDeleteSavedAddress = () => {}
}) {
  const [state, setState] = useState("");
  const [areaChoice, setAreaChoice] = useState("");
  const [areaConfirmed, setAreaConfirmed] = useState(false);
  const [customArea, setCustomArea] = useState("");
  const [areaSuggestions, setAreaSuggestions] = useState([]);
  const [areaSearching, setAreaSearching] = useState(false);
  const [showAreaSuggestions, setShowAreaSuggestions] = useState(false);
  const [houseStreet, setHouseStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedSavedAddress, setSelectedSavedAddress] = useState("");
  const [showSavedAddresses, setShowSavedAddresses] = useState(false);
  const [locationMethod, setLocationMethod] = useState("");
  const [error, setError] = useState("");

  const area =
    areaChoice === "__custom__" ? customArea.trim() : areaChoice;

  const fullAddress = useMemo(() => {
    const parts = [];

    if (houseStreet.trim()) parts.push(houseStreet.trim());
    if (area) parts.push(area);
    if (state) parts.push(state);
    parts.push("Nigeria");

    if (landmark.trim()) {
      parts.push(`Near ${landmark.trim()}`);
    }

    return parts.filter(Boolean).join(", ");
  }, [houseStreet, area, state, landmark]);

  const showArea = Boolean(state);
  const showHouseStreet = Boolean(state && area && areaConfirmed);
  const showLandmark = Boolean(state && area && houseStreet.trim());

  function publishAddress(next = {}) {
    const nextState = next.state ?? state;
    const nextAreaChoice = next.areaChoice ?? areaChoice;
    const nextCustomArea = next.customArea ?? customArea;
    const nextHouseStreet = next.houseStreet ?? houseStreet;
    const nextLandmark = next.landmark ?? landmark;

    const nextArea =
      nextAreaChoice === "__custom__"
        ? nextCustomArea.trim()
        : nextAreaChoice;

    const parts = [];

    if (nextHouseStreet.trim()) parts.push(nextHouseStreet.trim());
    if (nextArea) parts.push(nextArea);
    if (nextState) parts.push(nextState);
    parts.push("Nigeria");

    if (nextLandmark.trim()) {
      parts.push(`Near ${nextLandmark.trim()}`);
    }

    onChange(parts.filter(Boolean).join(", "));
  }

  useEffect(() => {
    if (locationMethod !== "saved" || !selectedSavedAddress) return;

    const frame = window.requestAnimationFrame(() => {
      let target = null;

      if (/pickup/i.test(title)) {
        const dropoffSection = Array.from(
          document.querySelectorAll(".hokada-address-section")
        ).find((section) =>
          /drop-off address/i.test(
            section.querySelector("h3")?.textContent || ""
          )
        );

        target = dropoffSection?.querySelector("h3");
      } else if (/drop-off/i.test(title)) {
        target = Array.from(document.querySelectorAll(".form-section label"))
          .find((label) =>
            /recipient name/i.test(label.textContent || "")
          );
      }

      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [locationMethod, selectedSavedAddress, title]);

  function clearLocation() {
    setSuggestions([]);
    setSelectedLocation(null);
    setSelectedSavedAddress("");
    setLocationMethod("");
    setError("");
  }

  function chooseSavedAddress(key) {
    setSelectedSavedAddress(key);
    setAreaConfirmed(false);

    if (!key) {
      setSelectedLocation(null);
      setLocationMethod("");
      return;
    }

    const saved = savedAddresses.find((item) => item.key === key);
    if (!saved) return;

    const coords = {
      lat: Number(saved.coords.lat),
      lng: Number(saved.coords.lng),
    };

    setState("");
    setAreaChoice("");
    setCustomArea("");
    setHouseStreet("");
    setLandmark("");
    setSuggestions([]);
    setSelectedLocation({ address: saved.address, coords });
    setLocationMethod("saved");
    setError("");

    onChange(saved.address);
    onSelect({ address: saved.address, coords });
    setShowSavedAddresses(false);


  }

  function handleStateChange(nextState) {
    setState(nextState);
    setAreaConfirmed(false);
    setAreaChoice("");
    setCustomArea("");
    setHouseStreet("");
    setLandmark("");
    clearLocation();

    publishAddress({
      state: nextState,
      areaChoice: "",
      customArea: "",
      houseStreet: "",
      landmark: ""
    });
  }

  function handleAreaChange(nextArea) {
    setAreaChoice(nextArea);
    setAreaConfirmed(false);
    setCustomArea("");
    setHouseStreet("");
    setLandmark("");
    clearLocation();

    publishAddress({
      areaChoice: nextArea,
      customArea: "",
      houseStreet: "",
      landmark: ""
    });
  }

  function handleConfirmArea() {
    if (!state || !area.trim()) return;
    setAreaConfirmed(true);
    setShowAreaSuggestions(false);
    setAreaSuggestions([]);
    setHouseStreet("");
    setLandmark("");
    clearLocation();
    publishAddress({ houseStreet: "", landmark: "" });
  }

  function handleHouseStreetChange(nextValue) {
    setHouseStreet(nextValue);
    clearLocation();
    publishAddress({ houseStreet: nextValue });
  }

  function handleLandmarkChange(nextValue) {
    setLandmark(nextValue);
    publishAddress({ landmark: nextValue });
  }

  function handleCustomAreaChange(nextValue) {
    setCustomArea(nextValue);
    setAreaConfirmed(false);
    setHouseStreet("");
    setLandmark("");
    clearLocation();

    publishAddress({
      customArea: nextValue,
      houseStreet: "",
      landmark: ""
    });
  }

  useEffect(() => {
    const query = customArea.trim();

    if (!state || areaChoice !== "__custom__" || query.length < 2 || areaConfirmed) {
      setAreaSuggestions([]);
      setAreaSearching(false);
      return undefined;
    }

    const localMatches = (AREAS[state] || [])
      .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
      .filter((name) => name.toLowerCase() !== query.toLowerCase())
      .map((name) => ({ name, detail: `${name}, ${state}` }));

    setAreaSuggestions(localMatches.slice(0, 8));

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setAreaSearching(true);

      try {
        const params = new URLSearchParams({
          q: `${query}, ${state}, Nigeria`,
          format: "json",
          limit: "8",
          countrycodes: "ng",
          addressdetails: "1"
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" }
          }
        );

        if (!response.ok) throw new Error("Area search unavailable");

        const results = await response.json();
        const remote = results.map((item) => {
          const a = item.address || {};
          const name = a.neighbourhood || a.suburb || a.city_district ||
            a.town || a.city || a.village || a.municipality || item.name;
          return name ? { name, detail: item.display_name } : null;
        }).filter(Boolean);

        if (!controller.signal.aborted) {
          const unique = new Map();
          [...localMatches, ...remote].forEach((item) => {
            const key = item.name.toLowerCase();
            if (key !== query.toLowerCase() && !unique.has(key)) {
              unique.set(key, item);
            }
          });
          setAreaSuggestions([...unique.values()].slice(0, 8));
        }
      } catch (err) {
        if (err.name !== "AbortError" && !controller.signal.aborted) {
          setAreaSuggestions(localMatches.slice(0, 8));
        }
      } finally {
        if (!controller.signal.aborted) setAreaSearching(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state, areaChoice, customArea, areaConfirmed]);

  useEffect(() => {
    if (!state || !area || !houseStreet.trim()) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setSearching(true);

      try {
        const query = [
          houseStreet.trim(),
          area,
          state,
          "Nigeria"
        ].join(", ");

        const params = new URLSearchParams({
          q: query,
          format: "json",
          limit: "5",
          countrycodes: "ng",
          addressdetails: "1"
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" }
          }
        );

        if (!response.ok) {
          throw new Error("Address search is temporarily unavailable.");
        }

        const results = await response.json();

        setSuggestions(
          results
            .map((item) => ({
              address: item.display_name,
              lat: Number(item.lat),
              lng: Number(item.lon)
            }))
            .filter(
              (item) =>
                Number.isFinite(item.lat) &&
                Number.isFinite(item.lng)
            )
        );
      } catch (err) {
        if (err.name !== "AbortError") {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 800);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state, area, houseStreet]);

  function chooseSuggestion(suggestion) {
    const coords = {
      lat: suggestion.lat,
      lng: suggestion.lng
    };

    setSelectedLocation({ address: suggestion.address, coords });
    setLocationMethod("map-search");
    setSuggestions([]);
    setError("");

    onChange(suggestion.address);
    onSelect({
      address: suggestion.address,
      coords
    });
  }

  function useCurrentLocation() {
    if (!state || !area || !houseStreet.trim()) {
      setError(
        "Enter your state, area and street address before selecting your location."
      );
      return;
    }

    if (!navigator.geolocation) {
      setError(
        "GPS is not supported by this browser. Select a map search result instead."
      );
      return;
    }

    setLocating(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        setSelectedLocation({
          address: fullAddress,
          coords
        });

        setLocationMethod("gps");
        setSuggestions([]);
        setLocating(false);

        onChange(fullAddress);
        onSelect({
          address: fullAddress,
          coords
        });
      },
      (geoError) => {
        setLocating(false);

        if (geoError.code === 1) {
          setError(
            "Location permission was denied. Allow location access in your browser settings, or choose a map search result."
          );
        } else if (geoError.code === 3) {
          setError(
            "Getting your location took too long. Try again or choose a map search result."
          );
        } else {
          setError(
            "Could not get your GPS location. Check your device location settings and try again."
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  }

  function confirmTypedAddress() {
    if (!state || !area || !houseStreet.trim()) {
      setError("Please complete the required address fields.");
      return;
    }

    if (!selectedLocation) {
      setError(
        "Choose a map search result or use GPS to confirm the location."
      );
      return;
    }

    onChange(selectedLocation.address);
    onSelect({
      address: selectedLocation.address,
      coords: selectedLocation.coords
    });

    setError("");
  }

  return (
    <section className="hokada-address-section">
      <div className="hokada-address-heading">
        <MapPin size={20} aria-hidden="true" />
        <h3>{title}</h3>
      </div>

      {savedAddresses.length > 0 && (
        <div className="hokada-saved-address-picker">
          <button
            type="button"
            className="hokada-saved-address-toggle"
            aria-expanded={showSavedAddresses}
            onClick={() => setShowSavedAddresses((open) => !open)}
          >
            <History size={18} aria-hidden="true" />
            <span>
              {selectedSavedAddress ? "Change saved address" : "Use previous address"}
            </span>
            <ChevronDown
              size={18}
              aria-hidden="true"
              style={{
                marginLeft: "auto",
                transform: showSavedAddresses ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 180ms ease"
              }}
            />
          </button>

          {showSavedAddresses && (
            <div className="hokada-saved-address-list">
              {savedAddresses.map((item) => (
                <div className="hokada-saved-address-row" key={item.key}>
                  <button
                    type="button"
                    className="hokada-saved-address-option"
                    onClick={() => chooseSavedAddress(item.key)}
                  >
                    <MapPin size={17} aria-hidden="true" />
                    <span>{item.address}</span>
                    {selectedSavedAddress === item.key && (
                      <CheckCircle2 size={18} aria-label="Selected" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="hokada-saved-address-delete"
                    aria-label={`Delete saved address ${item.address}`}
                    title="Delete saved address"
                    onClick={() => onDeleteSavedAddress(item)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="hokada-saved-address-new"
                onClick={() => {
                  chooseSavedAddress("");
                  setShowSavedAddresses(false);
                }}
              >
                Enter a new address
              </button>
            </div>
          )}
        </div>
      )}

      {locationMethod === "saved" && selectedSavedAddress && (
        <div className="hokada-selected-saved-address" aria-live="polite">
          <MapPin size={18} aria-hidden="true" />
          <div>
            <strong>Selected address</strong>
            <p>
              {savedAddresses.find((item) => item.key === selectedSavedAddress)?.address || value}
            </p>
          </div>
        </div>
      )}

      {locationMethod !== "saved" && (
      <div className="hokada-address-fields">
        <label className="hokada-address-field">
          <span>1. State</span>
          <select
            value={state}
            onChange={(event) => handleStateChange(event.target.value)}
            autoComplete="address-level1"
          >
            <option value="">Choose your state</option>
            {STATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        {showArea && !areaConfirmed && (
          <div className="hokada-address-field hokada-area-autocomplete">
            <label htmlFor="hokada-area-input">
              <span>2. Area / Neighbourhood</span>
            </label>
            <input
              id="hokada-area-input"
              type="text"
              value={customArea}
              onFocus={() => setShowAreaSuggestions(true)}
              onChange={(event) => {
                const typed = event.target.value;
                setAreaChoice("__custom__");
                setCustomArea(typed);
                setAreaConfirmed(false);
                setShowAreaSuggestions(true);
                setHouseStreet("");
                setLandmark("");
                clearLocation();
                publishAddress({
                  areaChoice: "__custom__",
                  customArea: typed,
                  houseStreet: "",
                  landmark: ""
                });
              }}
              placeholder="Type your area, e.g. Ikotun or Bakare"
              autoComplete="address-level3"
            />

            {showAreaSuggestions && customArea.trim().length >= 2 && (
              <div className="hokada-place-suggestions hokada-area-suggestions">
                <button
                  type="button"
                  className="hokada-place-suggestion"
                  onClick={() => {
                    setCustomArea(customArea.trim());
                    setAreaChoice("__custom__");
                    setShowAreaSuggestions(false);
                    setAreaSuggestions([]);
                  }}
                >
                  <MapPin size={16} aria-hidden="true" />
                  <span>
                    <strong>Use "{customArea.trim()}"</strong>
                    <small>Keep the area exactly as you typed it</small>
                  </span>
                </button>

                {areaSearching && (
                  <p className="hokada-address-status">
                    <LoaderCircle size={16} className="hokada-spin" />
                    Looking for other matching areas...
                  </p>
                )}

                {areaSuggestions.map((item) => (
                  <button
                    type="button"
                    className="hokada-place-suggestion"
                    key={item.name}
                    onClick={() => {
                      setCustomArea(item.name);
                      setAreaChoice("__custom__");
                      setShowAreaSuggestions(false);
                      setAreaSuggestions([]);
                      setHouseStreet("");
                      setLandmark("");
                      clearLocation();
                      publishAddress({
                        areaChoice: "__custom__",
                        customArea: item.name,
                        houseStreet: "",
                        landmark: ""
                      });
                    }}
                  >
                    <MapPin size={16} aria-hidden="true" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="hokada-address-status">
              Choose a suggestion or keep your own entry. Selecting a
              suggestion is optional.
            </p>
          </div>
        )}

        {areaConfirmed && area && (
          <div className="hokada-confirmed-area" aria-live="polite">
            <span>2. Confirmed area</span>
            <strong>{area}, {state}</strong>
            <button type="button" onClick={() => setAreaConfirmed(false)}>
              Change area
            </button>
          </div>
        )}

        {showArea && area && !areaConfirmed && (
          <button
            type="button"
            className="hokada-address-confirm"
            onClick={handleConfirmArea}
          >
            Confirm area
          </button>
        )}

        {showHouseStreet && (
          <label className="hokada-address-field">
            <span>3. House Number and Street Name</span>
            <input
              type="text"
              value={houseStreet}
              onChange={(event) =>
                handleHouseStreetChange(event.target.value)
              }
              placeholder="e.g. 12 Bakare Street"
              autoComplete="street-address"
            />
          </label>
        )}

        {showLandmark && (
          <label className="hokada-address-field">
            <span>4. Landmark (optional)</span>
            <input
              type="text"
              value={landmark}
              onChange={(event) =>
                handleLandmarkChange(event.target.value)
              }
              placeholder="e.g. Near the filling station"
            />
          </label>
        )}
      </div>
      )}

      {locationMethod !== "saved" && showHouseStreet && houseStreet.trim() && (
        <div className="hokada-address-map-search">
          <div className="hokada-address-search-heading">
            <Search size={16} aria-hidden="true" />
            <span>Choose the actual delivery location</span>
          </div>

          <p className="hokada-address-status">
            Can't find your exact address? You can use GPS if your phone is
            currently at the location.
          </p>

          <button
            type="button"
            className="hokada-place-suggestion"
            onClick={useCurrentLocation}
            disabled={locating}
          >
            {locating ? (
              <LoaderCircle size={18} className="hokada-spin" />
            ) : (
              <LocateFixed size={18} />
            )}
            <span>
              {locating
                ? "Getting your GPS location..."
                : "Use this phone's current location"}
            </span>
          </button>

          {searching && (
            <p className="hokada-address-status">
              <LoaderCircle size={16} className="hokada-spin" />
              Searching for your address...
            </p>
          )}

          {!searching && suggestions.length > 0 && (
            <div className="hokada-place-suggestions">
              {suggestions.map((suggestion, index) => (
                <button
                  type="button"
                  key={`${suggestion.lat}-${suggestion.lng}-${index}`}
                  className="hokada-place-suggestion"
                  onClick={() => chooseSuggestion(suggestion)}
                >
                  <MapPin size={16} />
                  <span>{suggestion.address}</span>
                </button>
              ))}
            </div>
          )}

          {!searching &&
            houseStreet.trim() &&
            suggestions.length === 0 &&
            !selectedLocation && (
              <p className="hokada-address-status">
                No matching address found? That's okay. Use GPS at the
                actual location or try a different street description.
              </p>
            )}

          {selectedLocation && (
            <p className="hokada-address-status hokada-address-success">
              <CheckCircle2 size={16} />
              {locationMethod === "gps"
                ? "GPS location captured"
                : "Map search location selected"}
            </p>
          )}
        </div>
      )}

      <div className="hokada-address-summary">
        <strong>Full address preview</strong>
        <p>
          {fullAddress === "Nigeria"
            ? "Your full address will appear here as you fill in the fields."
            : fullAddress}
        </p>
      </div>

      {error && (
        <p className="hokada-address-error" role="alert">
          {error}
        </p>
      )}

      {showHouseStreet && houseStreet.trim() && (
        <button
          type="button"
          className="hokada-address-confirm"
          onClick={confirmTypedAddress}
          disabled={!selectedLocation || locating}
        >
          <CheckCircle2 size={18} />
          Confirm address
        </button>
      )}
    </section>
  );
}
