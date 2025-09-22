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
  workerId?: number;
}

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

  // Sidebar (solo móvil)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = () => setSidebarOpen((s) => !s);
  const closeSidebar = () => setSidebarOpen(false);

  // Vista inicial: en desktop respeta "mode"; en móvil usamos listWeek
  const initialView = useMemo(() => {
    if (isMobile) return "listWeek";
    if (mode === "day") return "timeGridDay";
    if (mode === "week") return "timeGridWeek";
    return "dayGridMonth";
  }, [mode, isMobile]);

  // Header: en desktop mostramos los botones nativos; en móvil los ocultamos
  const headerToolbar = useMemo(() => {
    return isMobile
      ? { left: "prev,next today", center: "title", right: "" }
      : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" };
  }, [isMobile]);

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

  // Cambiar vista si cambia tamaño (rotación) o modo
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

  // Cargar eventos
  useEffect(() => {
    if (!cal) return;
    (async () => {
      try {
        setLoading(true);
        const start = cal.view.currentStart.toISOString().slice(0, 10);
        const end = cal.view.currentEnd.toISOString().slice(0, 10);
        const events = await fetchGlobalEvents(start, end);
        const fcEvents = events.map((ev) => ({
          id: String(ev.id),
          title: ev.title,
          start: ev.start,
          end: ev.end,
          backgroundColor: ev.color || ev.worker?.color_hex || undefined,
          borderColor: ev.color || ev.worker?.color_hex || undefined,
          extendedProps: {
            estado: ev.estado,
            ticket_external_id: ev.ticket_external_id,
            worker: ev.worker,
          },
        }));
        cal.removeAllEvents();
        cal.addEventSource(fcEvents);
      } finally {
        setLoading(false);
      }
    })();
  }, [cal, initialView]);

  // helper para marcar botón activo en el sidebar
  const isActive = (type: string) => cal?.view.type === type;

  // función común para cambiar la vista desde el sidebar y cerrarlo
  const goView = (type: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek") => {
    cal?.changeView(type);
    closeSidebar();
  };

  return (
    <div className="calendar-responsive-wrap">
      {/* Botón flotante (solo móvil) para abrir/cerrar sidebar */}
      {isMobile && (
        <button
          className="fc-mobile-toggle"
          onClick={toggleSidebar}
          aria-expanded={sidebarOpen}
          aria-controls="fc-mobile-sidebar"
          aria-label="Abrir menú de vistas"
        >
          ☰ Vistas
        </button>
      )}

      {/* Sidebar móvil (oculto/visible) */}
      {isMobile && (
        <aside
          id="fc-mobile-sidebar"
          className={`fc-mobile-sidebar ${sidebarOpen ? "open" : ""}`}
          aria-hidden={!sidebarOpen}
        >
          <div className="fc-mobile-sidebar-header">
            <strong>Vistas</strong>
            <button className="fc-close" onClick={closeSidebar} aria-label="Cerrar">×</button>
          </div>
          <nav className="fc-mobile-views">
            <button
              className={`view-btn ${isActive("dayGridMonth") ? "active" : ""}`}
              onClick={() => goView("dayGridMonth")}
            >
              month
            </button>
            <button
              className={`view-btn ${isActive("timeGridWeek") ? "active" : ""}`}
              onClick={() => goView("timeGridWeek")}
            >
              week
            </button>
            <button
              className={`view-btn ${isActive("timeGridDay") ? "active" : ""}`}
              onClick={() => goView("timeGridDay")}
            >
              day
            </button>
            <button
              className={`view-btn ${isActive("listWeek") ? "active" : ""}`}
              onClick={() => goView("listWeek")}
            >
              list
            </button>
          </nav>
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