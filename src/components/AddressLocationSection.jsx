import { useEffect, useState } from "react";

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi",
  "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
  "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
  "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
  "Sokoto", "Taraba", "Yobe", "Zamfara",
  "Federal Capital Territory (Abuja)",
];

const AREAS = {
  Lagos: [
    "Agege", "Ajah", "Amuwo-Odofin", "Apapa", "Badagry",
    "Bariga", "Egbeda", "Ejigbo", "Epe", "Festac",
    "Gbagada", "Idimu", "Iganmu", "Igando", "Ikeja",
    "Ikorodu", "Ikotun", "Ikoyi", "Ilupeju", "Isolo",
    "Ketu", "Lekki", "Maryland", "Mile 2", "Mushin",
    "Ogba", "Ojodu", "Ojota", "Ojo", "Okota",
    "Oniru", "Orile", "Oshodi", "Satellite Town",
    "Somolu", "Surulere", "Victoria Island", "Yaba",
  ],
  Ogun: [
    "Abeokuta", "Agbara", "Ado-Odo", "Ijebu Ode",
    "Ifo", "Ijoko", "Ikenne", "Ilaro", "Mowe",
    "Odogbolu", "Ota", "Sagamu", "Sango-Ota",
  ],
  Oyo: [
    "Ibadan", "Eruwa", "Igbo-Ora", "Iseyin",
    "Ogbomoso", "Oyo", "Saki",
  ],
  "Federal Capital Territory (Abuja)": [
    "Abuja Central", "Asokoro", "Bwari", "Garki",
    "Gwarinpa", "Jabi", "Kubwa", "Kuje", "Lugbe",
    "Maitama", "Wuse", "Other",
  ],
};

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
  const [state, setState] = useState("Lagos");
  const [areaChoice, setAreaChoice] = useState("");
  const [customArea, setCustomArea] = useState("");
  const [areaSearchStatus, setAreaSearchStatus] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState([]);

  const area = areaChoice === "Other" ? customArea : areaChoice;
  const areaOptions = AREAS[state] || [];

  const fullAddress = [
    house.trim(),
    street.trim(),
    busStop.trim() && `Near ${busStop.trim()}`,
    landmark.trim() && `Landmark: ${landmark.trim()}`,
    area.trim(),
    state,
    "Nigeria",
  ].filter(Boolean).join(", ");

  function publishAddress(nextState, nextArea, nextHouse = house,
    nextStreet = street, nextBusStop = busStop,
    nextLandmark = landmark) {
    const address = [
      nextHouse.trim(),
      nextStreet.trim(),
      nextBusStop.trim() && `Near ${nextBusStop.trim()}`,
      nextLandmark.trim() && `Landmark: ${nextLandmark.trim()}`,
      nextArea.trim(),
      nextState,
      "Nigeria",
    ].filter(Boolean).join(", ");

    onChange(address);
  }

  function updateAddress(setter, nextValue) {
    setter(nextValue);

    const next = {
      house: setter === setHouse ? nextValue : house,
      street: setter === setStreet ? nextValue : street,
      busStop: setter === setBusStop ? nextValue : busStop,
      landmark: setter === setLandmark ? nextValue : landmark,
    };

    publishAddress(
      state,
      area,
      next.house,
      next.street,
      next.busStop,
      next.landmark
    );
    setPlaceSuggestions([]);
    setAreaSearchStatus("");
  }

  function changeState(nextState) {
    setState(nextState);
    setAreaChoice("");
    setCustomArea("");
    setPlaceSuggestions([]);
    setAreaSearchStatus("");
    publishAddress(nextState, "");
  }

  function changeAreaChoice(nextChoice) {
    setAreaChoice(nextChoice);
    setCustomArea("");
    setPlaceSuggestions([]);
    setAreaSearchStatus("");
    publishAddress(state, nextChoice === "Other" ? "" : nextChoice);
  }

  function changeCustomArea(nextArea) {
    setCustomArea(nextArea);
    setPlaceSuggestions([]);
    setAreaSearchStatus("");
    publishAddress(state, nextArea);
  }

  useEffect(() => {
    if (!area.trim() || area.trim().length < 2) {
      setPlaceSuggestions([]);
      setAreaSearchStatus("");
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setAreaSearchStatus("Searching for matching map locations...");

      try {
        const query = [
          house.trim(),
          street.trim(),
          area.trim(),
          state,
          "Nigeria",
        ].filter(Boolean).join(", ");

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

        if (!response.ok) throw new Error("Map search unavailable");

        const data = await response.json();

        const suggestions = (data.features || [])
          .filter((feature) => {
            const point = feature.geometry?.coordinates;
            const props = feature.properties || {};
            const resultState = String(props.state || "").toLowerCase();
            const selectedState = state.toLowerCase();

            return (
              Array.isArray(point) &&
              Number.isFinite(Number(point[0])) &&
              Number.isFinite(Number(point[1])) &&
              (!resultState ||
                resultState.includes(selectedState) ||
                selectedState.includes(resultState))
            );
          })
          .map((feature, index) => {
            const props = feature.properties || {};
            const name = props.name || props.street ||
              props.locality || props.city || "Nearby location";

            const detail = [
              props.district,
              props.locality,
              props.city,
              props.state,
            ].filter(Boolean)
              .filter((item, i, arr) => arr.indexOf(item) === i)
              .join(", ");

            return {
              id: `${name}-${index}`,
              label: name,
              detail,
              lat: Number(feature.geometry.coordinates[1]),
              lng: Number(feature.geometry.coordinates[0]),
            };
          });

        if (cancelled) return;

        setPlaceSuggestions(suggestions);
        setAreaSearchStatus(
          suggestions.length
            ? "Choose a matching map result to confirm delivery coordinates."
            : "No map match found. Your typed address is still available."
        );
      } catch {
        if (!cancelled) {
          setPlaceSuggestions([]);
          setAreaSearchStatus(
            "Map search is unavailable. You can continue entering your address."
          );
        }
      }
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [house, street, area, state]);

  function chooseSuggestion(place) {
    const address = [
      house.trim(),
      street.trim(),
      busStop.trim() && `Near ${busStop.trim()}`,
      landmark.trim() && `Landmark: ${landmark.trim()}`,
      area.trim(),
      state,
      "Nigeria",
    ].filter(Boolean).join(", ");

    onChange(address);
    onSelect({
      address,
      coords: { lat: place.lat, lng: place.lng },
    });

    setPlaceSuggestions([]);
    setAreaSearchStatus(
      "Map location selected. Delivery coordinates have been provided."
    );
  }

  return (
    <section className="form-section hokada-address-section">
      <label className="hokada-address-heading">{title}</label>
      <p className="hokada-address-help">
        Follow the steps below to enter an accurate delivery address.
      </p>

      <div className="hokada-address-fields">
        <label>
          1. State
          <select value={state} onChange={(event) => changeState(event.target.value)}>
            <option value="">Select a state</option>
            {NIGERIAN_STATES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        {state && (
          <label>
            2. Area / neighbourhood
            <select
              value={areaChoice}
              onChange={(event) => changeAreaChoice(event.target.value)}
            >
              <option value="">Select an area</option>
              {areaOptions.filter((item) => item !== "Other").map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
              <option value="Other">Other — I can't find my area</option>
            </select>
          </label>
        )}

        {areaChoice === "Other" && (
          <label>
            Enter your area / neighbourhood
            <input
              value={customArea}
              onChange={(event) => changeCustomArea(event.target.value)}
              placeholder="e.g. Bakare, Iganndo"
              autoComplete="address-level3"
            />
          </label>
        )}

        <label>
          3. House / building number
          <input
            value={house}
            onChange={(event) => updateAddress(setHouse, event.target.value)}
            placeholder="e.g. 12B"
            autoComplete="address-line1"
          />
        </label>

        <label>
          4. Street name
          <input
            value={street}
            onChange={(event) => updateAddress(setStreet, event.target.value)}
            placeholder="e.g. Bakare Street"
            autoComplete="address-line2"
          />
        </label>

        <label>
          Bus stop / nearest junction (optional)
          <input
            value={busStop}
            onChange={(event) => updateAddress(setBusStop, event.target.value)}
            placeholder="e.g. Near Ikotun Roundabout"
          />
        </label>

        <label>
          Landmark (optional)
          <input
            value={landmark}
            onChange={(event) => updateAddress(setLandmark, event.target.value)}
            placeholder="e.g. Opposite a filling station"
          />
        </label>
      </div>

      {area && (
        <div className="hokada-place-suggestions">
          {areaSearchStatus && <small role="status">{areaSearchStatus}</small>}
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

      <div className="hokada-address-summary">
        <strong>Complete address preview</strong>
        <p>{fullAddress || value || "Your complete address will appear here as you fill in the fields."}</p>
      </div>
    </section>
  );
}
