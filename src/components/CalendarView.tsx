// src/components/CalendarView.tsx

import React, { useEffect, useMemo, useState } from "react";
import { Calendar } from "@fullcalendar/core";
import type { EventClickArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { fetchGlobalEvents } from "../lib/api";
import { inferRoleFromName, scheduleTickets } from "../lib/scheduler";
import type { Worker } from "../lib/scheduler";
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
      email?: string;
      phone?: string;
      color_hex?: string;
    };
    worker_name?: string; // otros backends
  };
};

// --- Helpers de nombres ---

// Quitar tildes y normalizar a minúsculas
const norm = (s: string) =>
  s
    ? s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
    : "";

// Si no viene en extendedProps, extraer "Nombre" desde el title: "xxxx – Nombre"
const parseNameFromTitle = (title: string): string => {
  if (!title) return "";
  const seps = [" — ", " – ", " - ", "—", "–", "-"];
  for (const sep of seps) {
    const i = title.lastIndexOf(sep);
    if (i >= 0) return title.slice(i + sep.length).trim();
  }
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
  )
    .toString()
    .trim();
};

// --- Hook de tamaño (móvil / desktop) ---

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
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
  const [noWorkersWarning, setNoWorkersWarning] = useState(false);
  const isMobile = useIsMobile(768);

  // Sidebar móvil
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = () => setSidebarOpen((s) => !s);
  const closeSidebar = () => setSidebarOpen(false);

  // Datos
  const [rawEvents, setRawEvents] = useState<FCEvent[]>([]);
  const [workerNames, setWorkerNames] = useState<string[]>([]);

  // Filtros (cliente, sin tocar URL)
  const [workerQuery, setWorkerQuery] = useState<string>(""); // texto libre
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
    [isMobile],
  );

  // Render inicial de FullCalendar
  useEffect(() => {
    if (!calendarRef.current) return;

    const calendar = new Calendar(calendarRef.current, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],
      initialView,
      initialDate: dateISO,
      headerToolbar,
      slotMinTime: "08:00:00",
      slotMaxTime: "17:30:00", // 8-17:30, la lógica de scheduler respeta 8-17
      slotDuration: "00:15:00",
      nowIndicator: true,
      selectable: false,
      weekends: true,
      eventClick: (arg: EventClickArg) => {
        const extId = (arg.event.extendedProps as any)["ticket_external_id"];
        alert(
          `Ticket ${extId}\n${arg.event.title}\n${arg.event.start} - ${arg.event.end}`,
        );
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

  // Cargar eventos del rango visible + aplicar agendamiento
  useEffect(() => {
    if (!cal) return;

    (async () => {
      try {
        setLoading(true);
        setNoWorkersWarning(false);

        const start = cal.view.currentStart.toISOString().slice(0, 10);
        const end = cal.view.currentEnd.toISOString().slice(0, 10);
        const events: any[] = await fetchGlobalEvents(start, end);

        // 1) Construir pool de trabajadores desde la BD (ev.worker)
        const workersMap = new Map<number, Worker>();

        for (const ev of events) {
          const w: any = ev.worker;
          if (!w || !w.id) continue;
          if (workersMap.has(w.id)) continue;

          const fullName = (w.nombre ?? w.name ?? "").trim();
          const [firstName, ...rest] = fullName.split(" ");
          const lastName = rest.join(" ");

          const role =
            inferRoleFromName(fullName) ?? "field"; // por defecto, campo

          workersMap.set(w.id, {
            id: w.id,
            firstName: firstName || fullName,
            lastName: lastName || "",
            email: w.email ?? "",
            phone: w.phone ?? "",
            role,
            color_hex: w.color_hex,
          });
        }

        const workersFromApi = Array.from(workersMap.values());

        if (workersFromApi.length === 0) {
          // No podemos aplicar la lógica de agendamiento
          setNoWorkersWarning(true);
        }

        // 2) Eventos ya programados por el backend → se respetan tal cual
        const alreadyScheduled = events.filter(
          (ev: any) => ev.start && ev.end && ev.worker,
        );

        const fcEventsFromBackend: FCEvent[] = alreadyScheduled.map(
          (ev: any) => ({
            id: String(ev.id ?? ev.ticket_external_id),
            title: ev.title,
            start: ev.start,
            end: ev.end,
            backgroundColor: ev.color || ev.worker?.color_hex || undefined,
            borderColor: ev.color || ev.worker?.color_hex || undefined,
            extendedProps: {
              estado: ev.estado,
              ticket_external_id: ev.ticket_external_id,
              worker: ev.worker, // trabajador real de la BD
            },
          }),
        );

        // 3) Tickets “incompletos” → se envían al scheduler
        const toSchedule = events.filter(
          (ev: any) => !ev.start || !ev.end, // criterio simple
        );

        let fcEventsFromScheduler: FCEvent[] = [];

        if (toSchedule.length > 0 && workersFromApi.length > 0) {
          const scheduledTickets = scheduleTickets(
            toSchedule.map((ev: any, idx: number) => ({
              id: String(ev.id ?? ev.ticket_external_id ?? idx),
              title: ev.title,
              createdAt:
                ev.created_at ??
                ev.creation_date ??
                new Date().toISOString(),
              roleHint: inferRoleFromName(
                ev.worker?.nombre ?? ev.worker?.name,
              ),
              ticket_external_id: ev.ticket_external_id,
              estado: ev.estado,
              color: ev.color || ev.worker?.color_hex,
            })),
            workersFromApi,
          );

          fcEventsFromScheduler = scheduledTickets.map((ticket) => ({
            id: String(ticket.id),
            title: `${ticket.title} — ${ticket.worker.firstName}`,
            start: ticket.start,
            end: ticket.end,
            backgroundColor:
              ticket.color || ticket.worker.color_hex || undefined,
            borderColor:
              ticket.color || ticket.worker.color_hex || undefined,
            extendedProps: {
              estado: ticket.estado,
              ticket_external_id: ticket.ticket_external_id,
              worker: {
                id: ticket.worker.id,
                nombre: `${ticket.worker.firstName} ${ticket.worker.lastName}`.trim(),
                email: ticket.worker.email,
                phone: ticket.worker.phone,
                color_hex: ticket.worker.color_hex || ticket.color,
              },
            },
          }));
        }

        // 4) Mezclar ambos: eventos reales + programados por algoritmo
        const fcEvents = [...fcEventsFromBackend, ...fcEventsFromScheduler];

        setRawEvents(fcEvents);

        // nombres únicos para filtros
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
      if (sel) return name === sel; // selección exacta del combo
      if (q) return name.includes(q); // texto libre en input
      return true; // sin filtro -> todo
    });

    cal.removeAllEvents();
    cal.addEventSource(filtered);
  }, [cal, rawEvents, workerQuery, selectedName]);

  // helpers vistas
  const isActiveView = (type: string) => cal?.view.type === type;
  const goView = (
    type: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek",
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
      {/* Aviso si no hay trabajadores desde la BD */}
      {noWorkersWarning && (
        <div className="calendar-warning">
          ⚠ No se pudo obtener la lista de trabajadores desde la base de datos.
          No se está aplicando la lógica de agendamiento automático.
        </div>
      )}

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
            <button
              className="fc-close"
              onClick={() => setSidebarOpen(false)}
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>

          <section className="fc-mobile-views">
            <h4>Vistas</h4>
            <div className="fc-mobile-views-row">
              <button
                className={`view-btn ${
                  isActiveView("dayGridMonth") ? "active" : ""
                }`}
                onClick={() => goView("dayGridMonth")}
              >
                month
              </button>
              <button
                className={`view-btn ${
                  isActiveView("timeGridWeek") ? "active" : ""
                }`}
                onClick={() => goView("timeGridWeek")}
              >
                week
              </button>
              <button
                className={`view-btn ${
                  isActiveView("timeGridDay") ? "active" : ""
                }`}
                onClick={() => goView("timeGridDay")}
              >
                day
              </button>
              <button
                className={`view-btn ${
                  isActiveView("listWeek") ? "active" : ""
                }`}
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