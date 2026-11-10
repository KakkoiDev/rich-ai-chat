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

const week = /\b(?:this (?:coming )?week|(?:the )?next (?:7|seven) days)\b/i;
const lookupAgain = /^(?:(?:please|yes|sure|can you|could you|would you)[, ]+)*(?:(?:look it up|check it|search)(?: online| on the web)?|try again)[.!? ]*$/i;

export function conversationalForecast(request: string, previousRequest?: string, mapPlace?: string) {
  const input = (lookupAgain.test(request.trim()) ? previousRequest : request)?.trim();
  if (!input) return;
  const exact = weeklyTemperatureRequest(input);
  if (exact) return exact;
  const range = week.exec(input);
  if (!range || !/\b(?:weather|temperatures?|forecast)\b/i.test(input)) return;
  // Only interpret location language in the clause before the requested period.
  const subject = input.slice(0, range.index).trim().replace(/\s+(?:for|over|during)$/i, "");
  if (/\b(?:was|were|historical|history|last week|yesterday)\b/i.test(subject)) return;
  const placeName = "[\\p{L}\\p{M}][\\p{L}\\p{M} .'’,-]{0,79}";
  const location = new RegExp("\\b(?:weather(?: forecast)?|forecast|temperatures?)\\s+(?:in|for|at)\\s+(" + placeName + ")$", "iu").exec(subject)?.[1]
    ?? new RegExp("^(?:(?:please|show me|give me|what is|what's|what’s|how is|how's|how’s)\\s+)*(?:(?:the)\\s+)?(" + placeName + ")[’']s\\s+(?:weather(?: forecast)?|forecast|temperatures?)$", "iu").exec(subject)?.[1];
  const place = location?.trim() ?? (/\b(?:weather(?: forecast)?|forecast|temperatures?)\s+there$/i.test(subject) ? mapPlace : undefined);
  if (!place) return;
  return { place, fahrenheit: /\bfahrenheit\b/i.test(input) };
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
