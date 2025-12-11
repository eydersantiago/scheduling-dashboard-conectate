import React, { useEffect, useMemo, useState } from "react";
import { Calendar } from "@fullcalendar/core";
import type { EventClickArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { fetchGlobalEvents } from "../lib/api";
import "../styles/calendar.css";

type ViewMode = "day" | "week" | "month";

interface Props {
  mode: ViewMode;
  dateISO?: string;
  workerId?: number; // no se usa para URL
}

type FCEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  backgroundColor?: string;
  borderColor?: string;
  extendedProps: {
    estado?: string;
    ticket_external_id?: string | number;
    worker?: {
      id?: number;
      nombre?: string; // español
      name?: string;   // fallback inglés
      color_hex?: string;
    };
    worker_name?: string; // otros backends
  };
};

// Quitar tildes y normalizar a minúsculas
const norm = (s: string) =>
  s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";

// Si no viene en extendedProps, extraer "Nombre" desde el title: "xxxx – Nombre"
const parseNameFromTitle = (title: string): string => {
  if (!title) return "";
  // Busca desde el final con separadores comunes: em dash (—), en dash (–), guion (-)
  const seps = [" — ", " – ", " - ", "—", "–", "-"];
  for (const sep of seps) {
    const i = title.lastIndexOf(sep);
    if (i >= 0) return title.slice(i + sep.length).trim();
  }
  // regex de respaldo
  const m = title.match(/[-–—]\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ.\s]+)$/);
  return m ? m[1].trim() : "";
};

// Nombre robusto del trabajador (extendedProps o title)
const getWorkerName = (e: FCEvent): string => {
  return (
    e.extendedProps.worker?.nombre ??
    e.extendedProps.worker?.name ??
    (e.extendedProps as any).worker_name ??
    parseNameFromTitle(e.title) ??
    ""
  ).toString().trim();
};

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

