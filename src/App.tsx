
import MonthPage from "./pages/MonthPage";
import WeekPage from "./pages/WeekPage";
import DayPage from "./pages/DayPage";

export default function App() {
  // Simple toggle por hash: #/day, #/week, #/month
  const route = window.location.hash.replace("#/", "") || "month";
  if (route === "day")  return <DayPage />;
  if (route === "week") return <WeekPage />;
  return <MonthPage />;
}