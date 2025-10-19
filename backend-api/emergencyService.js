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

module.exports = { findNearbyServices, findNearbyServiceLists };
