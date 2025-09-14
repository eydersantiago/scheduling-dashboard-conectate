import React from "react";
import CalendarView from "../components/CalendarView";
import { attachAuthTokenFromURLOrStorage } from "../lib/api";

const DayPage: React.FC = () => {
  attachAuthTokenFromURLOrStorage();
  const today = new Date().toISOString().slice(0,10);
  return <CalendarView mode="day" dateISO={today} />;
};
export default DayPage;