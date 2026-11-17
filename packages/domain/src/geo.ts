/**
 * Approximate centres of India's larger cities, for finding the city (and state) from a phone's location.
 * Offline on purpose: no map service is called. A city that isn't here is still chosen or typed by hand.
 */
import { INDIA } from './india.js';

export const CITY_CENTRES: Record<string, [number, number]> = {
  Mumbai: [19.076, 72.8777], 'Navi Mumbai': [19.033, 73.0297], Thane: [19.2183, 72.9781], Pune: [18.5204, 73.8567], Nagpur: [21.1458, 79.0882],
  Nashik: [19.9975, 73.7898], Aurangabad: [19.8762, 75.3433], Kolhapur: [16.705, 74.2433], Solapur: [17.6599, 75.9064],
  Delhi: [28.6139, 77.209], 'New Delhi': [28.6139, 77.209], Gurugram: [28.4595, 77.0266], Noida: [28.5355, 77.391], Faridabad: [28.4089, 77.3178], Ghaziabad: [28.6692, 77.4538],
  Bengaluru: [12.9716, 77.5946], Mysuru: [12.2958, 76.6394], Mangaluru: [12.9141, 74.856], 'Hubballi': [15.3647, 75.124],
  Hyderabad: [17.385, 78.4867], Warangal: [17.9689, 79.5941], Chennai: [13.0827, 80.2707], Coimbatore: [11.0168, 76.9558], Madurai: [9.9252, 78.1198],
  Tiruchirappalli: [10.7905, 78.7047], Salem: [11.6643, 78.146], Kolkata: [22.5726, 88.3639], Howrah: [22.5958, 88.2636], Siliguri: [26.7271, 88.3953],
  Ahmedabad: [23.0225, 72.5714], Surat: [21.1702, 72.8311], Vadodara: [22.3072, 73.1812], Rajkot: [22.3039, 70.8022], Gandhinagar: [23.2156, 72.6369],
  Jaipur: [26.9124, 75.7873], Jodhpur: [26.2389, 73.0243], Udaipur: [24.5854, 73.7125], Kota: [25.2138, 75.8648],
  Lucknow: [26.8467, 80.9462], Kanpur: [26.4499, 80.3319], Varanasi: [25.3176, 82.9739], Agra: [27.1767, 78.0081], Prayagraj: [25.4358, 81.8463], Meerut: [28.9845, 77.7064],
  Bhopal: [23.2599, 77.4126], Indore: [22.7196, 75.8577], Gwalior: [26.2183, 78.1828], Jabalpur: [23.1815, 79.9864],
  Patna: [25.5941, 85.1376], Gaya: [24.7955, 85.0002], Ranchi: [23.3441, 85.3096], Jamshedpur: [22.8046, 86.2029], Dhanbad: [23.7957, 86.4304],
  Bhubaneswar: [20.2961, 85.8245], Cuttack: [20.4625, 85.8828], Raipur: [21.2514, 81.6296], Guwahati: [26.1445, 91.7362],
  Chandigarh: [30.7333, 76.7794], Ludhiana: [30.901, 75.8573], Amritsar: [31.634, 74.8723], Jalandhar: [31.326, 75.5762], Mohali: [30.7046, 76.7179],
  Dehradun: [30.3165, 78.0322], Shimla: [31.1048, 77.1734], Srinagar: [34.0837, 74.7973], Jammu: [32.7266, 74.857],
  Thiruvananthapuram: [8.5241, 76.9366], Kochi: [9.9312, 76.2673], Kozhikode: [11.2588, 75.7804], Thrissur: [10.5276, 76.2144],
  Visakhapatnam: [17.6868, 83.2185], Vijayawada: [16.5062, 80.648], Guntur: [16.3067, 80.4365], Tirupati: [13.6288, 79.4192],
  Panaji: [15.4909, 73.8278], Margao: [15.2832, 73.9862], Puducherry: [11.9416, 79.8083]
};
/** Distance in km between two points (haversine). */
export function kmBetween(a: [number, number], b: [number, number]) {
  const r = (d: number) => d * Math.PI / 180, R = 6371;
  const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** The listed city nearest to a location, if one is within `maxKm` (cities whose names are not in INDIA are ignored). */
export function nearestCity(lat: number, lng: number, maxKm = 60): { city: string; state: string; km: number } | null {
  let best: { city: string; state: string; km: number } | null = null;
  for (const [city, c] of Object.entries(CITY_CENTRES)) {
    const state = Object.keys(INDIA).find(s => INDIA[s]!.includes(city)); if (!state) continue;
    const km = kmBetween([lat, lng], c);
    if (!best || km < best.km) best = { city, state, km };
  }
  return best && best.km <= maxKm ? best : null;
}
