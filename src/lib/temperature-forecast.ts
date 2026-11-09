import { z } from "zod";
import { findMapLocation } from "./map-location";

const dailyForecast = z.object({
  time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).length(8),
  temperature_2m_min: z.array(z.number()).length(8),
  temperature_2m_max: z.array(z.number()).length(8),
});

export function weeklyTemperatureRequest(text: string) {
  const match = /^(?:please\s+)?(?:show(?: me)?|display|plot|chart)\s+(?:(?:a|the)\s+)?(?:chart\s+of\s+)?(?:the\s+)?(?:daily\s+)?temperatures?(?:\s+forecast)?\s+(?:in|for)\s+([^\r\n]+?)\s+(?:(?:for|over)\s+)?(?:this coming week|the next (?:7|seven) days)(?:\s+in\s+(fahrenheit|celsius))?[?!. ]*$/i.exec(text.trim());
  if (!match) return;
  return { place: match[1].trim(), fahrenheit: match[2]?.toLowerCase() === "fahrenheit" };
}

export async function weeklyTemperatureChart(place: string, fahrenheit: boolean, signal: AbortSignal) {
  const quote = JSON.stringify;
  const unavailable = (message: string) => `root = Card([TextContent(${quote(message)})])`;
  const location = await findMapLocation(place, signal);
  if (!location) return unavailable(`I couldn't find ${place}. Try adding the region or country.`);
  const [longitude, latitude] = location.coordinates;
  try {
    const url = new URL(process.env.RICH_CHAT_FORECAST_URL || "https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), timezone: "auto", forecast_days: "8",
      daily: "temperature_2m_min,temperature_2m_max", temperature_unit: fahrenheit ? "fahrenheit" : "celsius",
    }).toString();
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]) });
    if (!response.ok) throw new Error("Forecast unavailable");
    const { daily } = await response.json();
    const { time, temperature_2m_min: lows, temperature_2m_max: highs } = dailyForecast.parse(daily);
    const unit = fahrenheit ? "°F" : "°C";
    return `root = Card([TextContent(${quote(`7-day temperature forecast: ${location.label}`)}, "large-heavy"), LineChart(${quote(time.slice(1))}, [Series("Low (${unit})", ${quote(lows.slice(1))}), Series("High (${unit})", ${quote(highs.slice(1))})]), MarkDownRenderer("[Forecast data: Open-Meteo](https://open-meteo.com/)")])`;
  } catch {
    return unavailable(`I couldn't load the temperature forecast for ${location.label}. Try again in a moment.`);
  }
}
