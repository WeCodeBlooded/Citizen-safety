const axios = require("axios");

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function findClosest(originLat, originLon, serviceList) {
  if (!serviceList || serviceList.length === 0) {
    return null;
  }

  let closest = null;
  let minDistance = Infinity;

  for (const service of serviceList) {
    const distance = getDistance(
      originLat,
      originLon,
      service.lat,
      service.lon
    );
    if (distance < minDistance) {
      minDistance = distance;
      closest = service;
    }
  }

  if (closest) {
    closest.distance_km = minDistance.toFixed(2);
  }

  return closest;
}


const buildOverpassQuery = (latitude, longitude, radiusInMeters, amenities) => {
  const amenityQueries = amenities
    .map(
      (amenity) =>
        `node["amenity"="${amenity}"](around:${radiusInMeters},${latitude},${longitude});`
    )
    .join("\n");
  const query = `[out:json];( ${amenityQueries} ); out body;`;
  return query;
};


const findNearbyServices = async (latitude, longitude) => {
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const searchRadius = 10000; 
  const servicesToFind = {
    hospitals: "hospital",
    policeStations: "police",
    fireStations: "fire_station",
  };

  const query = buildOverpassQuery(
    latitude,
    longitude,
    searchRadius,
    Object.values(servicesToFind)
  );

  try {
    const response = await axios.post(OVERPASS_URL, query, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const allFoundServices = {
      hospital: [],
      police: [],
      fire_station: [],
    };

    if (response.data && response.data.elements) {
      response.data.elements.forEach((element) => {
        const service = {
          name: element.tags.name || "N/A",
          lat: element.lat,
          lon: element.lon,
        };
        const amenityType = element.tags.amenity;
        if (allFoundServices[amenityType]) {
          allFoundServices[amenityType].push(service);
        }
      });
    }

    
    const closestServices = {
      closestHospital: findClosest(
        latitude,
        longitude,
        allFoundServices.hospital
      ),
      closestPoliceStation: findClosest(
        latitude,
        longitude,
        allFoundServices.police
      ),
      closestFireStation: findClosest(
        latitude,
        longitude,
        allFoundServices.fire_station
      ),
    };
    
    if (closestServices.closestHospital) {
      if (!closestServices.closestHospital.name || closestServices.closestHospital.name === 'N/A') {
        closestServices.closestHospital.name = 'Hospital';
      }
    }
    if (closestServices.closestPoliceStation) {
      if (!closestServices.closestPoliceStation.name || closestServices.closestPoliceStation.name === 'N/A') {
        closestServices.closestPoliceStation.name = 'Police Station';
      }
    }
    if (closestServices.closestFireStation) {
      if (!closestServices.closestFireStation.name || closestServices.closestFireStation.name === 'N/A') {
        closestServices.closestFireStation.name = 'Fire Station';
      }
    }

    return closestServices;
  } catch (error) {
    console.error("Error querying Overpass API:", error.message);
    return null;
  }
};


const findNearbyServiceLists = async (latitude, longitude) => {
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const searchRadius = 10000;
  const query = buildOverpassQuery(
    latitude,
    longitude,
    searchRadius,
    ["hospital", "police", "fire_station"]
  );
  try {
    const response = await axios.post(OVERPASS_URL, query, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const lists = { hospital: [], police: [], fire_station: [] };
    if (response.data && response.data.elements) {
      response.data.elements.forEach(el => {
        const amenityType = el.tags.amenity;
        if (lists[amenityType]) {
          lists[amenityType].push({
            name: el.tags.name || (amenityType === 'hospital' ? 'Hospital' : amenityType === 'police' ? 'Police Station' : 'Fire Station'),
            lat: el.lat,
            lon: el.lon
          });
        }
      });
    }
    
    lists.hospital.forEach(s => { if (!s.name || s.name === 'N/A') s.name = 'Hospital'; });
    lists.police.forEach(s => { if (!s.name || s.name === 'N/A') s.name = 'Police Station'; });
    lists.fire_station.forEach(s => { if (!s.name || s.name === 'N/A') s.name = 'Fire Station'; });
    return lists;
  } catch (e) {
    console.error('Error querying Overpass API (lists):', e.message);
    return { hospital: [], police: [], fire_station: [] };
  }
};

// Extended: Nearby Assistance (embassy, police, taxi, medical, heritage)
const buildAssistanceQuery = (latitude, longitude, radiusInMeters) => {
  const lat = latitude;
  const lon = longitude;
  const r = radiusInMeters;
  return `[
    out:json
  ];
  (
    node["amenity"="police"](around:${r},${lat},${lon});
    node["amenity"~"hospital|clinic|doctors|pharmacy"](around:${r},${lat},${lon});
    node["amenity"="taxi"](around:${r},${lat},${lon});
    node["diplomatic"~"embassy|consulate"](around:${r},${lat},${lon});
    node["office"="diplomatic"](around:${r},${lat},${lon});
    node["tourism"="attraction"](around:${r},${lat},${lon});
    node["historic"](around:${r},${lat},${lon});
  );
  out body;`;
};

async function findNearbyAssistanceLists(latitude, longitude, radiusMeters = 7000, limitPerCategory = 20) {
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const query = buildAssistanceQuery(latitude, longitude, radiusMeters);
  try {
    const response = await axios.post(OVERPASS_URL, query, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 12000,
    });
    const byCategory = { embassy: [], police: [], taxi: [], medical: [], heritage: [] };
    const elems = (response.data && response.data.elements) || [];
    for (const el of elems) {
      const tags = el.tags || {};
      const entry = {
        name: tags.name || tags["official_name"] || null,
        lat: el.lat,
        lon: el.lon,
        address: tags["addr:full"] || null,
        amenity: tags.amenity || null,
        tourism: tags.tourism || null,
        historic: tags.historic || null,
        diplomatic: tags.diplomatic || null,
        office: tags.office || null,
      };
      // Compute distance (km) and meters
      const dkm = getDistance(latitude, longitude, el.lat, el.lon);
      entry.distance_km = Number(dkm.toFixed(2));
      entry.distance_m = Math.round(dkm * 1000);

      const amenity = (tags.amenity || '').toLowerCase();
      const tourism = (tags.tourism || '').toLowerCase();
      const historic = (tags.historic || '').toLowerCase();
      const diplomatic = (tags.diplomatic || '').toLowerCase();
      const office = (tags.office || '').toLowerCase();
      const name = (tags.name || '').toLowerCase();

      if (amenity === 'police') {
        if (!entry.name) entry.name = 'Police Station';
        byCategory.police.push(entry);
        continue;
      }
      if (amenity === 'taxi') {
        if (!entry.name) entry.name = 'Taxi Stand';
        byCategory.taxi.push(entry);
        continue;
      }
      if (/^(hospital|clinic|doctors|pharmacy)$/.test(amenity)) {
        if (!entry.name) entry.name = amenity === 'pharmacy' ? 'Pharmacy' : (amenity === 'clinic' ? 'Clinic' : 'Hospital');
        byCategory.medical.push(entry);
        continue;
      }

      const isEmbassy = diplomatic === 'embassy' || diplomatic === 'consulate' || office === 'diplomatic' || /\bembassy\b|\bconsulate\b/.test(name);
      if (isEmbassy) {
        if (!entry.name) entry.name = diplomatic ? diplomatic.charAt(0).toUpperCase() + diplomatic.slice(1) : 'Embassy';
        byCategory.embassy.push(entry);
        continue;
      }

      const isHeritage = tourism === 'attraction' || !!historic || (tags.heritage != null);
      if (isHeritage) {
        if (!entry.name) entry.name = tourism === 'attraction' ? 'Attraction' : (historic ? `Historic: ${historic}` : 'Heritage Site');
        byCategory.heritage.push(entry);
        continue;
      }
    }

    // Sort and trim each category
    Object.keys(byCategory).forEach((k) => {
      byCategory[k].sort((a, b) => (a.distance_m || 0) - (b.distance_m || 0));
      byCategory[k] = byCategory[k].slice(0, limitPerCategory);
    });

    return byCategory;
  } catch (e) {
    console.error('Error querying Overpass API (assistance):', e.message);
    return { embassy: [], police: [], taxi: [], medical: [], heritage: [] };
  }
}

module.exports = { findNearbyServices, findNearbyServiceLists, findNearbyAssistanceLists };
