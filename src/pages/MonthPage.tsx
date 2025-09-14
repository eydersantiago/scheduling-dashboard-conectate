import React from "react";
import CalendarView from "../components/CalendarView";
import { attachAuthTokenFromURLOrStorage } from "../lib/api";

const MonthPage: React.FC = () => {
  attachAuthTokenFromURLOrStorage();
  return <CalendarView mode="month" />;
};
export default MonthPage;