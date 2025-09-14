import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL, // e.g. https://api.../api/scheduling
  timeout: 12000,
});

// Inyectar token desde query ?token=... o localStorage
export function attachAuthTokenFromURLOrStorage() {
  const url = new URL(window.location.href);
  const urlToken = url.searchParams.get("token");
  const token = urlToken || localStorage.getItem("jwt");
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    if (urlToken) localStorage.setItem("jwt", urlToken);
  }
}

export interface CalendarEvent {
  id: number;
  title: string;
  start: string; // ISO
  end: string;   // ISO
  estado: string;
  color?: string;
  ticket_external_id: string;
  worker: {
    id: number;
    nombre: string;
    color_hex?: string;
  };
}

export async function fetchWorkerEvents(workerId: number, from?: string, to?: string) {
  const params: Record<string,string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await api.get<CalendarEvent[]>(`/calendar/worker/${workerId}/`, { params });
  return data;
}

export async function fetchGlobalEvents(from?: string, to?: string) {
  const params: Record<string,string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await api.get<CalendarEvent[]>(`/calendar/global/`, { params });
  return data;
}

export default api;