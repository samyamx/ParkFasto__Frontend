import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin,
  Navigation,
  Clock,
  Wallet,
  User as UserIcon,
  Compass,
  Bell,
  Menu,
  Settings,
  HelpCircle,
  Car,
  Crosshair,
  X,
} from 'lucide-react';
import ActionSearchBar from '../components/ActionSearchBar';
import { useAuth } from '../context/AuthContext';
import { useLocationContext } from '../context/LocationContext';
import { useToast } from '../context/ToastContext';
import { useNavigate, Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-routing-machine';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import 'leaflet/dist/leaflet.css';
import '../styles/Dashboard.css';

// Fix for default Leaflet marker icons in React
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

/**
 * Haversine Formula for Distance Calculation
 * Calculates the straight-line distance between two GPS coordinates in kilometers.
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Result in km
  return d;
};

// Helper to convert degrees to radians
const deg2rad = (deg) => {
  return deg * (Math.PI / 180);
};

// --- Map Customization Icons ---

// User's current position marker (Blue)
const userIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

// Parking lot location marker (Green = available)
const parkingIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

// Parking lot full marker (Red)
const parkingFullIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const PARKING_IMAGE =
  'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&q=80&w=800';

const MapInstanceCapture = ({ onMapReady }) => {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
    return () => onMapReady(null);
  }, [map, onMapReady]);
  return null;
};

/**
 * RecenterMap Component
 * Automatically moves the map view to the user's current position.
 */
const RecenterMap = ({ position }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !position) return;

    try {
      // Preserve the current zoom level when recentering so user zoom isn't forced.
      const currentZoom = map.getZoom ? map.getZoom() : 15;

      // Only recenter if the new position is meaningfully far from current center (avoid jitter)
      const currentCenter = map.getCenter();
      const newLatLng = L.latLng(position[0], position[1]);
      const distanceMeters = currentCenter ? currentCenter.distanceTo(newLatLng) : Infinity;

        // If the user recently interacted with the map, do not auto-recenter.
        if (map._userInteracted) return;

        if (distanceMeters > 50) { // only recenter if >50 meters away
          map.setView(newLatLng, currentZoom);
        }
    } catch (err) {
      console.error('RecenterMap error', err);
    }
  }, [position, map]);
  return null;
};

/**
 * MapInteractionHandler
 * Attaches DOM listeners to detect user gestures (mouse/touch/wheel/keyboard) and
 * sets a temporary flag on the map to prevent automatic recenters or fitBounds.
 */
const MapInteractionHandler = () => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;

    let timeoutId = null;

    const setUserInteracted = () => {
      try {
        map._userInteracted = true;
        if (timeoutId) clearTimeout(timeoutId);
        // After 30s of no interaction, allow auto actions again
        timeoutId = setTimeout(() => { map._userInteracted = false; timeoutId = null; }, 30000);
      } catch (e) {
        console.error('Interaction handler error', e);
      }
    };

    const container = map.getContainer();
    container.addEventListener('mousedown', setUserInteracted);
    container.addEventListener('touchstart', setUserInteracted);
    container.addEventListener('wheel', setUserInteracted);
    window.addEventListener('keydown', setUserInteracted);

    return () => {
      container.removeEventListener('mousedown', setUserInteracted);
      container.removeEventListener('touchstart', setUserInteracted);
      container.removeEventListener('wheel', setUserInteracted);
      window.removeEventListener('keydown', setUserInteracted);
      if (timeoutId) clearTimeout(timeoutId);
      map._userInteracted = false;
    };
  }, [map]);
  return null;
};

/**
 * RoutingMachine Component (fastest-route using Google Directions, fallback to OSRM)
 * Prefers the route with the lowest duration (fastest) as Google Maps chooses.
 */
