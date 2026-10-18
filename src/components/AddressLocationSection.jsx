import { useEffect, useMemo, useState } from "react";
import { MapPin, Search, LoaderCircle, CheckCircle2 } from "lucide-react";

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
    "Orile", "Oshodi", "Surulere", "Victoria Island",
    "Yaba"
  ],
  Ogun: [
    "Abeokuta", "Agbara", "Ijebu Ode", "Mowe",
    "Odogbolu", "Ota", "Sagamu"
  ],
  Oyo: [
    "Ibadan", "Ogbomoso", "Oyo", "Iseyin"
  ],
  FCT: [
    "Abuja Municipal", "Gwagwalada", "Kuje",
    "Kubwa", "Lugbe", "Nyanya"
  ]
};

export default function AddressLocationSection({
  title = "Pickup Address",
  value = "",
  onChange = () => {},
  onSelect = () => {}
}) {
  const [state, setState] = useState("");
  const [areaChoice, setAreaChoice] = useState("");
  const [customArea, setCustomArea] = useState("");
  const [houseStreet, setHouseStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [error, setError] = useState("");

  const area = areaChoice === "__custom__" ? customArea.trim() : areaChoice;

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
  const showHouseStreet = Boolean(state && area);
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

  function handleStateChange(nextState) {
    setState(nextState);
    setAreaChoice("");
    setCustomArea("");
    setHouseStreet("");
    setLandmark("");
    setSuggestions([]);
    setSelectedLocation(null);
    setError("");

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
    setCustomArea("");
    setHouseStreet("");
    setLandmark("");
    setSuggestions([]);
    setSelectedLocation(null);
    setError("");

    publishAddress({
      areaChoice: nextArea,
      customArea: "",
      houseStreet: "",
      landmark: ""
    });
  }

  function handleHouseStreetChange(nextValue) {
    setHouseStreet(nextValue);
    setSuggestions([]);
    setSelectedLocation(null);
    setError("");

    publishAddress({ houseStreet: nextValue });
  }

  function handleLandmarkChange(nextValue) {
    setLandmark(nextValue);
    publishAddress({ landmark: nextValue });
  }

  useEffect(() => {
    if (!state || !area || !houseStreet.trim()) {
      setSuggestions([]);
      setSearching(false);
      return;
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
        ].filter(Boolean).join(", ");

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
          throw new Error("Address search failed.");
        }

        const results = await response.json();

        setSuggestions(
          results.map((item) => ({
            address: item.display_name,
            lat: Number(item.lat),
            lng: Number(item.lon)
          }))
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
    }, 700);

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
    setSuggestions([]);
    setError("");

    onChange(fullAddress);
    onSelect({
      address: fullAddress,
      coords
    });
  }

  function confirmTypedAddress() {
    if (!state || !area || !houseStreet.trim()) {
      setError("Please complete the required address fields.");
      return;
    }

    if (!selectedLocation) {
      setError(
        "Select a suggested map location to confirm the coordinates. " +
        "Your address text is still saved, but its map position is not verified."
      );
      return;
    }

    onSelect({
      address: fullAddress,
      coords: selectedLocation.coords
    });
  }

  return (
    <section className="hokada-address-section">
      <div className="hokada-address-heading">
        <MapPin size={20} aria-hidden="true" />
        <h3>{title}</h3>
      </div>

      <div className="hokada-address-fields">
        <label className="hokada-address-field">
          <span>1. State</span>
          <select
            value={state}
            onChange={(event) => handleStateChange(event.target.value)}
          >
            <option value="">Choose your state</option>
            {STATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        {showArea && (
          <label className="hokada-address-field">
            <span>2. Area / Neighbourhood</span>
            <select
              value={areaChoice}
              onChange={(event) => handleAreaChange(event.target.value)}
            >
              <option value="">Choose your area</option>

              {(AREAS[state] || []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}

              <option value="__custom__">
                Can't find my area — type it
              </option>
            </select>
          </label>
        )}

        {showArea && areaChoice === "__custom__" && (
          <label className="hokada-address-field">
            <span>Enter your area / neighbourhood</span>
            <input
              type="text"
              value={customArea}
              onChange={(event) => {
                setCustomArea(event.target.value);
                setHouseStreet("");
                setLandmark("");
                setSuggestions([]);
                setSelectedLocation(null);
                publishAddress({
                  customArea: event.target.value,
                  houseStreet: "",
                  landmark: ""
                });
              }}
              placeholder="e.g. Bakare, Ikotun"
              autoComplete="address-level3"
            />
          </label>
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
              onChange={(event) => handleLandmarkChange(event.target.value)}
              placeholder="e.g. Near the filling station"
            />
          </label>
        )}
      </div>

      {showHouseStreet && houseStreet.trim() && (
        <div className="hokada-address-map-search">
          <div className="hokada-address-search-heading">
            <Search size={16} aria-hidden="true" />
            <span>Confirm your location on the map</span>
          </div>

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

          {selectedLocation && (
            <p className="hokada-address-status hokada-address-success">
              <CheckCircle2 size={16} />
              Map location selected
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
          disabled={!selectedLocation}
        >
          <CheckCircle2 size={18} />
          Confirm address
        </button>
      )}
    </section>
  );
}
