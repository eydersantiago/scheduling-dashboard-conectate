import React, { useEffect, useMemo, useState } from "react";
import { Calendar } from "@fullcalendar/core";
import type { EventClickArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import { fetchGlobalEvents } from "../lib/api";
import "../styles/calendar.css";

// (opcional pero recomendado: estilos de los plugins)
// import "@fullcalendar/daygrid/main.css";
// import "@fullcalendar/timegrid/main.css";
// import "@fullcalendar/list/main.css";

type ViewMode = "day" | "week" | "month";

interface Props {
  mode: ViewMode;
  dateISO?: string;   // p.ej. "2025-09-13"
  workerId?: number;  // si luego filtras por técnico
}

const CalendarView: React.FC<Props> = ({ mode, dateISO }) => {
  const calendarRef = React.useRef<HTMLDivElement | null>(null);
  const [cal, setCal] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(false);

  const initialView = useMemo(() => {
    if (mode === "day") return "timeGridDay";
    if (mode === "week") return "timeGridWeek";
    return "dayGridMonth";
  }, [mode]);

  useEffect(() => {
    if (!calendarRef.current) return;

    const calendar = new Calendar(calendarRef.current, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],
      initialView,
      initialDate: dateISO,
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
      },
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
      height: "auto",
    });

    calendar.render();
    setCal(calendar);
    return () => calendar.destroy();
  }, [initialView, dateISO]);

  // Cargar eventos cuando hay calendario listo
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

  return (
    <div className="calendar-container">
      {loading && <div className="loading">Cargando…</div>}
      <div ref={calendarRef} />
    </div>
  );
};

export default CalendarView;