const RoutingMachine = ({ userLoc, destinationLoc }) => {
  const map = useMap();

  // Decode an encoded polyline (Google polyline algorithm) to an array of [lat, lon]
  const decodePolyline = (encoded) => {
    if (!encoded) return [];
    const points = [];
    let index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += deltaLat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const deltaLon = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += deltaLon;

      points.push([lat / 1e5, lng / 1e5]);
    }

    return points;
  };

  useEffect(() => {
    if (!map || !userLoc || !destinationLoc) return;

    const [uLat, uLon] = userLoc;
    const [dLat, dLon] = destinationLoc;

    const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    // Clear any existing route layer before drawing a new one
    if (map._activeRouteLayer) {
      map.removeLayer(map._activeRouteLayer);
      map._activeRouteLayer = null;
    }

    const drawGeoPoints = (points) => {
      // Clear any existing route first
      if (map._activeRouteLayer) {
        map.removeLayer(map._activeRouteLayer);
        map._activeRouteLayer = null;
      }
      map._activeRouteLayer = L.polyline(points, { color: '#6366f1', weight: 6, opacity: 0.95 }).addTo(map);
      const bounds = map._activeRouteLayer.getBounds();
        if (bounds.isValid() && !map._userInteracted) map.fitBounds(bounds.pad(0.15));
    };

    const fetchGoogleAndDraw = async () => {
      try {
        if (!GOOGLE_KEY) return false;
        // Google Directions REST API expects origin and destination as lat,lng
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${uLat},${uLon}&destination=${dLat},${dLon}&alternatives=true&mode=driving&key=${GOOGLE_KEY}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data || data.status !== 'OK' || !data.routes || data.routes.length === 0) {
          console.warn('Google Directions unavailable or returned no routes', data?.status);
          return false;
        }

        // Choose route with smallest duration (fastest)
        let fastest = data.routes[0];
        for (const r of data.routes) {
          const rDur = r.legs.reduce((s, leg) => s + (leg.duration?.value || 0), 0);
          const fDur = fastest.legs.reduce((s, leg) => s + (leg.duration?.value || 0), 0);
          if (rDur < fDur) fastest = r;
        }

        // Decode polyline to lat,lng pairs
        const encoded = fastest.overview_polyline?.points;
        const latlngs = decodePolyline(encoded);
        drawGeoPoints(latlngs);
        return true;
      } catch (err) {
        console.error('Google routing error', err);
        return false;
      }
    };

    const fetchOSRMAndDraw = async () => {
      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${uLon},${uLat};${dLon},${dLat}?alternatives=true&overview=full&geometries=geojson`;
        const res = await fetch(osrmUrl);
        const data = await res.json();
        if (!data || !data.routes || data.routes.length === 0) return false;

        // Choose route with smallest duration (fastest) from OSRM
        let fastest = data.routes[0];
        for (const r of data.routes) {
          if (r.duration < fastest.duration) fastest = r;
        }

        const coords = fastest.geometry.coordinates.map(c => [c[1], c[0]]);
        drawGeoPoints(coords);
        return true;
      } catch (err) {
        console.error('OSRM routing error', err);
        return false;
      }
    };

    (async () => {
      const usedGoogle = await fetchGoogleAndDraw();
      if (!usedGoogle) await fetchOSRMAndDraw();
    })();

    return () => {
      if (map._activeRouteLayer) {
        map.removeLayer(map._activeRouteLayer);
        map._activeRouteLayer = null;
      }
    };
  }, [map, userLoc, destinationLoc]);

  return null;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  // --- State Management ---
  const [isParked, setIsParked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [parkingLots, setParkingLots] = useState([]);
  const [timer, setTimer] = useState('00:00:00');
  const [currentBill, setCurrentBill] = useState(0);
  const { userLocation, trackingEnabled, startTracking } = useLocationContext();
  const handleRequestLocation = startTracking;

  const [mapCenter, setMapCenter] = useState([27.7172, 85.3240]); // Default to Kathmandu
  const [destination, setDestination] = useState(null);
  const [selectedLot, setSelectedLot] = useState(null);
  const [leafletMap, setLeafletMap] = useState(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const searchInputRef = useRef(null);
  const getAvailableSlots = (lot) => Math.max(0, (lot.totalSpots || 0) - (lot.occupiedSpots || 0));
  const getLotDistanceKm = (lot) => {
    if (!lot) return null;
    if (typeof lot.distance === 'number') return lot.distance;
    if (!userLocation) return null;
    return calculateDistance(userLocation[0], userLocation[1], lot.lat, lot.lon);
  };
  const getEstimatedDriveMinutes = (lot) => {
    const distanceKm = getLotDistanceKm(lot);
    if (!distanceKm) return null;
    const avgCitySpeedKmH = 22;
    return Math.max(2, Math.round((distanceKm / avgCitySpeedKmH) * 60));
  };
  const getLotAddress = (lot) => lot?.address || lot?.location || 'Kathmandu, Nepal';
  const isLotOpen = (lot) => lot?.status !== 'full' && getAvailableSlots(lot) > 0;
  const displayLot = selectedLot
    ? parkingLots.find((lot) => lot._id === selectedLot._id) || selectedLot
    : null;

  const handleMapReady = useCallback((map) => {
    setLeafletMap(map);
  }, []);

  const selectLot = (lot, { route = false } = {}) => {
    setSelectedLot(lot);
    setMapCenter([lot.lat, lot.lon]);
    if (route) {
      setDestination([lot.lat, lot.lon]);
      startTracking();
    }
  };

  const fetchNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      setLoadingNotifications(true);
      const res = await fetch('https://parkfasto-backend-2.onrender.com/api/v1/users/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotifications(data.data || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoadingNotifications(false);
    }
  };

  const markAllNotificationsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch('https://parkfasto-backend-2.onrender.com/api/v1/users/notifications/read-all', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark notifications as read:', err);
      showToast('Failed to update notifications', 'error');
    }
  };

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 10000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Logic: Fetch Data from Backend ---
  const fetchData = async (lat, lon) => {
    try {
      // Fetch Parking Lots with location if available
      let url = 'https://parkfasto-backend-2.onrender.com/api/v1/parking/lots';
      if (lat && lon) {
        url += `?lat=${lat}&lon=${lon}`;
      }
      
      const lotsRes = await fetch(url);
      const lotsData = await lotsRes.json();
      if (lotsData.success) {
        let processedLots = lotsData.data;
        
        // If userLocation is available, calculate and inject distance locally
        if (userLocation) {
          processedLots = processedLots.map(lot => ({
            ...lot,
            distance: calculateDistance(userLocation[0], userLocation[1], lot.lat, lot.lon)
          })).sort((a, b) => a.distance - b.distance); // Sort by closest
        }
        
        setParkingLots(processedLots);
      }

      // Fetch Active Session (Requires Auth Token)
      const token = localStorage.getItem('token');
      if (token) {
        const sessionRes = await fetch('https://parkfasto-backend-2.onrender.com/api/v1/parking/active-session', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const sessionData = await sessionRes.json();
        if (sessionData.success && sessionData.data) {
          setActiveSession(sessionData.data);
          setIsParked(true);
        }
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  useEffect(() => {
    fetchData();
   }, []);

  // Live occupancy updates for nearby parking cards
  useEffect(() => {
    const timer = setInterval(() => {
      fetchData(userLocation?.[0], userLocation?.[1]);
    }, 12000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation]);

  // --- Logic: Live Geolocation Tracking ---
  // Use global location context for persistent tracking
 

  // When userLocation changes, refresh lots distances and fetch nearby lots
  useEffect(() => {
    if (!userLocation) return;
    const [lat, lon] = userLocation;
    // Re-calculate distances for existing lots without fetching again
    setParkingLots(prevLots => {
      const updated = prevLots.map(lot => ({
        ...lot,
        distance: calculateDistance(lat, lon, lot.lat, lot.lon)
      })).sort((a, b) => a.distance - b.distance);
      return updated;
    });

    // Fetch nearby lots based on real location
    fetchData(lat, lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation]);

  // --- Logic: Live Parking Timer & Fee ---
  useEffect(() => {
    if (!isParked || !activeSession) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diffInMs = now - new Date(activeSession.startTime);
      
      const hours = Math.floor(diffInMs / (1000 * 60 * 60)).toString().padStart(2, '0');
      const minutes = Math.floor((diffInMs % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
      const seconds = Math.floor((diffInMs % (1000 * 60)) / 1000).toString().padStart(2, '0');
      setTimer(`${hours}:${minutes}:${seconds}`);

      const diffInHours = diffInMs / (1000 * 60 * 60);
      setCurrentBill(Math.ceil(diffInHours * (activeSession.parkingLot?.pricePerHour || 25)));
    }, 1000);

    return () => clearInterval(interval);
  }, [isParked, activeSession]);

  const { user } = useAuth();
  const avatarLetter = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <div className="dashboard-container">

      {/* ── Fixed Top Navbar ── */}
      <header className="dashboard-header">
        <div className="nav-logo">
          <span className="nav-logo-text">ParkFasto</span>
        </div>

        <div className="nav-search-wrap">
          <ActionSearchBar
            inputRef={searchInputRef}
            parkingLots={parkingLots}
            onSelectLot={(lot) => {
              selectLot(lot, { route: true });
            }}
            onSelectPlace={(place) => {
              setMapCenter([place.lat, place.lon]);
              fetchData(place.lat, place.lon);
            }}
            onSearch={async (q) => {
              try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + ', Nepal')}&limit=1`);
                const data = await res.json();
                if (data?.length) {
                  const { lat, lon } = data[0];
                  setMapCenter([parseFloat(lat), parseFloat(lon)]);
                  fetchData(parseFloat(lat), parseFloat(lon));
                } else {
                  showToast('Location not found in Nepal.', 'warning');
                }
              } catch {
                showToast('Search failed. Please try again.', 'error');
              }
            }}
          />
        </div>

        <div className="nav-actions">
          <button
            className="nav-icon-btn nav-icon-btn--notify"
            aria-label="Notifications"
            onClick={async () => {
              const nextState = !notificationOpen;
              setNotificationOpen(nextState);
              if (nextState) {
                await fetchNotifications();
                await markAllNotificationsRead();
              }
            }}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="nav-notify-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
          <button className="nav-icon-btn" aria-label="Settings" onClick={() => navigate('/profile')}>
            <Settings size={20} />
          </button>
          <button className="navbar-profile" onClick={() => navigate('/profile')} aria-label="Profile">
            {avatarLetter}
          </button>
          <button className="menu-btn mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
        </div>
      </header>

      {notificationOpen && (
        <>
          <div className="notification-panel-backdrop" onClick={() => setNotificationOpen(false)} />
          <aside className="notification-panel">
            <div className="notification-panel-header">
              <h4>Notifications</h4>
              <button type="button" onClick={() => setNotificationOpen(false)} aria-label="Close notifications">
                <X size={18} />
              </button>
            </div>
            <div className="notification-panel-body">
              {loadingNotifications ? (
                <p className="notification-empty">Loading notifications...</p>
              ) : notifications.length === 0 ? (
                <p className="notification-empty">No notifications yet.</p>
              ) : (
                notifications.map((item) => (
                  <div key={item._id} className={`notification-item ${item.isRead ? 'read' : 'unread'}`}>
                    <div className="notification-item-title">{item.title}</div>
                    <div className="notification-item-message">{item.message}</div>
                    <div className="notification-item-time">
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      )}

      {/* ── Left Sidebar ── */}
      <div className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-nav-header">
          <div>
            <h2 className="sidebar-nav-label">Navigation</h2>
            <p className="sidebar-nav-sub">Map Dashboard</p>
          </div>
          <button className="close-sidebar mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <Link className="sidebar-nav-item active" to="/dashboard" onClick={() => setSidebarOpen(false)}>
            <Compass size={18} />
            <span>Explore</span>
          </Link>
          <Link className="sidebar-nav-item" to="/history" onClick={() => setSidebarOpen(false)}>
            <Clock size={18} />
            <span>History</span>
          </Link>
          <Link className="sidebar-nav-item" to="/contact" onClick={() => setSidebarOpen(false)}>
            <HelpCircle size={18} />
            <span>Contact</span>
          </Link>
          <Link className="sidebar-nav-item" to="/profile" onClick={() => setSidebarOpen(false)}>
            <UserIcon size={18} />
            <span>Profile</span>
          </Link>
        </nav>

        <div className="sidebar-footer">
          <div className="storage-widget">
            <p className="storage-label">{isParked ? 'ACTIVE SESSION' : 'STORAGE STATUS'}</p>
            <div className="storage-bar-track">
              <div
                className="storage-bar-fill"
                style={{ width: isParked ? '65%' : '62%' }}
              />
            </div>
            <p className="storage-info">
              {isParked
                ? `${timer} · NPR ${currentBill} billed`
                : '6.2 GB of 10 GB used'}
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main Map Area ── */}
      <main className="map-main">
        {/* Map Section */}
        <div className="map-section">
          {!trackingEnabled ? (
            <div className="map-placeholder request-location">
              <div className="location-prompt">
                <MapPin size={48} color="#adc6ff" />
                <h3>Live Map Tracking</h3>
                <p>Allow access to your location to find nearby parking and track your movement live.</p>
                <button className="enable-location-btn" onClick={handleRequestLocation}>
                  Enable Live Tracking
                </button>
              </div>
            </div>
          ) : (
            <div className="map-wrapper">
              <MapContainer
                center={mapCenter}
                zoom={15}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                <MapInstanceCapture onMapReady={handleMapReady} />
                <RecenterMap position={mapCenter} />
                <MapInteractionHandler />
                {userLocation && destination && <RoutingMachine userLoc={userLocation} destinationLoc={destination} />}
                {userLocation && <Marker position={userLocation} icon={userIcon}><Popup>You are here (Live)</Popup></Marker>}
                {parkingLots.map(lot => (
                  <Marker
                    key={lot._id}
                    position={[lot.lat, lot.lon]}
                    icon={lot.status === 'full' ? parkingFullIcon : parkingIcon}
                    eventHandlers={{
                      click: () => selectLot(lot),
                    }}
                  >
                    <Popup>
                      <div className="map-popup-content">
                        <strong className="popup-title">{lot.name}</strong>
                        <div className="popup-details">
                          <div className="popup-detail-item"><span className="detail-label">Type:</span><span className="detail-value">{(lot.type || 'BOTH').toUpperCase()}</span></div>
                          <div className="popup-detail-item"><span className="detail-label">Price:</span><span className="detail-value">NPR {lot.pricePerHour}/hr</span></div>
                          <div className="popup-detail-item"><span className="detail-label">Occupancy:</span><span className="detail-value">{lot.occupiedSpots || 0}/{lot.totalSpots || 0}</span></div>
                        </div>
                        <div className="popup-occupancy-bar">
                          <div className="popup-occupancy-fill" style={{ width: `${Math.min(100, ((lot.occupiedSpots || 0) / (lot.totalSpots || 1)) * 100)}%`, backgroundColor: ((lot.occupiedSpots || 0) / (lot.totalSpots || 1)) > 0.9 ? '#ef4444' : '#6366f1' }}></div>
                        </div>
                        <button className="get-directions-btn" onClick={() => selectLot(lot, { route: true })}>
                          Get Directions
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
        </div>

        {displayLot && (
          <aside className="parking-detail-card">
            <button
              type="button"
              className="parking-detail-close"
              aria-label="Close parking details"
              onClick={() => {
                setSelectedLot(null);
                setDestination(null);
              }}
            >
              <X size={16} />
            </button>
            <div className="parking-detail-image-wrap">
              <img src={PARKING_IMAGE} alt={displayLot.name} />
            </div>
            <div className="parking-detail-body">
              <div className="parking-detail-head">
                <h2>{displayLot.name}</h2>
                <span className={`parking-status-badge ${isLotOpen(displayLot) ? 'open' : 'closed'}`}>
                  {isLotOpen(displayLot) ? 'OPEN' : 'FULL'}
                </span>
              </div>
              <p className="parking-detail-address">{getLotAddress(displayLot)}</p>
              <div className="parking-detail-stats">
                <div className="parking-stat-box">
                  <span className="parking-stat-label">Available</span>
                  <span className="parking-stat-value">
                    <strong>{getAvailableSlots(displayLot)}</strong>
                    <span> / {displayLot.totalSpots || 0}</span>
                  </span>
                </div>
                <div className="parking-stat-box">
                  <span className="parking-stat-label">Rate</span>
                  <span className="parking-stat-value">Rs. {displayLot.pricePerHour} /hr</span>
                </div>
              </div>
              {getLotDistanceKm(displayLot) && (
                <p className="parking-detail-meta">
                  {getLotDistanceKm(displayLot).toFixed(2)} km away
                  {getEstimatedDriveMinutes(displayLot) ? ` · ~${getEstimatedDriveMinutes(displayLot)} min drive` : ''}
                </p>
              )}
              <div className="parking-detail-actions">
                <button
                  type="button"
                  className="directions-link-btn"
                  onClick={() => selectLot(displayLot, { route: true })}
                >
                  <Navigation size={16} />
                  Get Directions
                </button>
                <button
                  type="button"
                  className="book-parking-btn"
                  disabled={!isLotOpen(displayLot)}
                  onClick={() => navigate(`/parking/lot/${displayLot._id}`, {
                    state: { lot: displayLot, distance: getLotDistanceKm(displayLot) },
                  })}
                >
                  <Car size={18} />
                  {isLotOpen(displayLot) ? 'Book Parking Space' : 'No Vacancy'}
                </button>
              </div>
            </div>
          </aside>
        )}

        <div className="map-controls">
          <button
            type="button"
            className="map-ctrl-btn"
            title="Zoom in"
            onClick={() => leafletMap?.zoomIn()}
          >
            +
          </button>
          <button
            type="button"
            className="map-ctrl-btn"
            title="Zoom out"
            onClick={() => leafletMap?.zoomOut()}
          >
            −
          </button>
          <button
            type="button"
            className="map-ctrl-btn map-ctrl-location"
            title="My location"
            onClick={() => {
              if (userLocation) setMapCenter([...userLocation]);
              else handleRequestLocation();
            }}
          >
            <Crosshair size={18} />
          </button>
        </div>

        {/* Map legend */}
        <div className="map-legend">
          <h3 className="map-legend-title">Map Legend</h3>
          <div className="map-legend-items">
            <div className="map-legend-item"><span className="legend-dot available"></span><span>Available Parking</span></div>
            <div className="map-legend-item"><span className="legend-dot full"></span><span>No Vacancy</span></div>
            <div className="map-legend-item"><span className="legend-dot current"></span><span>Current Location</span></div>
          </div>
        </div>

        {/* Active session card */}
        {isParked && (
          <div className="active-session-card">
            <div className="session-info">
              <div className="session-header">
                <span className="live-dot"></span>
                <h3>Active Parking</h3>
              </div>
              <div className="session-details">
                <div className="detail-item"><Clock size={15} /><span>{timer}</span></div>
                <div className="detail-item"><MapPin size={15} /><span>{activeSession.parkingLot?.name || 'Active Spot'}</span></div>
                <div className="detail-item bill"><Wallet size={15} /><span>NPR {currentBill}</span></div>
              </div>
            </div>
            <button className="checkout-btn" onClick={() => setIsParked(false)}>Check Out</button>
          </div>
        )}
      </main>
    </div>
  );
};



export default Dashboard;