const CalendarView: React.FC<Props> = ({ mode, dateISO }) => {
  const calendarRef = React.useRef<HTMLDivElement | null>(null);
  const [cal, setCal] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile(768);

  // Sidebar móvil
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = () => setSidebarOpen((s) => !s);
  const closeSidebar = () => setSidebarOpen(false);

  // Datos
  const [rawEvents, setRawEvents] = useState<FCEvent[]>([]);
  const [workerNames, setWorkerNames] = useState<string[]>([]);

  // Filtros (cliente, sin tocar URL)
  const [workerQuery, setWorkerQuery] = useState<string>("");  // texto libre
  const [selectedName, setSelectedName] = useState<string>(""); // selección exacta

  // Vista inicial
  const initialView = useMemo(() => {
    if (isMobile) return "listWeek";
    if (mode === "day") return "timeGridDay";
    if (mode === "week") return "timeGridWeek";
    return "dayGridMonth";
  }, [mode, isMobile]);

  // Header nativo: desktop con botones; móvil sin ellos
  const headerToolbar = useMemo(
    () =>
      isMobile
        ? { left: "prev,next today", center: "title", right: "" }
        : {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          },
    [isMobile]
  );

  // Render inicial
  useEffect(() => {
    if (!calendarRef.current) return;

    const calendar = new Calendar(calendarRef.current, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],
      initialView,
      initialDate: dateISO,
      headerToolbar,
      slotMinTime: "08:00:00",
      slotMaxTime: "18:30:00",
      nowIndicator: true,
      selectable: false,
      weekends: true,
      eventClick: (arg: EventClickArg) => {
        const extId = (arg.event.extendedProps as any)["ticket_external_id"];
        alert(`Ticket ${extId}\n${arg.event.title}\n${arg.event.start} - ${arg.event.end}`);
      },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", meridiem: false },
      displayEventEnd: true,
      expandRows: true,
      height: "auto",
    });

    calendar.render();
    setCal(calendar);
    return () => calendar.destroy();
  }, [initialView, dateISO, headerToolbar]);

  // Cambiar vista por rotación/tamaño
  useEffect(() => {
    if (!cal) return;
    const target = isMobile
      ? "listWeek"
      : mode === "day"
      ? "timeGridDay"
      : mode === "week"
      ? "timeGridWeek"
      : "dayGridMonth";
    if (cal.view.type !== target) cal.changeView(target);
  }, [cal, isMobile, mode]);

  // Cargar eventos del rango visible
  useEffect(() => {
    if (!cal) return;
    (async () => {
      try {
        setLoading(true);
        const start = cal.view.currentStart.toISOString().slice(0, 10);
        const end = cal.view.currentEnd.toISOString().slice(0, 10);
        const events = await fetchGlobalEvents(start, end);

        const fcEvents: FCEvent[] = events
          // Mostrar solo estados que deben ir al calendario
          .filter(
            (ev: any) => !["pendiente", "pendiente_reasignar"].includes(ev.estado)
          )
          .map((ev: any) => ({
            id: String(ev.id),
            title: ev.title,
            start: ev.start,
            end: ev.end,
            backgroundColor: ev.color || ev.worker?.color_hex || undefined,
            borderColor: ev.color || ev.worker?.color_hex || undefined,
            extendedProps: {
              estado: ev.estado,
              ticket_external_id: ev.ticket_external_id,
              worker: ev.worker, // puede venir vacío o sin nombre
            },
          }));

        setRawEvents(fcEvents);

        // nombres únicos (de extendedProps o del title)
        const uniq = new Set<string>();
        for (const e of fcEvents) {
          const n = getWorkerName(e);
          if (n) uniq.add(n);
        }
        setWorkerNames(Array.from(uniq).sort((a, b) => a.localeCompare(b)));
      } finally {
        setLoading(false);
      }
    })();
  }, [cal, initialView]);

  // Aplicar filtro por nombre (texto contiene o selección exacta), acento-insensible
  useEffect(() => {
    if (!cal) return;

    const q = norm(workerQuery);
    const sel = norm(selectedName);

    const filtered = rawEvents.filter((e) => {
      const name = norm(getWorkerName(e));
      if (sel) return name === sel;        // selección exacta del combo
      if (q) return name.includes(q);      // texto libre en input
      return true;                         // sin filtro -> todo
    });

    cal.removeAllEvents();
    cal.addEventSource(filtered);
  }, [cal, rawEvents, workerQuery, selectedName]);

  // helpers vistas
  const isActiveView = (type: string) => cal?.view.type === type;
  const goView = (
    type: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek"
  ) => {
    cal?.changeView(type);
    closeSidebar();
  };

  // sincronizar input y select
  const onTypeQuery = (v: string) => {
    setWorkerQuery(v);
    if (selectedName) setSelectedName("");
  };
  const onPickExact = (v: string) => {
    setSelectedName(v);
    if (workerQuery) setWorkerQuery("");
  };

  return (
    <div className="calendar-responsive-wrap">
      {/* Desktop: filtro por trabajador */}
      {!isMobile && (
        <div className="fc-desktop-controls" aria-label="Filtros de calendario">
          <div className="fc-worker-filter">
            <input
              className="fc-worker-input"
              placeholder="Filtrar por trabajador…"
              value={workerQuery}
              onChange={(e) => onTypeQuery(e.target.value)}
            />
            <select
              className="fc-worker-select"
              value={selectedName}
              onChange={(e) => onPickExact(e.target.value)}
            >
              <option value="">(Todos)</option>
              {workerNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Móvil: toggle sidebar */}
      {isMobile && (
        <button
          className="fc-mobile-toggle"
          onClick={toggleSidebar}
          aria-expanded={sidebarOpen}
          aria-controls="fc-mobile-sidebar"
          aria-label="Abrir opciones"
        >
          ☰ Opciones
        </button>
      )}

      {/* Sidebar móvil: vistas + filtro */}
      {isMobile && (
        <aside
          id="fc-mobile-sidebar"
          className={`fc-mobile-sidebar ${sidebarOpen ? "open" : ""}`}
          aria-hidden={!sidebarOpen}
        >
          <div className="fc-mobile-sidebar-header">
            <strong>Opciones</strong>
            <button className="fc-close" onClick={() => setSidebarOpen(false)} aria-label="Cerrar">
              ×
            </button>
          </div>

          <section className="fc-mobile-views">
            <h4>Vistas</h4>
            <div className="fc-mobile-views-row">
              <button
                className={`view-btn ${isActiveView("dayGridMonth") ? "active" : ""}`}
                onClick={() => goView("dayGridMonth")}
              >
                month
              </button>
              <button
                className={`view-btn ${isActiveView("timeGridWeek") ? "active" : ""}`}
                onClick={() => goView("timeGridWeek")}
              >
                week
              </button>
              <button
                className={`view-btn ${isActiveView("timeGridDay") ? "active" : ""}`}
                onClick={() => goView("timeGridDay")}
              >
                day
              </button>
              <button
                className={`view-btn ${isActiveView("listWeek") ? "active" : ""}`}
                onClick={() => goView("listWeek")}
              >
                list
              </button>
            </div>
          </section>

          <section className="fc-mobile-filter">
            <h4>Trabajador</h4>
            <input
              className="fc-worker-input"
              placeholder="Filtrar por nombre…"
              value={workerQuery}
              onChange={(e) => onTypeQuery(e.target.value)}
            />
            <select
              className="fc-worker-select"
              value={selectedName}
              onChange={(e) => onPickExact(e.target.value)}
            >
              <option value="">(Todos)</option>
              {workerNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </section>
        </aside>
      )}

      {/* Calendario */}
      <div className="calendar-container">
        {loading && <div className="loading">Cargando…</div>}
        <div ref={calendarRef} />
      </div>
    </div>
  );
};

export default CalendarView;