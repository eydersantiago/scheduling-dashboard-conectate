import React from "react";
import CalendarView from "../components/CalendarView";
import { attachAuthTokenFromURLOrStorage } from "../lib/api";

const WeekPage: React.FC = () => {
  attachAuthTokenFromURLOrStorage();
  return <CalendarView mode="week" />;
};
export default WeekPage;